/** Declared MOCK owner and preview producer. No provider, rights issuer, paid
 * transport or production renderer. The public API validates its bytes itself. */
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { canonicalHash } from 'creative-engine/contracts';
import { hashCompositionLayerManifest } from 'creative-engine/contracts/approval-handoff';
import { createCompositionRevision, compositionStateHash } from 'creative-engine/contracts/composition-authority';
import { chunk, makePng } from '../models/png.mjs';
import { fixtureCompositionPolicy } from './composition-policy.mjs';

export const fixtureLogoBytes = Uint8Array.from(makePng({ width: 16, height: 16, transparent: true }));
export const fixtureLogoHash = `sha256:${createHash('sha256').update(fixtureLogoBytes).digest('hex')}`;

/** A small deterministic fixture raster encodes each actual geometry/text layer.
 * It is visibly classified MOCK, and is never presented as print-ready output. */
function previewBytes(candidate) {
  const width = 128, height = 128, header = Buffer.alloc(13), rows = Buffer.alloc((width * 4 + 1) * height);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const palette = createHash('sha256').update(candidate.dependencies.artwork_sha256).digest();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 4 + 1) + 1 + x * 4;
    rows[offset] = palette[0]; rows[offset + 1] = palette[1]; rows[offset + 2] = palette[2]; rows[offset + 3] = 255;
  }
  for (const layer of candidate.layer_manifest.filter(x => x.kind !== 'artwork')) {
    const geometry = candidate.geometry.find(x => x.layer_id === layer.layer_id), layout = geometry.layout;
    if (!layout) continue;
    const color = createHash('sha256').update(JSON.stringify({ layer, size: geometry.text_size })).digest();
    for (let y = Math.floor(layout.y_milli * height / 1000); y < Math.min(height, Math.ceil((layout.y_milli + (layout.height_milli ?? 100)) * height / 1000)); y++)
      for (let x = Math.floor(layout.x_milli * width / 1000); x < Math.min(width, Math.ceil((layout.x_milli + (layout.width_milli ?? 100)) * width / 1000)); x++) {
        const offset = y * (width * 4 + 1) + 1 + x * 4;
        rows[offset] = color[0]; rows[offset + 1] = color[1]; rows[offset + 2] = color[2];
      }
  }
  return Uint8Array.from(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}

export function attachOfflineComposition(ports, { store, policy, counters, wait, now }) {
  const prepared = new Map();
  const fresh = () => ({ checked_at: now() - 1000, expires_at: now() + (policy.composition_ttl_ms ?? 60000) });
  const assertAuthority = () => { if (policy.can_apply === false || policy.can_read === false || policy.actor_expired || !policy.permitted_asset_ids.includes('asset-1')) throw new Error('MOCK owner authority denied'); };
  const metadata = (candidate, bytes, id) => ({ contract: 'CreativeCompositionPreviewMetadata', schema_version: '1.1', preview_id: `preview:${id}`,
    preview_sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, byte_length: bytes.length, mime_type: 'image/png', width_px: 128, height_px: 128,
    proof_ref: `preview-proof:${id}`, state_sha256: candidate.state_sha256 ?? compositionStateHash(candidate), ...fresh() });
  ports.composition = {
    async resolveCurrent(input) {
      counters.composition_resolves++; await wait('composition-owner'); assertAuthority();
      const stored = store.getCurrentComposition({ scope: input.scope, design_version_id: input.selected_design.design_version_id });
      if (stored) return { contract: 'CreativeCompositionSource', schema_version: '1.1', scope: input.scope, revision: stored.revision, preview_bytes: Uint8Array.from(stored.preview_bytes) };
      const { brief, selected_design: design, research_package: research } = input, p = fixtureCompositionPolicy(now());
      const parent = design.parent_version_id === null ? null : store.getDesignVersion({ scope: input.scope, brief_id: brief.brief_id, design_version_id: design.parent_version_id });
      const artwork = { artifact_id: design.artifact.artifact_id, locator_ref: 'object:MOCK:artwork', sha256: design.artifact.content_hash.slice(7), mime_type: design.artifact.media_type, width_px: 16, height_px: 16, access_policy_ref: 'access:MOCK:artwork' };
      const permission_ref = 'permission:MOCK:logo', asset = { asset_id: 'asset-1', sha256: fixtureLogoHash.slice(7), permission_ref, intended_use: 'logo' };
      const binding = { tenant_id: input.scope.tenant_id, project_id: input.scope.project_id, design_version: { design_version_id: design.design_version_id, artwork_sha256: artwork.sha256 },
        brief: { brief_id: brief.brief_id, sha256: input.brief_hash.slice(7) }, facts: { revision_id: research.event_id, sha256: canonicalHash(brief.facts).slice(7) }, assets: [asset],
        composition: { composition_id: `composition:${design.design_version_id}`, revision_id: `initial:${design.design_version_id}`, sha256: '0'.repeat(64) }, preview_sha256: '0'.repeat(64) };
      const layer_manifest = [{ layer_id: 'layer:artwork', kind: 'artwork', artifact_id: artwork.artifact_id, sha256: artwork.sha256 },
        { layer_id: 'layer:name', kind: 'text', role: 'personalization', value: policy.factual_name ? 'Example Festival' : 'Sample Name' },
        { layer_id: 'layer:logo', kind: 'approved_asset', asset_id: asset.asset_id, asset_sha256: asset.sha256, permission_ref,
          artifact: { artifact_id: 'artifact:MOCK:logo', locator_ref: 'object:MOCK:logo', sha256: asset.sha256, mime_type: 'image/png', width_px: 16, height_px: 16, access_policy_ref: 'access:MOCK:logo' } }];
      binding.composition.sha256 = hashCompositionLayerManifest({ binding, artifact: artwork, layer_manifest, trustedScope: input.scope });
      const dependencies = { brief_hash: input.brief_hash, facts_revision_id: research.event_id, facts_sha256: canonicalHash(brief.facts), package_id: research.package_id, package_sha256: input.package_hash,
        design_version_id: design.design_version_id, design_version_sha256: design.design_hash, artwork_sha256: design.artifact.content_hash, parent_version_id: design.parent_version_id, parent_design_hash: parent?.design_hash ?? null,
        selection_revision: input.selection_revision, asset_rights: ['display','modify','reproduce'].map(action => ({ asset_id: asset.asset_id, action, source_ref: research.assets.items[0].source_id, content_hash: fixtureLogoHash,
          package_id: research.package_id, package_hash: input.package_hash, permission_ref, intended_use: 'logo', evidence_ref: `rights:MOCK:${action}`, ...fresh() })) };
      const policyBody = { contract: 'CreativeCompositionEditPolicy', schema_version: '1.0', policy_ref: 'policy:MOCK:edit', policy_version: 'fixture-v1',
        ...Object.fromEntries(['brief_hash','facts_revision_id','facts_sha256','package_id','package_sha256','design_version_id','design_version_sha256','artwork_sha256','selection_revision'].map(k => [k, dependencies[k]])),
        locked_layer_ids: [...new Set([...(policy.locked_layer_ids ?? []), ...brief.locks.items.flatMap(lock => lock.field==='logo_position'?['layer:logo']:['name_size','layout','layout_emphasis'].includes(lock.field)?['layer:name']:[])])].sort(),
        factual_text_layers: [...(policy.factual_text_layers ?? [])], ...fresh() };
      dependencies.edit_policy = { ...policyBody, policy_sha256: canonicalHash(policyBody) };
      if (policy.factual_name) {
        policyBody.factual_text_layers = [{ layer_id: 'layer:name', fact_id: 'event-name-1', fact_sha256: dependencies.facts_sha256,
          text_sha256: `sha256:${createHash('sha256').update(layer_manifest[1].value).digest('hex')}` }];
        dependencies.edit_policy = { ...policyBody, policy_sha256: canonicalHash(policyBody) };
      }
      const raw = { tenant_id: input.scope.tenant_id, project_id: input.scope.project_id, brief_id: brief.brief_id, composition_id: binding.composition.composition_id, revision_id: binding.composition.revision_id,
        parent_revision_id: null, parent_revision_sha256: null, binding, artwork, layer_manifest, dependencies,
        geometry: [{ layer_id: 'layer:artwork', layout: null, text_size: null }, { layer_id: 'layer:name', layout: p.layouts.centered, text_size: p.name_sizes.medium }, { layer_id: 'layer:logo', layout: p.logos.top, text_size: null }] };
      const bytes = previewBytes(raw); raw.preview = metadata(raw, bytes, raw.revision_id); binding.preview_sha256 = raw.preview.preview_sha256.slice(7);
      dependencies.authority_proof = { proof_ref: 'authority:MOCK:initial', state_sha256: compositionStateHash(raw), ...fresh() };
      const revision = createCompositionRevision(raw, { trustedScope: input.scope, previewBytes: bytes, nowMs: now() }).revision;
      return { contract: 'CreativeCompositionSource', schema_version: '1.1', scope: input.scope, revision, preview_bytes: bytes };
    },
    async resolveRevalidation(input) {
      counters.composition_revalidations = (counters.composition_revalidations ?? 0) + 1;
      await wait('composition-renewal-owner'); assertAuthority();
      const base = input.base_revision, research = input.research_package;
      const asset_rights = base.dependencies.asset_rights.map(right => {
        const asset = research.assets.items.find(x => x.asset_id === right.asset_id);
        if (!asset || !research.permissions.items.some(x => x.asset_id === right.asset_id && x.action === right.action && x.status === 'granted')) throw new Error('MOCK fresh rights denied');
        return { ...right, source_ref: asset.source_id, content_hash: asset.content_hash, package_id: research.package_id, package_hash: input.package_hash,
          evidence_ref: `rights:MOCK:renew:${input.action_id}:${right.action}`, ...fresh() };
      });
      const { policy_sha256: _hash, ...priorPolicy } = base.dependencies.edit_policy;
      const policyBody = { ...priorPolicy, selection_revision: input.selection_revision,
        locked_layer_ids: [...new Set([...priorPolicy.locked_layer_ids, ...(policy.locked_layer_ids ?? [])])].sort(), ...fresh() };
      return { contract: 'CreativeCompositionRevalidationEvidence', schema_version: '1.0', scope: input.scope,
        composition_id: input.composition_id, expected_current: input.expected_current, candidate_revision_id: input.candidate_revision_id,
        brief_hash: input.brief_hash, facts_revision_id: research.event_id, facts_sha256: canonicalHash(input.brief.facts), package_id: research.package_id, package_sha256: input.package_hash,
        design_version_id: input.selected_design.design_version_id, design_version_sha256: input.selected_design.design_hash, selection_revision: input.selection_revision,
        asset_rights, edit_policy: { ...policyBody, policy_sha256: canonicalHash(policyBody) } };
    },
    async readApprovedAssetBytes(input) { await wait('composition-rights'); assertAuthority(); return { asset_id: input.asset_id, content_hash: fixtureLogoHash, mime_type: 'image/png', bytes: Uint8Array.from(fixtureLogoBytes) }; },
    async preparePreview(input) {
      assertAuthority(); await wait('composition-preview',{scope:input.scope,actor_id:input.actor_id,action_id:input.action_id,request_hash:input.request_hash}); assertAuthority();
      if (!prepared.has(input.idempotency_key)) {
        counters.composition_previews++;
        const bytes = previewBytes(input.candidate), preview = metadata(input.candidate, bytes, input.candidate.revision_id);
        prepared.set(input.idempotency_key, { contract: 'CreativeCompositionPreview', schema_version: '1.1', preview,
          authority_proof: { proof_ref: `authority:MOCK:${input.candidate.revision_id}`, state_sha256: input.candidate.state_sha256, ...fresh() }, preview_bytes: bytes });
      }
      return prepared.get(input.idempotency_key);
    },
    assertCurrent(input) {
      assertAuthority(); counters.composition_assertions++;
      return { contract: 'CreativeCompositionCurrentAssertionResult', schema_version: '1.1', status: 'current', scope: input.scope, composition_id: input.composition_id,
        current_revision_id: input.target_revision_id, current_revision_sha256: input.target_revision_sha256, selection_revision: input.selection_revision,
        design_version_id: input.design_version_id, design_version_sha256: input.design_version_sha256, facts_revision_id: input.facts_revision_id, facts_sha256: input.facts_sha256,
        package_id: input.package_id, package_sha256: input.package_sha256, proof_ref: 'assertion:MOCK:current', checked_at: input.checked_at, expires_at: now() + 60000 };
    },
  };
}
