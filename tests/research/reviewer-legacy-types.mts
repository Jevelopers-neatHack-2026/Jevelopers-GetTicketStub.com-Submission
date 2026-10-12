import type {EvidenceStore} from '../../src/evidence/store.mjs';
import type {PrivateRetrievalInput} from '../../src/research/private-retrieval.mjs';
declare const previousStore: Omit<EvidenceStore, 'ingestControlledAssetEvidence' | 'readAssetSourceCandidateBinding' | 'readControlledAssetBytes'>;
declare const previousInput: Omit<PrivateRetrievalInput, 'evidenceStore' | 'assetAcquisitionPolicyFor'>;
const defaultOffInput: PrivateRetrievalInput = {...previousInput, evidenceStore: previousStore};
void defaultOffInput;
