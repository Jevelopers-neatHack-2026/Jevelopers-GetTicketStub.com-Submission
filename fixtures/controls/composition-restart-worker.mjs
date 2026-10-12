/** Fresh process, same durable controls/creative database and object root. */
import { readFileSync } from 'node:fs';
import { createIntegratedHost, fixturePrincipal } from './integrated-host.mjs';
const [directory, actionPath] = process.argv.slice(2);
const action = JSON.parse(readFileSync(actionPath, 'utf8'));
const host = await createIntegratedHost(directory, { enableComposition: true, lockLogo: false });
try {
  const result = await host.composition.retry(fixturePrincipal, action.action_id);
  const current = await host.composition.current(fixturePrincipal);
  console.log(JSON.stringify({ node: process.version, node_executable: process.execPath, result, current, counters: host.counts(), mode:'mock', live_calls:0 }));
} finally { host.close(); }
