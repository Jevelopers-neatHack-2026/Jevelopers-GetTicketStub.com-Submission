import {
  createTicketstubHarnessExporter,
  type TicketstubAcceptResult,
  type TicketstubEventInput,
  type TicketstubHarnessExporter
} from '@jevelopers/agent-harness-runtime/ticketstub';

const event: TicketstubEventInput = {
  schema: 'ticketstub.event/1',
  type: 'art_ready',
  at: 1,
  requestId: 'req_typecheck',
  actor: 'anonymous',
  mode: 'sandbox',
  fields: { provider: 'procedural' }
};

export async function typecheck(env: Record<string, string | undefined>): Promise<number> {
  const exporter: TicketstubHarnessExporter = createTicketstubHarnessExporter({ env, databasePath: '/tmp/x.sqlite' });
  const result: TicketstubAcceptResult = exporter.accept([event]);
  const drained = await exporter.drain();
  await exporter.close();
  return result.accepted + (drained?.verified ?? 0) + exporter.status().outbox.counts.queued;
}
