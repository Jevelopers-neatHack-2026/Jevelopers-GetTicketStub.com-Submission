/** New process, same durable roots. Reads/retries only the original identities.
 * Provider and Finance transports remain explicit offline mock fixtures. */
import { readFileSync } from 'node:fs';
import { createIntegratedHost, fixturePrincipal } from './integrated-host.mjs';
const [directory, identitiesPath] = process.argv.slice(2);
const { action_ids } = JSON.parse(readFileSync(identitiesPath, 'utf8'));
const host = await createIntegratedHost(directory, { enableComposition: true, lockLogo: false });
try {
  const results = [];
  for (const action_id of action_ids) results.push({ action_id, read: await host.adapter.readArtworkAction(fixturePrincipal, action_id),
    retry: await host.adapter.retryArtworkAction(fixturePrincipal, action_id) });
  console.log(JSON.stringify({ node: process.version, node_executable: process.execPath, results, counters: host.counts(), mode: 'mock', live_calls: 0 }));
} finally { host.close(); }
