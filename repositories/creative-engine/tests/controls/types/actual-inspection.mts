import {InspectionControlsAdapter,projectInspectionSource,projectInspectionView,projectRepairResult} from 'creative-engine/controls';
import type {TrustedPrincipal,ActualInspectionView,ActualInspectionSource} from 'creative-engine/controls';
async function actualConsumer(adapter:InspectionControlsAdapter,principal:TrustedPrincipal){
 const result=await adapter.start(principal,{source_operation_id:'saved-apply',inspection_action_id:'separate-inspection'});
 if(result.ok){const view:ActualInspectionView=result;projectInspectionView(view);const cost:null=view.total_cost;void cost;}
 await adapter.lookup(principal,'separate-inspection');await adapter.latest(principal);await adapter.cancel(principal,'separate-inspection');
 const source:ActualInspectionSource|null=await adapter.currentSource(principal);projectInspectionSource(source);
 if(source){
  // @ts-expect-error Recovered saved-source identity is immutable.
  source.source_operation_id='changed-source';
 }
 const repaired=await adapter.repair(principal,{inspection_action_id:'separate-inspection',repair_action_id:'fresh-repair',repair_action:'image.edit'});
 projectRepairResult(repaired,'fresh-repair');
 // @ts-expect-error Purchase is not an inspection repair operation.
 await adapter.repair(principal,{inspection_action_id:'inspection',repair_action_id:'repair',repair_action:'purchase'});
}
void actualConsumer;
