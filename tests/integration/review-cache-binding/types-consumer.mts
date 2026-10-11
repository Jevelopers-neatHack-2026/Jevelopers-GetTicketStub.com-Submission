import { createCorrectionCacheBinding } from '../../../src/review/history/cache-binding.mjs';
import type {
  CorrectionCacheBindingOptions,
  CorrectionCacheBindingStore,
  CorrectionCacheProfileInput,
} from '../../../src/review/history/cache-binding.mjs';
import type { CorrectionInput, ReviewFactField } from '../../../src/review/history/store.mjs';

interface Request {
  readonly principal: Readonly<{ tenantId: string; actorId: string }>;
  readonly serverContextToken: string;
}

interface RetentionPermit {
  readonly permitId: string;
}

declare const options: CorrectionCacheBindingOptions<Request, RetentionPermit>;
declare const request: Request;
declare const retentionHandle: RetentionPermit;
declare const profile: CorrectionCacheProfileInput;
declare const correction: CorrectionInput<'event_date', RetentionPermit>;
declare const refresh: Parameters<CorrectionCacheBindingStore<Request, RetentionPermit>['refreshSources']>[1];

const store = createCorrectionCacheBinding(options);
const scope = await store.scopeForAuthenticatedRequest(request);

const field: ReviewFactField = 'event_date';
const correctDate: CorrectionInput<'event_date', RetentionPermit> = {
  eventId: 'event-1',
  baseVersionId: 'v1',
  baseContentHash: 'a'.repeat(64),
  field,
  value: { precision: 'date', value: '2027-06-20' },
  idempotencyKey: 'correction-1',
  retentionHandle,
};

void store.bindPrivateProfile(scope, correctDate.eventId,
  { idempotencyKey: 'bind-1', profile }, request, { signal: new AbortController().signal });
void store.createHistory(scope, {
  eventId: correctDate.eventId,
  sourceFacts: {},
  idempotencyKey: 'initialize-1',
  retentionHandle,
}, request);
void store.applyCorrection(scope, correctDate, request);
void store.applyCorrection(scope, correction, request, { signal: new AbortController().signal });
void store.refreshSources(scope, refresh, request);
void store.getPrivateProfile(scope, correctDate.eventId, request, profile, 'cache_read');
void store.dispatchPendingInvalidations(scope, request, 10);
void store.outboxSnapshot(scope, request);

// The history API remains typed to the supported four-field allowlist.
// @ts-expect-error an arbitrary field cannot be written through the facade
void store.applyCorrection(scope, { ...correctDate, field: 'unreviewed_field' }, request);
