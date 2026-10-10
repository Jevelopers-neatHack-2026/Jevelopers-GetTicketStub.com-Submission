import {
  DEFAULT_RUN_LIMITS,
  RetrievalError,
  SafeFetcher,
  type FetchOptions,
  type RetrievedDocument,
} from "@jevelopers/event-intelligence-safe-retrieval";

const fetcher: SafeFetcher = new SafeFetcher();
const options: FetchOptions = { signal: AbortSignal.timeout(1_000) };
// @ts-expect-error callers cannot add authorization, cookies, or arbitrary request headers.
const forbiddenHeaders: FetchOptions = { headers: { authorization: "token" } };
// @ts-expect-error run limits cannot be raised or changed by a caller.
const raisedLimit: FetchOptions = { maxBytes: Number.MAX_SAFE_INTEGER };
const limits: Readonly<typeof DEFAULT_RUN_LIMITS> = DEFAULT_RUN_LIMITS;
const result: Promise<RetrievedDocument> = fetcher.fetch("https://example.org/", options);

try {
  await result;
} catch (error: unknown) {
  if (error instanceof RetrievalError) {
    const code: RetrievalError["code"] = error.code;
    void code;
  }
}

void limits;
void forbiddenHeaders;
void raisedLimit;
