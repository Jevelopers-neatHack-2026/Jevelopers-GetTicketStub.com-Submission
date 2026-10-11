import type {
  CorrectionHistoryStoreOptions,
  CorrectionTenantScope,
  CreateHistoryInput,
  CorrectionInput,
  CorrectionHistorySnapshot,
  HistoryWriteOptions,
  HistoryWriteResult,
  ReviewFactField,
  SourceRefreshInput,
} from './store.mjs';
import type {
  LookupInput,
  PrivateFact,
  PrivateLookupResult,
  ReuseStore,
  ScopedReuseOptions,
  ReusePermission,
} from '../../cache/reuse/store.mjs';
import type { LocalBoundaryInput, LocalBoundaryPermit } from '../../private/boundary-guard.mjs';
import type { LocalBoundaryGuard } from '../../private/boundary-guard.mjs';

declare const correctionCacheBindingScopeBrand: unique symbol;

/** Opaque process-local capability that pairs one history and cache tenant scope. */
export type CorrectionCacheBindingScope = { readonly [correctionCacheBindingScopeBrand]: true };

export interface CorrectionCacheBindingCallOptions {
  /** Genuine in-process cancellation signal. A late host callback cannot pass the paired-store fence. */
  readonly signal?: AbortSignal;
}

export type CorrectionCacheProfileInput = LookupInput & Readonly<{
  facts: Readonly<Record<string, PrivateFact>>;
  observation: unknown;
  freshnessTtlMs?: number;
  expiresAtMs?: number;
}>;

export interface FinalPrivateDisclosureDetails {
  readonly bindingId: string;
  readonly profileRef: string;
  readonly historyVersionId: string;
  readonly historyContentHash: string;
  readonly historyProjectionHash: string;
  readonly identity: LookupInput['identity'];
  readonly pins: LookupInput['pins'];
  readonly cacheSourceContentHash: string;
  readonly permissionReferences: readonly ReusePermission[];
  readonly permissionValidUntilMs: number | null;
  readonly cacheExpiresAtMs: number;
  readonly historyExpiresAtMs: number;
}

export interface FinalPrivateDisclosureDecision<Request = unknown> extends LocalBoundaryInput<Request> {
  readonly eventId: string;
  readonly action: 'private_profile.read';
  readonly field: null;
  readonly details: Readonly<FinalPrivateDisclosureDetails>;
}

/** Scoped-cache configuration used by the composed participant. Standalone cache callers may omit this guard. */
export type CorrectionCacheParticipantOptions<Request = unknown> = ScopedReuseOptions<Request> & Readonly<{
  readonly authorizeBoundary: LocalBoundaryGuard<Request>;
}>;

export interface CorrectionCacheBindingOptions<Request = unknown, RetentionHandle extends object = object> {
  readonly history: CorrectionHistoryStoreOptions<Request, RetentionHandle>;
  readonly cache: CorrectionCacheParticipantOptions<Request>;
  /** Required synchronous current request/permission decision and trusted time sample for action `private_profile.read`. */
  readonly authorizeBoundary: (input: FinalPrivateDisclosureDecision<Request>) => LocalBoundaryPermit | false;
  readonly operationTimeoutMs?: number;
}

export interface BoundPrivateProfileResult {
  readonly status: 'bound';
  readonly cacheVersion: number;
  readonly historyVersionId: string;
  readonly expiresAt: string;
  readonly replayed: boolean;
}

type RefBearingUnavailablePrivateLookup = Extract<PrivateLookupResult,
  Readonly<{ status: 'unavailable'; profileRef: string }>>;
type OtherRefBearingUnavailablePrivateLookup = Omit<RefBearingUnavailablePrivateLookup, 'reason'> & Readonly<{
  reason: Exclude<RefBearingUnavailablePrivateLookup['reason'], 'expired'>;
}>;

/** Composed reads may hide an expired profile reference after history retention ends. */
export type ComposedPrivateLookupResult =
  | Exclude<PrivateLookupResult, RefBearingUnavailablePrivateLookup>
  | OtherRefBearingUnavailablePrivateLookup
  | Readonly<{ status: 'unavailable'; reason: 'expired' }>;

export interface CorrectionCacheBindingStore<Request = unknown, RetentionHandle extends object = object> {
  scopeForAuthenticatedRequest(request: Request, options?: CorrectionCacheBindingCallOptions): Promise<CorrectionCacheBindingScope>;
  createHistory(scope: CorrectionCacheBindingScope, input: CreateHistoryInput<RetentionHandle>, request: Request,
    options?: HistoryWriteOptions): Promise<HistoryWriteResult>;
  getHistory(scope: CorrectionCacheBindingScope, eventId: string, request: Request,
    options?: CorrectionCacheBindingCallOptions): Promise<CorrectionHistorySnapshot>;
  bindPrivateProfile(scope: CorrectionCacheBindingScope, eventId: string,
    input: Readonly<{ idempotencyKey: string; profile: CorrectionCacheProfileInput }>, request: Request,
    options?: CorrectionCacheBindingCallOptions): Promise<BoundPrivateProfileResult>;
  applyCorrection<Field extends ReviewFactField>(scope: CorrectionCacheBindingScope,
    input: CorrectionInput<Field, RetentionHandle>, request: Request,
    options?: CorrectionCacheBindingCallOptions): Promise<HistoryWriteResult>;
  refreshSources(scope: CorrectionCacheBindingScope, input: SourceRefreshInput<RetentionHandle>, request: Request,
    options?: CorrectionCacheBindingCallOptions): Promise<HistoryWriteResult>;
  getPrivateProfile(scope: CorrectionCacheBindingScope, eventId: string, request: Request, lookup: LookupInput,
    use?: string, options?: CorrectionCacheBindingCallOptions): Promise<ComposedPrivateLookupResult>;
  dispatchPendingInvalidations(scope: CorrectionCacheBindingScope, request: Request, maximum?: number,
    options?: CorrectionCacheBindingCallOptions): ReturnType<ReuseStore<Request>['dispatchPendingInvalidations']>;
  outboxSnapshot(scope: CorrectionCacheBindingScope, request: Request): ReturnType<ReuseStore<Request>['outboxSnapshot']>;
}

/** Private EI-local composition seam. This is not a route, package export, or external identity/auth contract. */
export declare function createCorrectionCacheBinding<Request = unknown, RetentionHandle extends object = object>(
  options: CorrectionCacheBindingOptions<Request, RetentionHandle>,
): CorrectionCacheBindingStore<Request, RetentionHandle>;
