import { readFileSync } from 'node:fs';
import { createIntegratedHost, fixturePrincipal } from './integrated-host.mjs';
const host = await createIntegratedHost(process.argv[2]);
try {
  const body = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const result = await host.adapter.apply(fixturePrincipal, body);
  console.log(JSON.stringify({ result, counters: host.counts() }));
} finally { host.close(); }
