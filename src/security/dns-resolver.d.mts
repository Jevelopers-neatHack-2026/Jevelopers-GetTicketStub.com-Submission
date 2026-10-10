export interface ResolutionOptions {
  readonly signal?: AbortSignal;
  /** Absolute performance.now() deadline in milliseconds. */
  readonly deadline?: number;
}

export interface HostResolution {
  readonly addresses: readonly string[];
  readonly aliases: readonly string[];
}

export declare function resolveSystemHost(hostname: string, options?: ResolutionOptions): Promise<HostResolution>;
