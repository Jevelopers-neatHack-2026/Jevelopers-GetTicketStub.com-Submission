export interface LocalBoundaryInput<Request = unknown> {
  readonly request: Request;
  readonly tenantId: string;
  readonly actorId: string;
  readonly eventId: string | null;
  readonly action: string;
  readonly field: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface LocalBoundaryPermit {
  readonly authorized: true;
  readonly tenantId: string;
  readonly actorId: string;
  readonly eventId: string | null;
  readonly action: string;
  readonly field: string | null;
  readonly nowMs: number;
}

export type LocalBoundaryGuard<Request = unknown> =
  (input: LocalBoundaryInput<Request>) => LocalBoundaryPermit | false;

export declare function beginLocalBoundary<Request = unknown>(
  guard: LocalBoundaryGuard<Request> | unknown,
  input: LocalBoundaryInput<Request>,
  deny: () => never,
): Readonly<{ nowMs: number }>;

export declare function monotonicElapsedMs(startedAtNs: bigint): number | null;
export declare function localBoundaryEffectiveNow(token: Readonly<{ nowMs: number }>): number | null;
export declare function monotonicTimestampNs(): bigint;
