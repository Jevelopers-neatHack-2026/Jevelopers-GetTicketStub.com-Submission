import { createSystemDnsResolver } from "./internal/dns-wire.mjs";
import { performance } from "node:perf_hooks";
import { RetrievalError } from "./errors.mjs";

export async function resolveSystemHost(hostname, options = {}) {
  if (options.signal?.aborted) throw new RetrievalError("CANCELED");
  if (options.deadline !== undefined && performance.now() >= options.deadline) throw new RetrievalError("DEADLINE_EXCEEDED");
  const resolver = await createSystemDnsResolver();
  if (options.signal?.aborted) throw new RetrievalError("CANCELED");
  if (options.deadline !== undefined && performance.now() >= options.deadline) throw new RetrievalError("DEADLINE_EXCEEDED");
  return resolver.resolve(hostname, options);
}
