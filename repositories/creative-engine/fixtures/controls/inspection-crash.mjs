/** Offline process-interruption driver; no provider network or credentials. */
import {createIntegratedHost,fixturePrincipal} from './integrated-host.mjs';
const [directory,source,mode]=process.argv.slice(2);const host=await createIntegratedHost(directory);
if(mode==='ack'){host.block('observer-after-ack');setInterval(()=>{if(host.counts().observer_calls===1&&host.counts().transport_acks===1){console.log(JSON.stringify({mode,counters:host.counts()}));process.exit(17);}},5);}
const view=await host.inspection.start(fixturePrincipal,{source_operation_id:source,inspection_action_id:'process-inspection'});
console.log(JSON.stringify({mode,view,counters:host.counts()}));host.close();
