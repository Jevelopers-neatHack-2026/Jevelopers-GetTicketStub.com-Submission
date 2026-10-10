import assert from "node:assert/strict";
import test from "node:test";
import * as root from "@jevelopers/event-intelligence-safe-retrieval";
import * as urlPolicy from "@jevelopers/event-intelligence-safe-retrieval/security/url-policy";
import * as dnsResolver from "@jevelopers/event-intelligence-safe-retrieval/security/dns-resolver";
import * as controlledFetch from "@jevelopers/event-intelligence-safe-retrieval/security/controlled-fetch";

test("every declared package subpath has matching runtime exports", () => {
  assert.equal(typeof root.SafeFetcher, "function");
  assert.equal(typeof root.RetrievalError, "function");
  assert.equal(typeof urlPolicy.parseAndValidateUrl, "function");
  assert.equal(typeof urlPolicy.isPublicAddress, "function");
  assert.equal(typeof dnsResolver.resolveSystemHost, "function");
  assert.equal(typeof controlledFetch.SafeFetcher, "function");
  assert.equal(typeof controlledFetch.DEFAULT_RUN_LIMITS, "object");
  assert.equal(controlledFetch.RetrievalError, root.RetrievalError);
});
