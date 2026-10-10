const MESSAGES = Object.freeze({
  POLICY_DENIED: "The retrieval target was denied by policy.",
  DNS_FAILURE: "The retrieval hostname could not be safely resolved.",
  TRANSPORT_FAILURE: "The retrieval request failed.",
  RESOURCE_LIMIT: "The response exceeded an immutable retrieval limit.",
  REDIRECT_LIMIT: "The retrieval exceeded the redirect limit.",
  REQUEST_LIMIT: "The retrieval run exceeded its request limit.",
  UNSUPPORTED_MEDIA: "The response media type is unsupported or inconsistent.",
  CANCELED: "The retrieval was canceled.",
  DEADLINE_EXCEEDED: "The retrieval exceeded its deadline.",
});

export class RetrievalError extends Error {
  constructor(code, options = {}) {
    super(MESSAGES[code] ?? "The retrieval request failed.", options);
    this.name = "RetrievalError";
    this.code = code;
  }
}
