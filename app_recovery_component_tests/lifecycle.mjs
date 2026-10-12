import assert from 'node:assert/strict';
import { checked } from './custody.mjs';
import { runBounded } from './process.mjs';

export const prefix = /^ticketstub-finance-recovery-[a-f0-9]{10}$/;
const idPattern = /^[a-f0-9]{64}$/;
export function parseEvents(text, context) {
  const events = [];
  for (const line of text.trim().split('\n').filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.Type !== 'container' || !['create', 'start', 'destroy'].includes(event.Action)) continue;
    const id = event.Actor?.ID; const name = event.Actor?.Attributes?.name; const image = event.Actor?.Attributes?.image;
    if (!prefix.test(name ?? '')) continue;
    assert.match(id, idPattern); assert.equal(image, context.image); assert.ok(!context.baseline.includes(id));
    assert.ok(event.time >= context.since && event.time <= context.until);
    events.push({ id, name, image, action: event.Action, time: event.time });
  }
  return events;
}
export async function cleanupOwned(context, docker) {
  const owned = [...new Set(context.events.filter(row => row.action === 'create').map(row => row.id))];
  const live = await docker.inventory();
  const unknown = live.filter(id => !context.baseline.includes(id) && !owned.includes(id));
  assert.equal(unknown.length, 0, 'unknown container ownership');
  for (const id of owned) {
    assert.match(id, idPattern); assert.ok(!context.baseline.includes(id));
    if (!live.includes(id)) continue;
    const actual = await docker.inspect(id);
    const captured = context.events.find(row => row.id === id && row.action === 'create');
    assert.deepEqual(actual, { id, name: captured.name, image: context.image });
    await docker.remove(id);
  }
  const after = await docker.inventory();
  assert.ok(owned.every(id => !after.includes(id)), 'owned container remains');
  assert.ok(after.every(id => context.baseline.includes(id)), 'unknown final inventory');
  return { confirmed: true, unknown, owned, absent: owned, private_removed: false };
}
export function dockerPort(env) {
  const command = args => checked('docker', args, { env });
  return {
    inventory: () => command(['ps', '-aq', '--no-trunc']).split('\n').filter(Boolean),
    inspect: id => {
      const row = JSON.parse(command(['inspect', '--format', '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}}}', id]));
      return { ...row, name: row.name.replace(/^\//, '') };
    },
    remove: id => command(['rm', '--force', id]),
  };
}
export function startObserver(context, env, abortSignal) {
  // --since closes the subscription startup race; a bounded history query closes it again at exit.
  return runBounded('docker', ['events', '--since', String(context.since), '--until', String(context.since + 240), '--filter', 'type=container', '--format', '{{json .}}'], { env, abortSignal, timeout: 245000, limit: 1024 * 1024 });
}
export function readHistory(context, env) {
  return checked('docker', ['events', '--since', String(context.since), '--until', String(context.until), '--filter', 'type=container', '--format', '{{json .}}'], { env, timeout: 15000, maxBuffer: 1024 * 1024 });
}
export async function retirePrivate(root, certainty) {
  if (!certainty.terminationConfirmed || !certainty.resourceCleanupConfirmed) return { private_removed: false, quarantined_private_path: root };
  const { rm } = await import('node:fs/promises');
  await rm(root, { recursive: true });
  return { private_removed: true };
}
