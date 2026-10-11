import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import pg from 'pg';
import {
  estimate,
  registerFxRate,
  registerPricingRule,
  registerRateCard,
  validateEstimateRequestBoundary,
} from '../../dist/index.js';
import { databaseConfigFromEnvironment } from '../../scripts/test-db-lifecycle.mjs';

const { Pool } = pg;
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const fixturePath = join(root, 'fixtures/pricing/ci03-synthetic-acceptance.json');
const syntheticSourcePath = join(root, 'fixtures/pricing/synthetic-tariff-source.md');
const sharedUsagePath = join(root, 'node_modules/@jevelopers/shared-contracts/fixtures/UsageEvent.json');

function reference(contract, id, hash, revision = 1) {
  return { contract, schema_version: '1.0.0', id, revision, content_hash: hash };
}

function unit(name, quantity, relation = 'standalone', includedIn = null) {
  const scale = quantity.includes('.') ? quantity.split('.')[1].length : 0;
  return {
    name,
    quantity,
    scale,
    relation,
    ...(includedIn ? { included_in: includedIn } : {}),
  };
}

function normalUsageUnits(options = {}) {
  return [
    unit('input_tokens', options.input ?? '100'),
    unit('cached_tokens', options.cached ?? '20', 'included_subset', 'input_tokens'),
    unit('cache_write_tokens', options.written ?? '10', 'included_subset', 'input_tokens'),
    unit('output_tokens', options.output ?? '40'),
    unit('reasoning_tokens', options.reasoning ?? '15', 'included_subset', 'output_tokens'),
    ...(options.includeImage === false ? [] : [unit('image_input_units', options.images ?? '0')]),
    ...(options.includeSearch === false ? [] : [unit('file_search_calls', options.search ?? '1')]),
    ...(options.includeZero === false ? [] : [unit('zero_tariff_calls', options.zero ?? '1')]),
    ...(options.extraUnits ?? []),
  ];
}

function makeEvent(sharedEvent, scope, occurredAt, options = {}) {
  return {
    ...structuredClone(sharedEvent),
    tenant_id: scope.tenantId,
    project_id: scope.projectId,
    environment: scope.environment,
    billing_mode: scope.billingMode,
    provider: 'openai',
    model: options.model ?? 'ci03-synthetic-model-latest',
    source: 'provider_response',
    occurred_at: occurredAt,
    completeness: options.completeness ?? 'complete',
    usage_units: Object.hasOwn(options, 'usageUnits') ? options.usageUnits : normalUsageUnits(options),
    missing_fields: options.missingFields ?? [],
    source_refs: options.sourceRefs ?? [],
    valuation: options.valuation ?? { basis: 'unknown', money: null, rate_card_ref: null },
  };
}

function makePorts(pool, scope, clock, overrides = {}) {
  return {
    database: overrides.database ?? { connect: () => pool.connect() },
    trustedContext: overrides.trustedContext ?? { resolve: async () => ({ ...scope }) },
    clock: { now: () => new Date(clock.value) },
    ...(overrides.contractTimeAuthority ? { contractTimeAuthority: overrides.contractTimeAuthority } : {}),
  };
}

function requestBase(scope, event, requestId, selection = {}) {
  return {
    schemaVersion: '1.0.0',
    requestId,
    idempotencyKey: 'idem-' + requestId,
    scope,
    usageEvent: event,
    selection: {
      policy: 'event_time',
      effectiveAt: event.occurred_at,
      product: 'responses',
      requestedCurrency: 'USD',
      rateCardRef: null,
      fxRateRef: null,
      contractTimeEvidenceRef: null,
      contextTier: null,
      serviceTier: null,
      reasoningMode: null,
      toolClass: null,
      dimensionsEvidenceRef: null,
      ...selection,
    },
  };
}

async function callEstimate(request, ports) {
  const result = await estimate(request, ports);
  assert.equal(result.ok, true, result.ok ? '' : result.error.code + ': ' + result.error.safe_message);
  return result.value;
}

test('CI03 persists immutable pricing versions and estimates exact, partial, unknown, stale, and converted amounts', async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const sharedEvent = JSON.parse(await readFile(sharedUsagePath, 'utf8')).valid;
  const sourceBytes = await readFile(syntheticSourcePath);
  const sourceHash = 'sha256:' + createHash('sha256').update(sourceBytes).digest('hex');
  assert.equal(fixture.provenance.synthetic, true);
  assert.equal(fixture.provenance.external_calls, 0);
  assert.equal(fixture.provenance.rates_are_current_provider_prices, false);
  assert.equal(sourceHash, fixture.rate_card.sourceContentHash, 'the synthetic tariff source note is content-addressed');
  assert.equal(process.env.CI_TEST_DB_HOST !== undefined, true, 'pricing suite uses the disposable PostgreSQL harness');

  const scope = {
    tenantId: sharedEvent.tenant_id,
    projectId: sharedEvent.project_id,
    environment: sharedEvent.environment,
    billingMode: sharedEvent.billing_mode,
    actorId: 'ci03-pricing-fixture',
  };
  const pool = new Pool({ ...databaseConfigFromEnvironment('CI_TEST_DB'), max: 12 });
  const clock = { value: fixture.selection.published_at };
  const ports = makePorts(pool, scope, clock);

  try {
    const ledgerBefore = await pool.query('SELECT count(*)::text AS total FROM cost_intelligence.financial_ledger_events');

    const rule = structuredClone(fixture.pricing_rule);
    const ruleRequest = {
      schemaVersion: '1.0.0',
      requestId: 'ci03-rule-v1',
      idempotencyKey: 'ci03-rule-v1-idem',
      scope,
      rule,
    };
    const deniedPorts = makePorts(pool, scope, clock, {
      trustedContext: { resolve: async () => ({ ...scope, actorId: 'different-actor' }) },
      database: { connect: async () => { throw new Error('database must not open before scope authorization'); } },
    });
    for (const result of [
      await registerPricingRule(ruleRequest, deniedPorts),
      await registerRateCard({
        schemaVersion: '1.0.0', requestId: 'ci03-denied-card', idempotencyKey: 'ci03-denied-card-idem',
        scope, rateCard: { ...structuredClone(fixture.rate_card), pricingRuleRef: reference('PricingRule', 'no-rule', sourceHash) },
      }, deniedPorts),
      await registerFxRate({
        schemaVersion: '1.0.0', requestId: 'ci03-denied-fx', idempotencyKey: 'ci03-denied-fx-idem',
        scope, fxRate: structuredClone(fixture.fx_rate),
      }, deniedPorts),
    ]) {
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'FORBIDDEN_SCOPE');
    }

    const ruleWrite = await registerPricingRule(ruleRequest, ports);
    assert.equal(ruleWrite.ok, true, ruleWrite.ok ? '' : ruleWrite.error.safe_message);
    assert.equal(ruleWrite.value.status, 'accepted');
    assert.equal(ruleWrite.value.reference.contract, 'PricingRule');
    const ruleReplay = await registerPricingRule(ruleRequest, ports);
    assert.equal(ruleReplay.ok, true);
    assert.equal(ruleReplay.value.status, 'duplicate', 'same idempotency key and content is a replay');

    const card = {
      ...structuredClone(fixture.rate_card),
      pricingRuleRef: ruleWrite.value.reference,
    };
    const cardRequest = {
      schemaVersion: '1.0.0',
      requestId: 'ci03-card-v1',
      idempotencyKey: 'ci03-card-v1-idem',
      scope,
      rateCard: card,
    };
    const cardWrite = await registerRateCard(cardRequest, ports);
    assert.equal(cardWrite.ok, true, cardWrite.ok ? '' : cardWrite.error.safe_message);
    assert.equal(cardWrite.value.reference.contract, 'RateCard');
    const changedUnderSameKey = await registerRateCard({
      ...cardRequest,
      rateCard: { ...card, unitRates: card.unitRates.map(rate => rate.category === 'output' ? { ...rate, rate: '99' } : rate) },
    }, ports);
    assert.equal(changedUnderSameKey.ok, false);
    assert.equal(changedUnderSameKey.error.code, 'IDEMPOTENCY_CONFLICT');

    const fxRequest = {
      schemaVersion: '1.0.0',
      requestId: 'ci03-fx-v1',
      idempotencyKey: 'ci03-fx-v1-idem',
      scope,
      fxRate: structuredClone(fixture.fx_rate),
    };
    const fxWrite = await registerFxRate(fxRequest, ports);
    assert.equal(fxWrite.ok, true, fxWrite.ok ? '' : fxWrite.error.safe_message);
    assert.equal(fxWrite.value.reference.contract, 'FxRate');

    const oldEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time);
    const oldRequest = requestBase(scope, oldEvent, 'ci03-old-replay');
    assert.equal(validateEstimateRequestBoundary(oldRequest).ok, true);
    const exact = await callEstimate(oldRequest, ports);
    assert.equal(exact.status, 'complete');
    assert.equal(exact.knownSubtotal, fixture.expected.revision_one_complete_usd);
    assert.deepEqual(exact.knownSubtotalExact, { numerator: '7', denominator: '20000' });
    assert.equal(exact.currency, 'USD');
    const ordinaryLine = exact.calculation.find(line => line.usageUnit === 'input_tokens');
    assert.deepEqual({ quantity: ordinaryLine.quantity, extendedAmount: ordinaryLine.extendedAmount }, {
      quantity: '70',
      extendedAmount: '0.00014',
    });
    assert.equal(exact.calculation.some(line => line.usageUnit === 'reasoning_tokens'), false, 'reasoning is not added on top of output total');
    assert.equal(exact.boundedConservativeAuthorizationAmount, null, 'the estimator does not invent an authorization cap');

    const aliasEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, { model: 'ci03-synthetic-model-latest' });
    assert.equal((await callEstimate(requestBase(scope, aliasEvent, 'ci03-alias'), ports)).status, 'complete');
    const beforeEffectiveStart = makeEvent(sharedEvent, scope, '2026-10-11T03:29:59.999Z');
    const unavailable = await callEstimate(requestBase(scope, beforeEffectiveStart, 'ci03-before-start'), ports);
    assert.equal(unavailable.status, 'pricing_unknown');
    assert.equal(unavailable.knownSubtotal, null);

    const missingImageEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, { includeImage: false });
    const partialImage = await callEstimate(requestBase(scope, missingImageEvent, 'ci03-partial-image'), ports);
    assert.equal(partialImage.status, 'partial');
    assert.ok(partialImage.knownSubtotal !== null);
    assert.ok(partialImage.missingDimensions.includes('usage_applicability:image_input_units'));

    const missingOutputEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      usageUnits: normalUsageUnits().filter(item => item.name !== 'output_tokens' && item.name !== 'reasoning_tokens'),
    });
    const missingOutput = await callEstimate(requestBase(scope, missingOutputEvent, 'ci03-missing-output'), ports);
    assert.equal(missingOutput.status, 'partial');
    assert.ok(missingOutput.missingDimensions.includes('usage:output_tokens'));
    assert.ok(missingOutput.knownSubtotal !== null, 'known categories stay visible while output remains unknown');

    const unknownEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      completeness: 'unknown', usageUnits: null, missingFields: ['usage_units'],
    });
    const unknown = await callEstimate(requestBase(scope, unknownEvent, 'ci03-no-usage'), ports);
    assert.equal(unknown.status, 'unknown');
    assert.equal(unknown.knownSubtotal, null);
    assert.ok(unknown.missingDimensions.includes('usage_units_unavailable'));

    const unsupportedEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      extraUnits: [unit('container_minutes', '5')],
    });
    const unsupported = await callEstimate(requestBase(scope, unsupportedEvent, 'ci03-unsupported-service'), ports);
    assert.equal(unsupported.status, 'partial');
    assert.ok(unsupported.missingDimensions.includes('unsupported_usage_unit:container_minutes'));

    const badPartitionEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      cached: '50', written: '60',
    });
    const badPartition = await callEstimate(requestBase(scope, badPartitionEvent, 'ci03-negative-residual'), ports);
    assert.equal(badPartition.status, 'partial');
    assert.ok(badPartition.missingDimensions.includes('usage_partition_exceeds_total:input_tokens'));
    assert.equal(badPartition.calculation.some(line => line.usageUnit === 'input_tokens' || line.usageUnit === 'cached_tokens'), false);

    const zeroEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      input: '0', cached: '0', written: '0', output: '0', reasoning: '0', images: '0', search: '0', zero: '1',
    });
    const zero = await callEstimate(requestBase(scope, zeroEvent, 'ci03-explicit-zero-rate'), ports);
    assert.equal(zero.status, 'complete');
    assert.equal(zero.knownSubtotal, '0');
    assert.ok(zero.calculation.some(line => line.category === 'zero_tariff_call' && line.rate === '0'));

    const evidenceHash = 'sha256:' + 'a'.repeat(64);
    const tierEvidenceId = 'ci03-tier-evidence';
    const tierEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      sourceRefs: [{ kind: 'evidence', id: tierEvidenceId, content_hash: evidenceHash }],
    });
    const unsupportedTier = await callEstimate(requestBase(scope, tierEvent, 'ci03-unsupported-tier', {
      serviceTier: 'fast',
      dimensionsEvidenceRef: reference('TierEvidence', tierEvidenceId, evidenceHash),
    }), ports);
    assert.equal(unsupportedTier.status, 'pricing_unknown', 'an unsupported service tier cannot fall through to a default card');

    const oldFx = await callEstimate(requestBase(scope, oldEvent, 'ci03-fx-conversion', {
      requestedCurrency: 'EUR',
      fxRateRef: fxWrite.value.reference,
    }), ports);
    assert.equal(oldFx.status, 'complete');
    assert.equal(oldFx.currency, 'USD', 'source currency remains explicit');
    assert.equal(oldFx.knownSubtotal, fixture.expected.revision_one_complete_usd);
    assert.equal(oldFx.fxConvertedSubtotal, fixture.expected.revision_one_fx_eur);
    assert.equal(oldFx.fxTargetCurrency, 'EUR');
    assert.equal(oldFx.fxRateRef.id, fixture.fx_rate.id);

    const missingFx = await callEstimate(requestBase(scope, oldEvent, 'ci03-missing-fx', { requestedCurrency: 'JPY' }), ports);
    assert.equal(missingFx.status, 'partial');
    assert.equal(missingFx.currency, 'USD');
    assert.equal(missingFx.fxConvertedSubtotal, null);
    assert.ok(missingFx.missingDimensions.some(value => value.startsWith('fx_rate_unavailable_or_ambiguous:')));

    const overlap = await registerRateCard({
      ...cardRequest,
      requestId: 'ci03-overlap-card',
      idempotencyKey: 'ci03-overlap-card-idem',
      rateCard: {
        ...card,
        id: 'ci03-overlapping-card',
        modelOrSku: 'ci03-synthetic-model-latest',
        aliases: [],
        effectiveFrom: '2026-10-11T03:30:15.000Z',
        retrievedAt: '2026-10-11T03:30:15.000Z',
      },
    }, makePorts(pool, scope, { value: '2026-10-11T03:30:15.000Z' }));
    assert.equal(overlap.ok, false);
    assert.equal(overlap.error.code, 'VALIDATION_ERROR', 'overlapping model/alias intervals are rejected');

    clock.value = fixture.selection.revision_two_published_at;
    const cardV2 = {
      ...card,
      revision: 2,
      effectiveFrom: fixture.selection.revision_two_effective_from,
      retrievedAt: fixture.selection.revision_two_published_at,
      unitRates: card.unitRates.map(rate => rate.category === 'input_ordinary' ? { ...rate, rate: '9' } : rate),
    };
    const cardV2Write = await registerRateCard({
      schemaVersion: '1.0.0', requestId: 'ci03-card-v2', idempotencyKey: 'ci03-card-v2-idem', scope, rateCard: cardV2,
    }, ports);
    assert.equal(cardV2Write.ok, true, cardV2Write.ok ? '' : cardV2Write.error.safe_message);

    const historicalReplay = await callEstimate(oldRequest, ports);
    assert.equal(historicalReplay.status, 'complete');
    assert.equal(historicalReplay.rateCardRef.revision, 1);
    assert.equal(historicalReplay.knownSubtotal, fixture.expected.revision_one_complete_usd, 'later catalog revisions do not change a prior event replay');

    const newEvent = makeEvent(sharedEvent, scope, fixture.selection.revision_two_effective_from);
    const newRequest = requestBase(scope, newEvent, 'ci03-v2-boundary');
    const newEstimate = await callEstimate(newRequest, ports);
    assert.equal(newEstimate.status, 'complete');
    assert.equal(newEstimate.rateCardRef.revision, 2, 'effective start is inclusive');
    assert.equal(newEstimate.knownSubtotal, fixture.expected.revision_two_complete_usd);

    const pinnedOldRate = await callEstimate(requestBase(scope, newEvent, 'ci03-pinned-old-rate', {
      rateCardRef: cardWrite.value.reference,
    }), ports);
    assert.equal(pinnedOldRate.status, 'pricing_unknown', 'a caller cannot force an ineligible cheaper historical card');

    const contractRef = reference('ContractTimeEvidence', 'ci03-contract-time', 'sha256:' + 'c'.repeat(64));
    const contractEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time);
    const contractRequest = requestBase(scope, contractEvent, 'ci03-contract-time', {
      policy: 'contract_time',
      effectiveAt: fixture.selection.contract_time,
      contractTimeEvidenceRef: contractRef,
    });
    const contractPorts = makePorts(pool, scope, clock, {
      contractTimeAuthority: {
        resolve: async () => ({ reference: contractRef, effectiveAt: fixture.selection.contract_time, verified: true }),
      },
    });
    const contractEstimate = await callEstimate(contractRequest, contractPorts);
    assert.equal(contractEstimate.status, 'complete');
    assert.equal(contractEstimate.rateCardRef.revision, 2);
    const mismatchedAuthority = makePorts(pool, scope, clock, {
      contractTimeAuthority: {
        resolve: async () => ({ reference: contractRef, effectiveAt: fixture.selection.event_time, verified: true }),
      },
    });
    const mismatchedContract = await callEstimate(contractRequest, mismatchedAuthority);
    assert.equal(mismatchedContract.status, 'unknown');
    assert.ok(mismatchedContract.missingDimensions.includes('authoritative_contract_time_evidence'));

    const staleEvent = makeEvent(sharedEvent, scope, fixture.selection.stale_event_time);
    const stale = await callEstimate(requestBase(scope, staleEvent, 'ci03-stale'), ports);
    assert.equal(stale.status, 'stale');
    assert.ok(stale.knownSubtotal !== null);
    assert.ok(stale.missingDimensions.includes('stale_rate_or_rule_source'));

    const tinyEvent = makeEvent(sharedEvent, scope, fixture.selection.revision_two_effective_from, {
      input: '0', cached: '0', written: '0', output: '0', reasoning: '0', images: '0', search: '1', zero: '0',
    });
    let totalNumerator = 0n;
    let totalDenominator = 1n;
    for (let index = 0; index < 1000; index += 1) {
      const tiny = await callEstimate(requestBase(scope, tinyEvent, 'ci03-tiny-' + index), ports);
      assert.equal(tiny.status, 'complete');
      assert.equal(tiny.knownSubtotal, fixture.expected.one_tiny_call_usd);
      const numerator = BigInt(tiny.knownSubtotalExact.numerator);
      const denominator = BigInt(tiny.knownSubtotalExact.denominator);
      totalNumerator = totalNumerator * denominator + numerator * totalDenominator;
      totalDenominator *= denominator;
      let a = totalNumerator < 0n ? -totalNumerator : totalNumerator;
      let b = totalDenominator;
      while (b !== 0n) { const rest = a % b; a = b; b = rest; }
      const divisor = a === 0n ? 1n : a;
      totalNumerator /= divisor;
      totalDenominator /= divisor;
    }
    assert.equal(totalNumerator.toString(), '1');
    assert.equal(totalDenominator.toString(), '100');
    assert.equal(fixture.expected.one_thousand_tiny_calls_usd, '0.01');

    await assert.rejects(
      pool.query('UPDATE cost_intelligence.pricing_rate_card_versions SET currency = $1', ['EUR']),
      /append-only/,
    );
    await assert.rejects(pool.query('DELETE FROM cost_intelligence.pricing_rule_versions'), /append-only/);
    await assert.rejects(pool.query('TRUNCATE cost_intelligence.pricing_fx_rate_versions'), /append-only/);

    const ledgerAfter = await pool.query('SELECT count(*)::text AS total FROM cost_intelligence.financial_ledger_events');
    assert.equal(ledgerAfter.rows[0].total, ledgerBefore.rows[0].total, 'pricing remains a non-posting estimate and preserves ledger history');
    const counts = await pool.query(
      'SELECT (SELECT count(*) FROM cost_intelligence.pricing_rule_versions WHERE tenant_id = $1) AS rules,'
        + ' (SELECT count(*) FROM cost_intelligence.pricing_rate_card_versions WHERE tenant_id = $1) AS cards,'
        + ' (SELECT count(*) FROM cost_intelligence.pricing_fx_rate_versions WHERE tenant_id = $1) AS fx',
      [scope.tenantId],
    );
    assert.equal(Number(counts.rows[0].rules), 1);
    assert.equal(Number(counts.rows[0].cards), 2);
    assert.equal(Number(counts.rows[0].fx), 1);
  } finally {
    await pool.end();
  }
});
