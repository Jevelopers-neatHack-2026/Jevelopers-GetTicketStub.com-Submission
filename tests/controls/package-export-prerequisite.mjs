// Deliberately fails while the root export is unavailable. Run separately, never
// skip/catch it as passing acceptance; a later serialized root grant must fix it.
import { prepareInspectionRequest, CreativeControlsAdapter } from 'creative-engine/controls';
if (typeof prepareInspectionRequest !== 'function' || typeof CreativeControlsAdapter !== 'function') throw new Error('Controls export incomplete');
