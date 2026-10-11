const EMPTY_SELECTION = Object.freeze({ facts: Object.freeze([]) });

export async function discoverAssetCandidates({ store, scope, document, retentionHandle, request, signal }) {
  if (!store || typeof store.ingestAssetSourceEvidence !== 'function'
    || typeof store.materializeSelected !== 'function') throw new TypeError('asset source store is unavailable');

  const stored = await store.ingestAssetSourceEvidence(
    scope,
    Object.freeze({ document, retentionHandle }),
    request,
    signal,
  );
  if (!stored || stored.outcome !== 'stored') return stored;

  const materialized = await store.materializeSelected(scope, Object.freeze({
    ...EMPTY_SELECTION,
    evidence: Object.freeze([stored.evidence]),
  }), request, signal);
  if (!materialized || materialized.evidence.length !== 1 || materialized.facts.length !== 0) {
    throw new Error('asset source readback failed');
  }
  const evidence = materialized.evidence[0];
  const provenance = evidence.source.assetSource;
  if (evidence.metadata.representation !== 'asset-source-excerpt'
    || !provenance || evidence.source.contentHash !== evidence.metadata.contentHash
    || evidence.source.contentHash !== stored.metadata.contentHash
    || provenance.sourceKind !== 'external'
    || evidence.positions.length !== stored.positions.length
    || provenance.candidates.length !== evidence.positions.length) {
    throw new Error('asset source readback failed');
  }

  const candidates = provenance.candidates.map((candidate, index) => {
    const position = evidence.positions[index];
    const issuedPosition = stored.positions[index];
    if (!position || !issuedPosition || candidate.positionIndex !== index
      || JSON.stringify(candidate.locator) !== JSON.stringify(position.locator)
      || candidate.excerptHash !== position.contentHash) throw new Error('asset source readback failed');
    return Object.freeze({
      candidateId: candidate.candidateId,
      sourceForm: candidate.sourceForm,
      field: candidate.field,
      relationHint: candidate.relationHint,
      association: candidate.association,
      locator: candidate.locator,
      excerptHash: candidate.excerptHash,
      ...(candidate.excerptKind !== undefined ? { excerptKind: candidate.excerptKind } : {}),
      normalizedSuggestion: candidate.normalizedSuggestion,
      fetchSuggestion: candidate.fetchSuggestion,
      quarantineReason: candidate.quarantineReason,
      role: 'unknown',
      permission: 'unknown',
      inspection: 'pending',
      position: position.handle,
    });
  });

  return Object.freeze({
    outcome: 'stored',
    evidence: evidence.handle,
    metadata: evidence.metadata,
    sourceHash: evidence.source.contentHash,
    created: stored.created,
    completeness: provenance.completeness,
    limitations: provenance.limitations,
    candidates: Object.freeze(candidates),
  });
}
