import {
  DEFAULT_RUN_LIMITS,
  RetrievalError,
  SafeFetcher,
  type FetchOptions,
  type RetrievedDocument,
} from "@jevelopers/event-intelligence-safe-retrieval";
import { parseAndValidateUrl } from "@jevelopers/event-intelligence-safe-retrieval/security/url-policy";
import { resolveSystemHost } from "@jevelopers/event-intelligence-safe-retrieval/security/dns-resolver";
import {
  DEFAULT_RUN_LIMITS as controlledLimits,
  RetrievalError as ControlledRetrievalError,
  SafeFetcher as ControlledSafeFetcher,
} from "@jevelopers/event-intelligence-safe-retrieval/security/controlled-fetch";

const fetcher: SafeFetcher = new SafeFetcher();
const options: FetchOptions = { signal: AbortSignal.timeout(1_000) };
// @ts-expect-error callers cannot add authorization, cookies, or arbitrary request headers.
const forbiddenHeaders: FetchOptions = { headers: { authorization: "token" } };
// @ts-expect-error run limits cannot be raised or changed by a caller.
const raisedLimit: FetchOptions = { maxBytes: Number.MAX_SAFE_INTEGER };
const limits: Readonly<typeof DEFAULT_RUN_LIMITS> = DEFAULT_RUN_LIMITS;
const result: Promise<RetrievedDocument> = fetcher.fetch("https://example.org/", options);
const checkedUrl = parseAndValidateUrl("https://example.org/");
const resolution = resolveSystemHost(checkedUrl.hostname, { deadline: performance.now() + 1_000 });
const controlledFetcher: ControlledSafeFetcher = new ControlledSafeFetcher();
const controlledLimitsType: typeof DEFAULT_RUN_LIMITS = controlledLimits;
void controlledFetcher.fetch("https://example.org/");

try {
  await result;
} catch (error: unknown) {
  if (error instanceof RetrievalError) {
    const code: RetrievalError["code"] = error.code;
    void code;
  }
  if (error instanceof ControlledRetrievalError) {
    const code: ControlledRetrievalError["code"] = error.code;
    void code;
  }
}

void limits;
void forbiddenHeaders;
void raisedLimit;
void resolution;
void controlledLimitsType;
