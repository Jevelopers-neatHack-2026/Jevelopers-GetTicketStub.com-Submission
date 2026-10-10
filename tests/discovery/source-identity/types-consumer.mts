import { composeSourceIdentity } from "../../../src/discovery/identity/from-extraction.mjs";
import type {
  ComposeSourceIdentityInput,
  SourceIdentityCompositionResult,
} from "../../../src/discovery/identity/from-extraction.mjs";
import type { EvidenceStore } from "../../../src/evidence/store.mjs";
import type { RetrievedDocument } from "../../../src/security/index.mjs";

declare const document: RetrievedDocument;
declare const evidenceStore: EvidenceStore<{ readonly principal: { readonly tenantId: string } }>;
declare const request: { readonly principal: { readonly tenantId: string } };
declare const retentionHandle: object;

const input: ComposeSourceIdentityInput<{ readonly principal: { readonly tenantId: string } }> = {
  sources: [{ document, retentionHandle }],
  request,
  evidenceStore,
  signal: new AbortController().signal,
};

const result: Promise<SourceIdentityCompositionResult> = composeSourceIdentity(input);
void result.then((composition) => {
  const authority: "not_evaluated" = composition.sourceAuthority;
  const hash: string | undefined = composition.sources[0]?.evidence?.contentHash;
  const storedAt: string | undefined = composition.sources[0]?.storedSource?.retrievedAt;
  const observedAt: string | undefined = composition.sources[0]?.observedRetrievedAt;
  const occurrenceCount: number = composition.occurrenceCandidates.length;
  const transitionCount: number = composition.transitionLinks.length;
  void [authority, hash, storedAt, observedAt, occurrenceCount, transitionCount];
});
