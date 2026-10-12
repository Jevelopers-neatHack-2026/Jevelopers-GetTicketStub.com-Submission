/** Abrupt process exit after fixture transport crossed the actual dispatch fence. */
import { readFileSync } from 'node:fs';
import { createIntegratedHost, fixturePrincipal } from './integrated-host.mjs';
const host = await createIntegratedHost(process.argv[2]);
host.block('provider');
void host.adapter.apply(fixturePrincipal, JSON.parse(readFileSync(process.argv[3], 'utf8')));
const timer = setInterval(() => {
  if (host.counts().image_calls === 1) {
    clearInterval(timer);
    console.log(JSON.stringify({ crossed_dispatch: true, counters: host.counts(), backend_job_id: host.adapter.db.prepare('SELECT job_id FROM control_api_bindings_v1').get().job_id }));
    // Do not run close/cancel/release; emulate a terminated worker.
    process.exit(17);
  }
}, 5);
