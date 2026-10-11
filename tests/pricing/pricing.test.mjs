import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import pg from 'pg';
import { Value } from '@sinclair/typebox/value';
import {
  EstimateRequestSchema,
  EstimateResultV2Schema,
  EstimateResultSchema,
  PricingRuleV2Schema,
  RateCardSchema,
  RateCardV2Schema,
  estimate,
  estimateV2,
  registerFxRateV2,
  registerPricingRuleV2,
  registerRateCardV2,
  validateFxRateV2Boundary,
  validateEstimateRequestBoundary,
  validateEstimateRequestV2Boundary,
  validatePricingRuleV2Boundary,
  validateRateCardV2Boundary,
} from '../../dist/index.js';
import { databaseConfigFromEnvironment } from '../../scripts/test-db-lifecycle.mjs';

const { Pool } = pg;
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const fixturePath = join(root, 'fixtures/pricing/ci03-synthetic-acceptance.json');
const syntheticSourcePath = join(root, 'fixtures/pricing/synthetic-tariff-source.md');
const sharedUsagePath = join(root, 'node_modules/@jevelopers/shared-contracts/fixtures/UsageEvent.json');

function reference(contract, id, hash, revision = 1) {
  return { contract, schema_version: '2.0.0', id, revision, content_hash: hash };
}

function sourceReference(contract, id, hash, revision = 1) {
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
  const defaultActionAuthority = {
    authorize: async ({ scope: authorizedScope, action }) => ({
      decisionId: 'synthetic-pricing-grant:' + action,
      action,
      scope: authorizedScope,
      actorId: authorizedScope.actorId,
      allowed: true,
      issuedAt: new Date(new Date(clock.value).getTime() - 1000).toISOString(),
      expiresAt: new Date(new Date(clock.value).getTime() + 3600000).toISOString(),
    }),
  };
  const actionAuthority = Object.hasOwn(overrides, 'actionAuthority') ? overrides.actionAuthority : defaultActionAuthority;
  const boundEvidenceAuthority = overrides.boundEvidenceAuthority ?? {
    resolve: async ({ scope: authorizedScope, ruleReference, rateCardReference, evidenceReference, effectiveAt, currency }) => ({
      verified: true,
      scope: authorizedScope,
      actorId: authorizedScope.actorId,
      ruleReference,
      rateCardReference,
      evidenceReference,
      policy: 'maximum_marginal_rate',
      effectiveAt,
      currency,
    }),
  };
  return {
    database: overrides.database ?? { connect: () => pool.connect() },
    trustedContext: overrides.trustedContext ?? { resolve: async () => ({ ...scope }) },
    clock: { now: () => new Date(clock.value) },
    ...(actionAuthority ? { actionAuthority } : {}),
    boundEvidenceAuthority,
    ...(overrides.contractTimeAuthority ? { contractTimeAuthority: overrides.contractTimeAuthority } : {}),
    ...(overrides.dimensionEvidenceAuthority ? { dimensionEvidenceAuthority: overrides.dimensionEvidenceAuthority } : {}),
  };
}

function requestBase(scope, event, requestId, selection = {}) {
  const usageEvent = structuredClone(event);
  usageEvent.usage_event_id = '123e4567-e89b-42d3-a456-' + createHash('sha256').update(requestId).digest('hex').slice(0, 12);
  return {
    schemaVersion: '2.0.0',
    requestId,
    idempotencyKey: 'idem-' + requestId,
    scope,
    usageEvent,
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
  const result = await estimateV2(request, ports);
  assert.equal(result.ok, true, result.ok ? '' : result.error.code + ': ' + result.error.safe_message);
  return result.value;
}

test('published pricing 1.0.0 fixtures retain their exact shape while incompatible pricing uses 2.0.0', async () => {
  const compatibility = JSON.parse(await readFile(join(root, 'fixtures/pricing/ci03-v1-compatibility.json'), 'utf8'));
  const current = JSON.parse(await readFile(fixturePath, 'utf8'));
  const sharedEvent = JSON.parse(await readFile(sharedUsagePath, 'utf8')).valid;
  assert.equal(Value.Check(RateCardSchema, compatibility.rate_card), true);
  assert.equal(Value.Check(EstimateResultSchema, compatibility.estimate_result), true);
  assert.equal(Value.Check(RateCardV2Schema, compatibility.rate_card), false);
  assert.equal(Value.Check(RateCardV2Schema, {
    ...current.rate_card,
    pricingRuleRef: {
      contract: 'PricingRule', schema_version: '2.0.0', id: current.pricing_rule.id, revision: current.pricing_rule.revision,
      content_hash: 'sha256:' + 'b'.repeat(64),
    },
  }), true);
  assert.equal(Value.Check(PricingRuleV2Schema, current.pricing_rule), true);
  assert.equal(Value.Check(EstimateResultV2Schema, {
    ...compatibility.estimate_result,
    schemaVersion: '2.0.0',
    selectionPolicy: 'event_time',
    effectiveAt: compatibility.rate_card.effectiveFrom,
    knownSubtotalExact: { numerator: '1', denominator: '500000' },
    rateCardRef: { ...compatibility.versionedReference, schema_version: '2.0.0' },
    pricingRuleRef: {
      contract: 'PricingRule', schema_version: '2.0.0', id: current.pricing_rule.id, revision: current.pricing_rule.revision,
      content_hash: 'sha256:' + 'b'.repeat(64),
    },
    fxRateRef: null,
    fxConvertedSubtotal: null,
    fxConvertedSubtotalExact: null,
    fxTargetCurrency: 'USD',
    boundedConservativeAuthorizationAmountExact: null,
    calculation: [{
      usageUnit: 'input_tokens', category: 'input', quantity: '1', unit: 'token', basisQuantity: '1000000', rate: '2',
      exactAmount: { numerator: '1', denominator: '500000' }, extendedAmount: '0.000002', relation: 'standalone',
    }],
  }), true);

  const scope = {
    tenantId: sharedEvent.tenant_id, projectId: sharedEvent.project_id, environment: sharedEvent.environment,
    billingMode: sharedEvent.billing_mode, actorId: 'ci03-legacy-actor',
  };
  const legacyRequest = {
    schemaVersion: '1.0.0', requestId: 'ci03-legacy-request', idempotencyKey: 'ci03-legacy-idem', scope,
    usageEvent: sharedEvent,
    selection: {
      policy: 'event_time', effectiveAt: sharedEvent.occurred_at, requestedCurrency: 'USD', rateCardRef: null,
    },
  };
  assert.equal(Value.Check(EstimateRequestSchema, legacyRequest), true);
  assert.equal(validateEstimateRequestBoundary(legacyRequest).ok, true);
  assert.equal(validateEstimateRequestV2Boundary(legacyRequest).error.code, 'UNSUPPORTED_VERSION');
  assert.equal(validateEstimateRequestBoundary({ ...legacyRequest, schemaVersion: '2.0.0' }).error.code, 'UNSUPPORTED_VERSION');
  assert.equal(validatePricingRuleV2Boundary({
    schemaVersion: '1.0.0', requestId: 'ci03-legacy-rule', idempotencyKey: 'legacy-rule-idem', scope,
    rule: current.pricing_rule,
  }).error.code, 'UNSUPPORTED_VERSION');
  assert.equal(validatePricingRuleV2Boundary({
    schemaVersion: '2.0.0', requestId: 'ci03-new-rule-through-v1', idempotencyKey: 'new-rule-idem', scope,
    rule: { ...current.pricing_rule, schemaVersion: '1.0.0' },
  }).error.code, 'VALIDATION_ERROR');
  assert.equal(validateRateCardV2Boundary({
    schemaVersion: '1.0.0', requestId: 'ci03-legacy-card', idempotencyKey: 'legacy-card-idem', scope,
    rateCard: compatibility.rate_card,
  }).error.code, 'UNSUPPORTED_VERSION');
  assert.equal(validateFxRateV2Boundary({
    schemaVersion: '1.0.0', requestId: 'ci03-legacy-fx', idempotencyKey: 'legacy-fx-idem', scope,
    fxRate: {},
  }).error.code, 'UNSUPPORTED_VERSION');

  const legacyPorts = {
    trustedContext: { resolve: async () => scope },
    clock: { now: () => new Date('2026-10-11T03:30:10.000Z') },
  };
  const legacyEstimate = await estimate(legacyRequest, legacyPorts);
  assert.equal(legacyEstimate.ok, false);
  assert.equal(legacyEstimate.error.code, 'PRICING_UNKNOWN', 'legacy estimate wire API remains fail-closed without a versioned action grant');

  const scopeMismatch = { ...legacyRequest, scope: { ...scope, projectId: 'different-project' } };
  assert.equal(validateEstimateRequestBoundary(scopeMismatch).ok, true,
    'the original combined boundary validates the 1.0.0 wrapper and nested UsageEvent without adding scope policy');
  const deniedScopeMismatch = await estimate(scopeMismatch, legacyPorts);
  assert.equal(deniedScopeMismatch.ok, false);
  assert.equal(deniedScopeMismatch.error.code, 'FORBIDDEN_SCOPE', 'the legacy operation enforces financial scope before calling its runtime ports');
});

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
      schemaVersion: '2.0.0',
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
      await registerPricingRuleV2(ruleRequest, deniedPorts),
      await registerRateCardV2({
        schemaVersion: '2.0.0', requestId: 'ci03-denied-card', idempotencyKey: 'ci03-denied-card-idem',
        scope, rateCard: { ...structuredClone(fixture.rate_card), pricingRuleRef: reference('PricingRule', 'no-rule', sourceHash) },
      }, deniedPorts),
      await registerFxRateV2({
        schemaVersion: '2.0.0', requestId: 'ci03-denied-fx', idempotencyKey: 'ci03-denied-fx-idem',
        scope, fxRate: structuredClone(fixture.fx_rate),
      }, deniedPorts),
    ]) {
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'FORBIDDEN_SCOPE');
    }

    let deniedConnections = 0;
    const deniedActionPorts = makePorts(pool, scope, clock, {
      database: { connect: async () => { deniedConnections += 1; throw new Error('denied pricing action reached database'); } },
      actionAuthority: { authorize: async () => ({
        decisionId: 'synthetic-deny', action: 'registerPricingRule', scope, actorId: scope.actorId,
        allowed: false, issuedAt: '2026-10-11T03:29:00.000Z', expiresAt: '2026-10-11T04:30:00.000Z',
      }) },
    });
    const deniedEstimate = await estimateV2(requestBase(scope, makeEvent(sharedEvent, scope, fixture.selection.event_time), 'ci03-denied-estimate'), deniedActionPorts);
    assert.equal(deniedEstimate.ok, false);
    assert.equal(deniedEstimate.error.code, 'FORBIDDEN_SCOPE');
    for (const deniedWrite of [
      registerPricingRuleV2(ruleRequest, deniedActionPorts),
      registerRateCardV2({
        schemaVersion: '2.0.0', requestId: 'ci03-denied-card-action', idempotencyKey: 'ci03-denied-card-action-idem',
        scope, rateCard: { ...structuredClone(fixture.rate_card), pricingRuleRef: reference('PricingRule', 'no-rule', sourceHash) },
      }, deniedActionPorts),
      registerFxRateV2({
        schemaVersion: '2.0.0', requestId: 'ci03-denied-fx-action', idempotencyKey: 'ci03-denied-fx-action-idem',
        scope, fxRate: structuredClone(fixture.fx_rate),
      }, deniedActionPorts),
    ]) {
      const deniedWriteResult = await deniedWrite;
      assert.equal(deniedWriteResult.ok, false);
      assert.equal(deniedWriteResult.error.code, 'FORBIDDEN_SCOPE');
    }
    assert.equal(deniedConnections, 0, 'denied estimates and all three catalog writes fail before opening the database');

    const badGrantCases = [
      { label: 'missing', authority: null, code: 'SOURCE_UNAVAILABLE' },
      { label: 'wrong action', authority: { authorize: async ({ scope: value }) => ({
        decisionId: 'wrong-action', action: 'registerRateCard', scope: value, actorId: value.actorId,
        allowed: true, issuedAt: '2026-10-11T03:29:00.000Z', expiresAt: '2026-10-11T04:30:00.000Z',
      }) }, code: 'FORBIDDEN_SCOPE' },
      { label: 'wrong scope', authority: { authorize: async ({ scope: value, action }) => ({
        decisionId: 'wrong-scope', action, scope: { ...value, projectId: 'another-project' }, actorId: value.actorId,
        allowed: true, issuedAt: '2026-10-11T03:29:00.000Z', expiresAt: '2026-10-11T04:30:00.000Z',
      }) }, code: 'FORBIDDEN_SCOPE' },
      { label: 'stale grant', authority: { authorize: async ({ scope: value, action }) => ({
        decisionId: 'stale-grant', action, scope: value, actorId: value.actorId,
        allowed: true, issuedAt: '2026-10-11T03:20:00.000Z', expiresAt: '2026-10-11T03:29:00.000Z',
      }) }, code: 'FORBIDDEN_SCOPE' },
      { label: 'throwing authority', authority: { authorize: async () => { throw new Error('issuer unavailable'); } }, code: 'SOURCE_UNAVAILABLE' },
    ];
    for (const testCase of badGrantCases) {
      const result = await estimateV2(
        requestBase(scope, makeEvent(sharedEvent, scope, fixture.selection.event_time), 'ci03-' + testCase.label.replaceAll(' ', '-')),
        makePorts(pool, scope, clock, {
          database: { connect: async () => { deniedConnections += 1; throw new Error('invalid grant reached database'); } },
          actionAuthority: testCase.authority,
        }),
      );
      assert.equal(result.ok, false, testCase.label);
      assert.equal(result.error.code, testCase.code, testCase.label);
    }
    assert.equal(deniedConnections, 0, 'missing, stale, wrong-action, cross-scope and throwing authorities open zero database connections');

    const ruleWrite = await registerPricingRuleV2(ruleRequest, ports);
    assert.equal(ruleWrite.ok, true, ruleWrite.ok ? '' : ruleWrite.error.safe_message);
    assert.equal(ruleWrite.value.status, 'accepted');
    assert.equal(ruleWrite.value.reference.contract, 'PricingRule');
    const ruleReplay = await registerPricingRuleV2(ruleRequest, ports);
    assert.equal(ruleReplay.ok, true);
    assert.equal(ruleReplay.value.status, 'duplicate', 'same idempotency key and content is a replay');
    const ruleAlternateKey = await registerPricingRuleV2({
      ...ruleRequest, requestId: 'ci03-rule-alt-key', idempotencyKey: 'ci03-rule-alt-key-idem',
    }, ports);
    assert.equal(ruleAlternateKey.ok, true);
    assert.equal(ruleAlternateKey.value.status, 'duplicate');
    const changedRuleAlternateKey = await registerPricingRuleV2({
      ...ruleRequest, requestId: 'ci03-rule-alt-key-changed', idempotencyKey: 'ci03-rule-alt-key-idem',
      rule: { ...rule, id: 'ci03-different-rule' },
    }, ports);
    assert.equal(changedRuleAlternateKey.ok, false);
    assert.equal(changedRuleAlternateKey.error.code, 'IDEMPOTENCY_CONFLICT', 'a successful alternate key remains bound to its original immutable payload');

    const concurrentRuleResults = await Promise.all([1, 2].map(index => registerPricingRuleV2({
      schemaVersion: '2.0.0', requestId: 'ci03-concurrent-rule-' + index,
      idempotencyKey: 'ci03-concurrent-rule-shared-idem', scope,
      rule: { ...structuredClone(rule), id: 'ci03-concurrent-rule-' + index },
    }, ports)));
    assert.equal(concurrentRuleResults.filter(result => result.ok).length, 1,
      'the same concurrent operation key can durably bind to only one payload');
    assert.equal(concurrentRuleResults.filter(result => !result.ok && result.error.code === 'IDEMPOTENCY_CONFLICT').length, 1);

    const doubleBillRule = {
      ...structuredClone(rule), id: 'ci03-invalid-double-bill-rule',
      usageUnits: rule.usageUnits.map(item => item.name === 'input_tokens' ? { ...item, treatment: 'charge_total' } : item),
    };
    const doubleBillWrite = await registerPricingRuleV2({
      schemaVersion: '2.0.0', requestId: 'ci03-invalid-double-bill', idempotencyKey: 'ci03-invalid-double-bill-idem', scope,
      rule: doubleBillRule,
    }, ports);
    assert.equal(doubleBillWrite.ok, false);
    assert.equal(doubleBillWrite.error.code, 'VALIDATION_ERROR', 'total plus separately priced included children are rejected at the write boundary');

    const card = {
      ...structuredClone(fixture.rate_card),
      pricingRuleRef: ruleWrite.value.reference,
    };
    const cardRequest = {
      schemaVersion: '2.0.0',
      requestId: 'ci03-card-v1',
      idempotencyKey: 'ci03-card-v1-idem',
      scope,
      rateCard: card,
    };
    const cardWrite = await registerRateCardV2(cardRequest, ports);
    assert.equal(cardWrite.ok, true, cardWrite.ok ? '' : cardWrite.error.safe_message);
    assert.equal(cardWrite.value.reference.contract, 'RateCard');

    const endedRule = {
      ...structuredClone(rule), id: 'ci03-explicit-end-rule', effectiveTo: '2026-10-11T03:30:15.000Z',
    };
    const endedRuleWrite = await registerPricingRuleV2({
      schemaVersion: '2.0.0', requestId: 'ci03-explicit-end-rule', idempotencyKey: 'ci03-explicit-end-rule-idem',
      scope, rule: endedRule,
    }, ports);
    assert.equal(endedRuleWrite.ok, true, endedRuleWrite.ok ? '' : endedRuleWrite.error.safe_message);
    const endedCard = {
      ...structuredClone(card), id: 'ci03-explicit-end-card', modelOrSku: 'ci03-explicit-end-model', aliases: [],
      pricingRuleRef: endedRuleWrite.value.reference, effectiveTo: endedRule.effectiveTo,
    };
    const endedCardWrite = await registerRateCardV2({
      schemaVersion: '2.0.0', requestId: 'ci03-explicit-end-card', idempotencyKey: 'ci03-explicit-end-card-idem',
      scope, rateCard: endedCard,
    }, ports);
    assert.equal(endedCardWrite.ok, true, endedCardWrite.ok ? '' : endedCardWrite.error.safe_message);
    const justBeforeExplicitEnd = await callEstimate(requestBase(scope, makeEvent(sharedEvent, scope,
      '2026-10-11T03:30:14.999Z', { model: endedCard.modelOrSku }), 'ci03-explicit-end-before'), ports);
    assert.equal(justBeforeExplicitEnd.status, 'complete');
    const atExplicitEnd = await callEstimate(requestBase(scope, makeEvent(sharedEvent, scope,
      endedRule.effectiveTo, { model: endedCard.modelOrSku }), 'ci03-explicit-end-at-boundary'), ports);
    assert.equal(atExplicitEnd.status, 'pricing_unknown', 'explicit effective ends are exclusive for both the card and its pinned rule');

    const reviewOracle = fixture.review_oracle;
    const reviewOracleRates = {
      input_ordinary: reviewOracle.rates_per_million.ordinary,
      cached_input: reviewOracle.rates_per_million.cached,
      cache_write: reviewOracle.rates_per_million.cache_write,
      output: reviewOracle.rates_per_million.output,
    };
    const reviewOracleUsageUnits = [
      unit('input_tokens', reviewOracle.usage.input_total),
      unit('cached_tokens', reviewOracle.usage.cached_input, 'included_subset', 'input_tokens'),
      unit('cache_write_tokens', reviewOracle.usage.cache_write, 'included_subset', 'input_tokens'),
      unit('output_tokens', reviewOracle.usage.output_total),
      unit('reasoning_tokens', reviewOracle.usage.reasoning_subset, 'included_subset', 'output_tokens'),
      unit('image_input_units', '0'), unit('file_search_calls', '0'), unit('zero_tariff_calls', '0'),
    ];
    const reviewOracleCard = {
      ...card,
      id: 'ci03-review-oracle-card',
      modelOrSku: 'ci03-review-oracle-model',
      aliases: [],
      unitRates: card.unitRates.map(rate => Object.hasOwn(reviewOracleRates, rate.category)
        ? { ...rate, rate: reviewOracleRates[rate.category] } : rate),
    };
    const reviewOracleCardWrite = await registerRateCardV2({
      schemaVersion: '2.0.0', requestId: 'ci03-review-oracle-card', idempotencyKey: 'ci03-review-oracle-card-idem',
      scope, rateCard: reviewOracleCard,
    }, ports);
    assert.equal(reviewOracleCardWrite.ok, true, reviewOracleCardWrite.ok ? '' : reviewOracleCardWrite.error.safe_message);
    const reviewOracleEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      model: reviewOracleCard.modelOrSku, usageUnits: reviewOracleUsageUnits,
    });
    const reviewOracleEstimate = await callEstimate(
      requestBase(scope, reviewOracleEvent, 'ci03-review-oracle-complete'), ports,
    );
    assert.equal(reviewOracleEstimate.status, 'complete');
    assert.equal(reviewOracleEstimate.knownSubtotal, reviewOracle.expected.complete_usd);

    const missingCachedRateCard = {
      ...reviewOracleCard,
      id: 'ci03-review-oracle-missing-cache-rate-card',
      modelOrSku: 'ci03-review-oracle-missing-cache-rate-model',
      unitRates: reviewOracleCard.unitRates.filter(rate => rate.category !== 'cached_input'),
    };
    const missingCachedRateCardWrite = await registerRateCardV2({
      schemaVersion: '2.0.0', requestId: 'ci03-review-oracle-missing-cache-rate',
      idempotencyKey: 'ci03-review-oracle-missing-cache-rate-idem', scope,
      rateCard: missingCachedRateCard,
    }, ports);
    assert.equal(missingCachedRateCardWrite.ok, true,
      missingCachedRateCardWrite.ok ? '' : missingCachedRateCardWrite.error.safe_message);
    const missingCachedRateEstimate = await callEstimate(requestBase(scope, makeEvent(
      sharedEvent, scope, fixture.selection.event_time, {
        model: missingCachedRateCard.modelOrSku, usageUnits: reviewOracleUsageUnits,
      },
    ), 'ci03-review-oracle-missing-cache-rate'), ports);
    assert.equal(missingCachedRateEstimate.status, 'partial');
    assert.equal(missingCachedRateEstimate.knownSubtotal, reviewOracle.expected.missing_cached_rate_partial_usd);
    assert.ok(missingCachedRateEstimate.missingDimensions.includes('rate_category:cached_input'));
    assert.equal(missingCachedRateEstimate.calculation.some(line => line.category === 'cached_input'), false);

    const cardAlternateKey = await registerRateCardV2({
      ...cardRequest, requestId: 'ci03-card-alt-key', idempotencyKey: 'ci03-card-alt-key-idem',
    }, ports);
    assert.equal(cardAlternateKey.ok, true);
    assert.equal(cardAlternateKey.value.status, 'duplicate');
    const changedCardAlternateKey = await registerRateCardV2({
      ...cardRequest, requestId: 'ci03-card-alt-key-changed', idempotencyKey: 'ci03-card-alt-key-idem',
      rateCard: { ...card, id: 'ci03-different-card' },
    }, ports);
    assert.equal(changedCardAlternateKey.ok, false);
    assert.equal(changedCardAlternateKey.error.code, 'IDEMPOTENCY_CONFLICT');
    const changedUnderSameKey = await registerRateCardV2({
      ...cardRequest,
      rateCard: { ...card, unitRates: card.unitRates.map(rate => rate.category === 'output' ? { ...rate, rate: '99' } : rate) },
    }, ports);
    assert.equal(changedUnderSameKey.ok, false);
    assert.equal(changedUnderSameKey.error.code, 'IDEMPOTENCY_CONFLICT');

    const fxRequest = {
      schemaVersion: '2.0.0',
      requestId: 'ci03-fx-v1',
      idempotencyKey: 'ci03-fx-v1-idem',
      scope,
      fxRate: structuredClone(fixture.fx_rate),
    };
    const fxWrite = await registerFxRateV2(fxRequest, ports);
    assert.equal(fxWrite.ok, true, fxWrite.ok ? '' : fxWrite.error.safe_message);
    assert.equal(fxWrite.value.reference.contract, 'FxRate');
    const fxAlternateKey = await registerFxRateV2({
      ...fxRequest, requestId: 'ci03-fx-alt-key', idempotencyKey: 'ci03-fx-alt-key-idem',
    }, ports);
    assert.equal(fxAlternateKey.ok, true);
    assert.equal(fxAlternateKey.value.status, 'duplicate');
    const changedFxAlternateKey = await registerFxRateV2({
      ...fxRequest, requestId: 'ci03-fx-alt-key-changed', idempotencyKey: 'ci03-fx-alt-key-idem',
      fxRate: { ...fxRequest.fxRate, id: 'ci03-different-fx' },
    }, ports);
    assert.equal(changedFxAlternateKey.ok, false);
    assert.equal(changedFxAlternateKey.error.code, 'IDEMPOTENCY_CONFLICT');

    const oldEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time);
    const oldRequest = requestBase(scope, oldEvent, 'ci03-old-replay');
    assert.equal(validateEstimateRequestV2Boundary(oldRequest).ok, true);
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

    const absentNotApplicableSubsetEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      usageUnits: normalUsageUnits().filter(item => item.name !== 'cache_write_tokens'),
    });
    const absentNotApplicableSubset = await callEstimate(
      requestBase(scope, absentNotApplicableSubsetEvent, 'ci03-absent-not-applicable-cache-write'), ports,
    );
    assert.equal(absentNotApplicableSubset.status, 'complete');
    assert.equal(absentNotApplicableSubset.calculation.find(line => line.usageUnit === 'input_tokens').quantity, '80');
    assert.equal(absentNotApplicableSubset.knownSubtotal, '0.00034');
    assert.equal(absentNotApplicableSubset.missingDimensions.length, 0,
      'an absent not_applicable child contributes zero subsets and leaves the priceable parent in the residual calculation');

    const missingRequiredCache = await callEstimate(requestBase(scope, makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      usageUnits: normalUsageUnits().filter(item => item.name !== 'cached_tokens'),
    }), 'ci03-missing-required-cache'), ports);
    assert.equal(missingRequiredCache.status, 'partial');
    assert.ok(missingRequiredCache.missingDimensions.includes('usage:cached_tokens'));
    assert.equal(missingRequiredCache.calculation.some(line => line.usageUnit === 'input_tokens'), false,
      'a missing required child prevents pricing its parent residual');

    const notApplicableRule = {
      ...structuredClone(rule),
      id: 'ci03-na-cache-rule',
      usageUnits: rule.usageUnits.map(item => item.name === 'cached_tokens'
        ? { ...item, missingPolicy: 'not_applicable' } : item),
    };
    const notApplicableRuleWrite = await registerPricingRuleV2({
      schemaVersion: '2.0.0', requestId: 'ci03-na-cache-rule', idempotencyKey: 'ci03-na-cache-rule-idem',
      scope, rule: notApplicableRule,
    }, ports);
    assert.equal(notApplicableRuleWrite.ok, true, notApplicableRuleWrite.ok ? '' : notApplicableRuleWrite.error.safe_message);
    const notApplicableCard = {
      ...reviewOracleCard,
      id: 'ci03-na-cache-card',
      modelOrSku: 'ci03-na-cache-model',
      aliases: [],
      pricingRuleRef: notApplicableRuleWrite.value.reference,
    };
    const notApplicableCardWrite = await registerRateCardV2({
      schemaVersion: '2.0.0', requestId: 'ci03-na-cache-card', idempotencyKey: 'ci03-na-cache-card-idem',
      scope, rateCard: notApplicableCard,
    }, ports);
    assert.equal(notApplicableCardWrite.ok, true, notApplicableCardWrite.ok ? '' : notApplicableCardWrite.error.safe_message);
    const notApplicableCacheEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      model: notApplicableCard.modelOrSku,
      usageUnits: normalUsageUnits().filter(item => item.name !== 'cached_tokens'),
    });
    const notApplicableCache = await callEstimate(
      requestBase(scope, notApplicableCacheEvent, 'ci03-na-cache-absent'), ports,
    );
    assert.equal(notApplicableCache.status, 'complete');
    assert.equal(notApplicableCache.calculation.find(line => line.usageUnit === 'input_tokens').quantity, '90');
    const reviewOracleNotApplicable = await callEstimate(requestBase(scope, makeEvent(
      sharedEvent, scope, fixture.selection.event_time, {
        model: notApplicableCard.modelOrSku,
        usageUnits: reviewOracleUsageUnits.filter(item => item.name !== 'cached_tokens'),
      },
    ), 'ci03-review-oracle-cache-not-applicable'), ports);
    assert.equal(reviewOracleNotApplicable.status, 'complete');
    assert.equal(reviewOracleNotApplicable.knownSubtotal, reviewOracle.expected.not_applicable_cached_absent_usd);
    const multipleNotApplicable = await callEstimate(requestBase(scope, makeEvent(sharedEvent, scope,
      fixture.selection.event_time, {
        model: notApplicableCard.modelOrSku,
        usageUnits: normalUsageUnits().filter(item => item.name !== 'cached_tokens' && item.name !== 'cache_write_tokens'),
      }), 'ci03-na-multiple-partitions-absent'), ports);
    assert.equal(multipleNotApplicable.status, 'complete');
    assert.equal(multipleNotApplicable.calculation.find(line => line.usageUnit === 'input_tokens').quantity, '100');
    const invalidObservedNotApplicable = await callEstimate(requestBase(scope, makeEvent(sharedEvent, scope,
      fixture.selection.event_time, {
        model: notApplicableCard.modelOrSku,
        usageUnits: normalUsageUnits().map(item => item.name === 'cached_tokens'
          ? unit('cached_tokens', item.quantity, 'standalone') : item),
      }), 'ci03-na-invalid-observed-partition'), ports);
    assert.equal(invalidObservedNotApplicable.status, 'partial');
    assert.ok(invalidObservedNotApplicable.missingDimensions.includes('usage_relation_mismatch:cached_tokens'));
    assert.equal(invalidObservedNotApplicable.calculation.some(line => line.usageUnit === 'input_tokens'), false,
      'an observed but invalid not_applicable child cannot be silently treated as absent');

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

    const duplicatedUnitEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      extraUnits: [unit('input_tokens', '100')],
    });
    const duplicatedUnit = await callEstimate(requestBase(scope, duplicatedUnitEvent, 'ci03-duplicate-usage-unit'), ports);
    assert.equal(duplicatedUnit.status, 'partial');
    assert.ok(duplicatedUnit.missingDimensions.includes('duplicate_usage_unit:input_tokens'));
    assert.equal(duplicatedUnit.calculation.some(line => line.usageUnit === 'input_tokens'), false,
      'ambiguous repeated input totals are not included in the known subtotal');

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
      dimensionsEvidenceRef: sourceReference('PricingUsageDimensionEvidence', tierEvidenceId, evidenceHash),
    }), ports);
    assert.equal(unsupportedTier.status, 'unknown', 'an unverified tier cannot fall through to a default card');

    const cheapCard = {
      ...card,
      id: 'ci03-synthetic-cheap-tier-card',
      serviceTier: 'cheap',
      unitRates: card.unitRates.map(rate => ({ ...rate, rate: '0' })),
    };
    const cheapCardWrite = await registerRateCardV2({
      schemaVersion: '2.0.0', requestId: 'ci03-cheap-card', idempotencyKey: 'ci03-cheap-card-idem', scope,
      rateCard: cheapCard,
    }, ports);
    assert.equal(cheapCardWrite.ok, true, cheapCardWrite.ok ? '' : cheapCardWrite.error.safe_message);
    const dimensions = { contextTier: null, serviceTier: 'cheap', reasoningMode: null, toolClass: null };
    const exactDimensionPort = overrides => ({
      resolve: async args => ({
        verified: true,
        scope: args.scope,
        actorId: args.actorId,
        usageEventId: args.usageEvent.usage_event_id,
        reference: args.reference,
        dimensions,
        ...overrides,
      }),
    });
    const positiveTierRequest = requestBase(scope, tierEvent, 'ci03-tier-source-bound', {
      serviceTier: 'cheap', dimensionsEvidenceRef: sourceReference('PricingUsageDimensionEvidence', tierEvidenceId, evidenceHash),
    });
    const positiveTier = await callEstimate(positiveTierRequest, makePorts(pool, scope, clock, {
      dimensionEvidenceAuthority: exactDimensionPort({}),
    }));
    assert.equal(positiveTier.status, 'complete');
    assert.equal(positiveTier.knownSubtotal, '0');
    assert.equal(positiveTier.rateCardRef.id, cheapCard.id, 'a cheap tariff is selectable only with exact scoped source resolution');

    const changedDimensionCases = [
      ['service', { serviceTier: 'fast' }, dimensions],
      ['context', { contextTier: 'long' }, dimensions],
      ['reasoning', { reasoningMode: 'high' }, dimensions],
      ['tool', { toolClass: 'browser' }, dimensions],
    ];
    for (const [label, requested, resolvedDimensions] of changedDimensionCases) {
      const changed = await callEstimate(requestBase(scope, tierEvent, 'ci03-tier-changed-' + label, {
        ...requested, serviceTier: requested.serviceTier ?? 'cheap',
        dimensionsEvidenceRef: sourceReference('PricingUsageDimensionEvidence', tierEvidenceId, evidenceHash),
      }), makePorts(pool, scope, clock, {
        dimensionEvidenceAuthority: exactDimensionPort({ dimensions: resolvedDimensions }),
      }));
      assert.equal(changed.status, 'unknown', label + ' values must match the source-bound dimensions exactly');
      assert.equal(changed.rateCardRef, null);
    }
    const wrongDimensionReference = await callEstimate(requestBase(scope, tierEvent, 'ci03-tier-wrong-contract', {
      serviceTier: 'cheap', dimensionsEvidenceRef: sourceReference('UnrelatedDocument', tierEvidenceId, evidenceHash, 999),
    }), makePorts(pool, scope, clock, { dimensionEvidenceAuthority: exactDimensionPort({}) }));
    assert.equal(wrongDimensionReference.status, 'unknown', 'an unrelated reference contract and revision cannot assert a cheaper tier');
    const wrongRevisionReference = await callEstimate(requestBase(scope, tierEvent, 'ci03-tier-wrong-revision', {
      serviceTier: 'cheap', dimensionsEvidenceRef: sourceReference('PricingUsageDimensionEvidence', tierEvidenceId, evidenceHash, 999),
    }), makePorts(pool, scope, clock, {
      dimensionEvidenceAuthority: exactDimensionPort({ reference: sourceReference('PricingUsageDimensionEvidence', tierEvidenceId, evidenceHash, 1) }),
    }));
    assert.equal(wrongRevisionReference.status, 'unknown');
    const crossEventReference = await callEstimate(requestBase(scope, tierEvent, 'ci03-tier-cross-event', {
      serviceTier: 'cheap', dimensionsEvidenceRef: sourceReference('PricingUsageDimensionEvidence', tierEvidenceId, evidenceHash),
    }), makePorts(pool, scope, clock, { dimensionEvidenceAuthority: exactDimensionPort({ usageEventId: 'another-usage-event' }) }));
    assert.equal(crossEventReference.status, 'unknown', 'dimension evidence cannot be replayed across usage events');

    const boundRule = {
      ...structuredClone(rule),
      id: 'ci03-finite-bound-rule',
      usageSemantics: 'Synthetic pairwise-disjoint input partition supporting a maximum marginal-rate upper bound.',
      usageUnits: rule.usageUnits.filter(item => ['input_tokens', 'cached_tokens', 'cache_write_tokens', 'output_tokens', 'reasoning_tokens'].includes(item.name)),
    };
    const boundRuleWrite = await registerPricingRuleV2({
      schemaVersion: '2.0.0', requestId: 'ci03-bound-rule', idempotencyKey: 'ci03-bound-rule-idem', scope, rule: boundRule,
    }, ports);
    assert.equal(boundRuleWrite.ok, true, boundRuleWrite.ok ? '' : boundRuleWrite.error.safe_message);
    const boundRates = {
      input_ordinary: '1', cached_input: '0.1', cache_write: '2', output: '4',
    };
    const boundCard = {
      ...card,
      id: 'ci03-finite-bound-card',
      modelOrSku: 'ci03-finite-bound-model',
      aliases: [],
      pricingRuleRef: boundRuleWrite.value.reference,
      unitRates: card.unitRates
        .filter(rate => Object.hasOwn(boundRates, rate.category))
        .map(rate => ({ ...rate, rate: boundRates[rate.category] })),
    };
    const boundCardWrite = await registerRateCardV2({
      schemaVersion: '2.0.0', requestId: 'ci03-bound-card', idempotencyKey: 'ci03-bound-card-idem', scope,
      rateCard: boundCard,
    }, ports);
    assert.equal(boundCardWrite.ok, true, boundCardWrite.ok ? '' : boundCardWrite.error.safe_message);
    const boundEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      model: 'ci03-finite-bound-model',
      usageUnits: [
        unit('input_tokens', '1000'),
        unit('cache_write_tokens', '100', 'included_subset', 'input_tokens'),
        unit('output_tokens', '500'),
        unit('reasoning_tokens', '0', 'included_subset', 'output_tokens'),
      ],
    });
    const boundEstimate = await callEstimate(requestBase(scope, boundEvent, 'ci03-positive-conservative-bound'), ports);
    assert.equal(boundEstimate.status, 'partial');
    assert.equal(boundEstimate.knownSubtotal, fixture.expected.conservative_bound_missing_cached.known_usd);
    assert.deepEqual(boundEstimate.knownSubtotalExact, { numerator: '11', denominator: '5000' });
    assert.equal(boundEstimate.boundedConservativeAuthorizationAmount, fixture.expected.conservative_bound_missing_cached.bound_usd);
    assert.deepEqual(boundEstimate.boundedConservativeAuthorizationAmountExact, { numerator: '31', denominator: '10000' });
    assert.ok(boundEstimate.missingDimensions.includes('usage:cached_tokens'));

    const multiGroupRule = {
      ...structuredClone(boundRule),
      id: 'ci03-multigroup-bound-rule',
      usageUnits: boundRule.usageUnits.map(item => {
        if (item.name === 'output_tokens') return { ...item, treatment: 'charge_residual' };
        if (item.name === 'reasoning_tokens') {
          return { ...item, category: 'reasoning', treatment: 'charge_subset', missingPolicy: 'required' };
        }
        return item;
      }),
      partitionGroups: [...boundRule.partitionGroups, {
        parent: 'output_tokens',
        separatelyPricedMembers: ['reasoning_tokens'],
        semantics: 'pairwise_disjoint_included_subsets',
        conservativeBound: {
          policy: 'maximum_marginal_rate',
          evidenceRef: sourceReference('SyntheticPricingPartitionEvidence', 'ci03-output-partition-evidence', 'sha256:' + 'e'.repeat(64)),
        },
      }],
    };
    const multiGroupRuleWrite = await registerPricingRuleV2({
      schemaVersion: '2.0.0', requestId: 'ci03-multigroup-rule', idempotencyKey: 'ci03-multigroup-rule-idem',
      scope, rule: multiGroupRule,
    }, ports);
    assert.equal(multiGroupRuleWrite.ok, true, multiGroupRuleWrite.ok ? '' : multiGroupRuleWrite.error.safe_message);
    const multiGroupRates = [
      { category: 'input_ordinary', unit: 'token', basisQuantity: '1000000', rate: '1', relation: 'standalone' },
      { category: 'cached_input', unit: 'token', basisQuantity: '1000000', rate: '0.1', relation: 'included_subset', includedIn: 'input_tokens' },
      { category: 'cache_write', unit: 'token', basisQuantity: '1000000', rate: '2', relation: 'included_subset', includedIn: 'input_tokens' },
      { category: 'output', unit: 'token', basisQuantity: '1000000', rate: '4', relation: 'standalone' },
    ];
    const multiGroupCard = {
      ...boundCard,
      id: 'ci03-multigroup-no-reasoning-rate-card',
      modelOrSku: 'ci03-multigroup-no-reasoning-rate-model',
      pricingRuleRef: multiGroupRuleWrite.value.reference,
      unitRates: multiGroupRates,
    };
    const multiGroupCardWrite = await registerRateCardV2({
      schemaVersion: '2.0.0', requestId: 'ci03-multigroup-no-reasoning-rate-card',
      idempotencyKey: 'ci03-multigroup-no-reasoning-rate-card-idem', scope, rateCard: multiGroupCard,
    }, ports);
    assert.equal(multiGroupCardWrite.ok, true, multiGroupCardWrite.ok ? '' : multiGroupCardWrite.error.safe_message);
    const multiGroupMissingEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      model: multiGroupCard.modelOrSku,
      usageUnits: [unit('input_tokens', '1000'), unit('cache_write_tokens', '100', 'included_subset', 'input_tokens'), unit('output_tokens', '500')],
    });
    const multiGroupMissing = await callEstimate(requestBase(scope, multiGroupMissingEvent, 'ci03-multigroup-unpriced-bound'), ports);
    assert.equal(multiGroupMissing.status, 'partial');
    assert.equal(multiGroupMissing.knownSubtotal, '0.0002');
    assert.ok(multiGroupMissing.missingDimensions.includes('usage:cached_tokens'));
    assert.ok(multiGroupMissing.missingDimensions.includes('usage:reasoning_tokens'));
    assert.equal(multiGroupMissing.boundedConservativeAuthorizationAmount, null,
      'an unpriced output family makes a finite whole-estimate cap unavailable even when another partition is bounded');
    assert.equal(multiGroupMissing.boundedConservativeAuthorizationAmountExact, null);

    const multiGroupZeroCard = {
      ...multiGroupCard,
      id: 'ci03-multigroup-reasoning-zero-rate-card',
      modelOrSku: 'ci03-multigroup-reasoning-zero-rate-model',
      unitRates: [...multiGroupRates, {
        category: 'reasoning', unit: 'token', basisQuantity: '1000000', rate: '0',
        relation: 'included_subset', includedIn: 'output_tokens',
      }],
    };
    const multiGroupZeroCardWrite = await registerRateCardV2({
      schemaVersion: '2.0.0', requestId: 'ci03-multigroup-reasoning-zero-card',
      idempotencyKey: 'ci03-multigroup-reasoning-zero-card-idem', scope, rateCard: multiGroupZeroCard,
    }, ports);
    assert.equal(multiGroupZeroCardWrite.ok, true, multiGroupZeroCardWrite.ok ? '' : multiGroupZeroCardWrite.error.safe_message);
    const multiGroupZeroEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      model: multiGroupZeroCard.modelOrSku,
      usageUnits: [
        unit('input_tokens', '1000'), unit('cache_write_tokens', '100', 'included_subset', 'input_tokens'),
        unit('output_tokens', '500'), unit('reasoning_tokens', '0', 'included_subset', 'output_tokens'),
      ],
    });
    const multiGroupZero = await callEstimate(requestBase(scope, multiGroupZeroEvent, 'ci03-multigroup-zero-output-family'), ports);
    assert.equal(multiGroupZero.knownSubtotal, '0.0022', 'an explicit zero reasoning quantity does not suppress the output total');
    assert.ok(multiGroupZero.calculation.some(line => line.usageUnit === 'output_tokens' && line.extendedAmount === '0.002'));
    assert.equal(multiGroupZero.boundedConservativeAuthorizationAmount, '0.0031',
      'an observed zero reasoning quantity leaves the output subtotal visible and the input partition cap remains conservative');

    const multiGroupBoundCard = {
      ...multiGroupZeroCard,
      id: 'ci03-multigroup-two-bounded-card',
      modelOrSku: 'ci03-multigroup-two-bounded-model',
    };
    const multiGroupBoundCardWrite = await registerRateCardV2({
      schemaVersion: '2.0.0', requestId: 'ci03-multigroup-two-bounded-card',
      idempotencyKey: 'ci03-multigroup-two-bounded-card-idem', scope, rateCard: multiGroupBoundCard,
    }, ports);
    assert.equal(multiGroupBoundCardWrite.ok, true, multiGroupBoundCardWrite.ok ? '' : multiGroupBoundCardWrite.error.safe_message);
    const multiGroupBothMissing = makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      model: multiGroupBoundCard.modelOrSku,
      usageUnits: [unit('input_tokens', '1000'), unit('cache_write_tokens', '100', 'included_subset', 'input_tokens'), unit('output_tokens', '500')],
    });
    const multiGroupBound = await callEstimate(requestBase(scope, multiGroupBothMissing, 'ci03-multigroup-two-bounded-groups'), ports);
    assert.equal(multiGroupBound.knownSubtotal, '0.0002');
    assert.equal(multiGroupBound.boundedConservativeAuthorizationAmount, '0.0031',
      'separately verified group bounds are each added exactly once to the known subtotal');
    assert.deepEqual(multiGroupBound.boundedConservativeAuthorizationAmountExact, { numerator: '31', denominator: '10000' });

    const fractionalBoundEvidence = sourceReference(
      'SyntheticPricingPartitionEvidence', 'ci03-fractional-bound-evidence', 'sha256:' + 'd'.repeat(64),
    );
    const fractionalBoundRule = {
      ...structuredClone(boundRule),
      id: 'ci03-fractional-bound-rule',
      partitionGroups: [{
        parent: 'input_tokens',
        separatelyPricedMembers: ['cached_tokens'],
        semantics: 'pairwise_disjoint_included_subsets',
        conservativeBound: { policy: 'maximum_marginal_rate', evidenceRef: fractionalBoundEvidence },
      }],
      usageUnits: boundRule.usageUnits.filter(item => ['input_tokens', 'cached_tokens', 'output_tokens'].includes(item.name)),
    };
    const fractionalBoundRuleWrite = await registerPricingRuleV2({
      schemaVersion: '2.0.0', requestId: 'ci03-fractional-bound-rule', idempotencyKey: 'ci03-fractional-bound-rule-idem',
      scope, rule: fractionalBoundRule,
    }, ports);
    assert.equal(fractionalBoundRuleWrite.ok, true,
      fractionalBoundRuleWrite.ok ? '' : fractionalBoundRuleWrite.error.safe_message);
    const fractionalBoundCard = {
      ...boundCard,
      id: 'ci03-fractional-bound-card',
      modelOrSku: 'ci03-fractional-bound-model',
      pricingRuleRef: fractionalBoundRuleWrite.value.reference,
      unitRates: [
        { category: 'input_ordinary', unit: 'token', basisQuantity: '10', rate: '0.000000000000000001', relation: 'standalone' },
        { category: 'cached_input', unit: 'token', basisQuantity: '10', rate: '0.000000000000000001', relation: 'included_subset', includedIn: 'input_tokens' },
        { category: 'output', unit: 'token', basisQuantity: '1', rate: '0', relation: 'standalone' },
      ],
    };
    const fractionalBoundCardWrite = await registerRateCardV2({
      schemaVersion: '2.0.0', requestId: 'ci03-fractional-bound-card', idempotencyKey: 'ci03-fractional-bound-card-idem',
      scope, rateCard: fractionalBoundCard,
    }, ports);
    assert.equal(fractionalBoundCardWrite.ok, true,
      fractionalBoundCardWrite.ok ? '' : fractionalBoundCardWrite.error.safe_message);
    const fractionalBoundEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      model: fractionalBoundCard.modelOrSku,
      usageUnits: [unit('input_tokens', '1'), unit('output_tokens', '1')],
    });
    const fractionalBound = await callEstimate(
      requestBase(scope, fractionalBoundEvent, 'ci03-fractional-bound-ceiling'), ports,
    );
    assert.equal(fractionalBound.status, 'partial');
    assert.equal(fractionalBound.knownSubtotal, '0');
    assert.deepEqual(fractionalBound.boundedConservativeAuthorizationAmountExact, {
      numerator: '1', denominator: '10000000000000000000',
    });
    assert.equal(fractionalBound.boundedConservativeAuthorizationAmount, '0.000000000000000001',
      'serialized conservative bounds must ceil when half-even would round the positive exact bound down to zero');
    const exactRounding = await import('../../dist/pricing/exact.js');
    assert.equal(exactRounding.roundedDecimal(exactRounding.rational(1n, 10n ** 19n)), '0');
    assert.equal(exactRounding.conservativeCeilingDecimal(exactRounding.rational(1n, 10n ** 19n)), '0.000000000000000001');

    const unverifiedBound = await callEstimate(requestBase(scope, boundEvent, 'ci03-unverified-bound'), makePorts(pool, scope, clock, {
      boundEvidenceAuthority: { resolve: async () => null },
    }));
    assert.equal(unverifiedBound.status, 'partial');
    assert.equal(unverifiedBound.knownSubtotal, fixture.expected.conservative_bound_missing_cached.known_usd);
    assert.equal(unverifiedBound.boundedConservativeAuthorizationAmount, null);
    const wrongBoundContext = await callEstimate(requestBase(scope, boundEvent, 'ci03-wrong-bound-currency'), makePorts(pool, scope, clock, {
      boundEvidenceAuthority: { resolve: async args => ({
        verified: true, scope: args.scope, actorId: args.actorId, ruleReference: args.ruleReference,
        rateCardReference: args.rateCardReference, evidenceReference: args.evidenceReference, policy: 'maximum_marginal_rate',
        effectiveAt: args.effectiveAt, currency: 'EUR',
      }) },
    }));
    assert.equal(wrongBoundContext.boundedConservativeAuthorizationAmount, null,
      'bound evidence is tied to the exact selected card, rule, effective instant, and source currency');
    const unboundedCategory = makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      model: 'ci03-finite-bound-model',
      usageUnits: [
        unit('input_tokens', '1000'), unit('cache_write_tokens', '100', 'included_subset', 'input_tokens'),
        unit('output_tokens', '500'), unit('reasoning_tokens', '0', 'included_subset', 'output_tokens'),
        unit('container_minutes', '5'),
      ],
    });
    const unboundedEstimate = await callEstimate(requestBase(scope, unboundedCategory, 'ci03-unbounded-category'), ports);
    assert.equal(unboundedEstimate.status, 'partial');
    assert.equal(unboundedEstimate.boundedConservativeAuthorizationAmount, null);
    const fxUnbounded = await callEstimate(requestBase(scope, boundEvent, 'ci03-fx-bound-unavailable', {
      requestedCurrency: 'JPY',
    }), ports);
    assert.equal(fxUnbounded.boundedConservativeAuthorizationAmount, null, 'a missing target-currency conversion cannot carry a bound');
    const staleBoundEvent = makeEvent(sharedEvent, scope, fixture.selection.stale_event_time, {
      model: 'ci03-finite-bound-model',
      usageUnits: [
        unit('input_tokens', '1000'), unit('cache_write_tokens', '100', 'included_subset', 'input_tokens'),
        unit('output_tokens', '500'), unit('reasoning_tokens', '0', 'included_subset', 'output_tokens'),
      ],
    });
    const staleBound = await callEstimate(requestBase(scope, staleBoundEvent, 'ci03-stale-bound'), ports);
    assert.equal(staleBound.status, 'stale');
    assert.equal(staleBound.boundedConservativeAuthorizationAmount, null);
    const explicitZeroBoundEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, {
      model: 'ci03-finite-bound-model',
      usageUnits: [
        unit('input_tokens', '0'), unit('cache_write_tokens', '0', 'included_subset', 'input_tokens'),
        unit('output_tokens', '0'), unit('reasoning_tokens', '0', 'included_subset', 'output_tokens'),
      ],
    });
    const explicitZeroBound = await callEstimate(requestBase(scope, explicitZeroBoundEvent, 'ci03-evidenced-zero-bound'), ports);
    assert.equal(explicitZeroBound.status, 'partial');
    assert.equal(explicitZeroBound.boundedConservativeAuthorizationAmount, '0',
      'an explicit zero upper bound is emitted only with positive verified evidence and an exact finite partition');

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

    const overlap = await registerRateCardV2({
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
    const changedRuleIdentity = await registerPricingRuleV2({
      ...ruleRequest,
      requestId: 'ci03-rule-provider-change',
      idempotencyKey: 'ci03-rule-provider-change-idem',
      rule: { ...rule, revision: 2, effectiveFrom: fixture.selection.revision_two_effective_from,
        retrievedAt: fixture.selection.revision_two_published_at, provider: 'other-provider' },
    }, ports);
    assert.equal(changedRuleIdentity.ok, false);
    assert.equal(changedRuleIdentity.error.code, 'VALIDATION_ERROR', 'a pricing-rule identity cannot change provider');

    const ruleV2 = {
      ...rule,
      revision: 2,
      effectiveFrom: fixture.selection.revision_two_effective_from,
      retrievedAt: fixture.selection.revision_two_published_at,
      usageSemantics: rule.usageSemantics + ' The future revision retains the same provider/product/source identity.',
    };
    const ruleOnlyEvent = makeEvent(sharedEvent, scope, fixture.selection.revision_two_effective_from);
    const [ruleV2Write, duringRuleOnlyRevision] = await Promise.all([
      registerPricingRuleV2({
        schemaVersion: '2.0.0', requestId: 'ci03-rule-v2', idempotencyKey: 'ci03-rule-v2-idem', scope, rule: ruleV2,
      }, ports),
      callEstimate(requestBase(scope, ruleOnlyEvent, 'ci03-rule-only-concurrent-estimate'), ports),
    ]);
    assert.equal(ruleV2Write.ok, true, ruleV2Write.ok ? '' : ruleV2Write.error.safe_message);
    assert.equal(duringRuleOnlyRevision.status, 'complete');
    assert.equal(duringRuleOnlyRevision.rateCardRef.revision, 1);
    assert.equal(duringRuleOnlyRevision.pricingRuleRef.revision, 1,
      'a concurrent rule-only revision does not invalidate the exact immutable rule pinned by an active card');
    const afterRuleOnlyRevision = await callEstimate(requestBase(scope,
      makeEvent(sharedEvent, scope, fixture.selection.revision_two_effective_from), 'ci03-rule-only-after-revision'), ports);
    assert.equal(afterRuleOnlyRevision.status, 'complete');
    assert.equal(afterRuleOnlyRevision.rateCardRef.revision, 1);
    assert.equal(afterRuleOnlyRevision.pricingRuleRef.revision, 1);
    const futureCheapEvent = makeEvent(sharedEvent, scope, fixture.selection.revision_two_effective_from, {
      sourceRefs: [{ kind: 'evidence', id: tierEvidenceId, content_hash: evidenceHash }],
    });
    const futureCheap = await callEstimate(requestBase(scope, futureCheapEvent, 'ci03-second-card-pins-old-rule', {
      serviceTier: 'cheap',
      dimensionsEvidenceRef: sourceReference('PricingUsageDimensionEvidence', tierEvidenceId, evidenceHash),
    }), makePorts(pool, scope, clock, { dimensionEvidenceAuthority: exactDimensionPort({}) }));
    assert.equal(futureCheap.status, 'complete');
    assert.equal(futureCheap.rateCardRef.id, cheapCard.id,
      'multiple active cards can keep the exact same rule reference after a new rule revision');

    const changedFxIdentity = await registerFxRateV2({
      ...fxRequest,
      requestId: 'ci03-fx-currency-change',
      idempotencyKey: 'ci03-fx-currency-change-idem',
      fxRate: { ...fxRequest.fxRate, revision: 2, effectiveFrom: fixture.selection.revision_two_effective_from,
        retrievedAt: fixture.selection.revision_two_published_at, targetCurrency: 'GBP' },
    }, ports);
    assert.equal(changedFxIdentity.ok, false);
    assert.equal(changedFxIdentity.error.code, 'VALIDATION_ERROR', 'an FX identity cannot change its source/target currency pair');

    const selectorRaceRule = { ...structuredClone(rule), id: 'ci03-rule-selector-race' };
    const selectorRaceRuleV1 = await registerPricingRuleV2({
      schemaVersion: '2.0.0', requestId: 'ci03-rule-selector-race-v1',
      idempotencyKey: 'ci03-rule-selector-race-v1-idem', scope, rule: selectorRaceRule,
    }, ports);
    assert.equal(selectorRaceRuleV1.ok, true);
    const selectorRaceRuleV2 = {
      ...selectorRaceRule, revision: 2,
      effectiveFrom: fixture.selection.revision_two_effective_from,
      retrievedAt: fixture.selection.revision_two_published_at,
    };
    const [stableRuleRace, changedRuleRace] = await Promise.all([
      registerPricingRuleV2({
        schemaVersion: '2.0.0', requestId: 'ci03-rule-selector-race-stable',
        idempotencyKey: 'ci03-rule-selector-race-stable-idem', scope, rule: selectorRaceRuleV2,
      }, ports),
      registerPricingRuleV2({
        schemaVersion: '2.0.0', requestId: 'ci03-rule-selector-race-changed',
        idempotencyKey: 'ci03-rule-selector-race-changed-idem', scope,
        rule: { ...selectorRaceRuleV2, provider: 'other-provider' },
      }, ports),
    ]);
    assert.equal(stableRuleRace.ok, true);
    assert.equal(changedRuleRace.ok, false,
      'a competing provider change cannot win a rule identity revision race');
    const selectorRuleRows = await pool.query(
      'SELECT rule_payload FROM cost_intelligence.pricing_rule_versions WHERE tenant_id = $1 AND rule_id = $2 ORDER BY record_revision',
      [scope.tenantId, selectorRaceRule.id],
    );
    assert.equal(selectorRuleRows.rowCount, 2);
    assert.ok(selectorRuleRows.rows.every(row => (typeof row.rule_payload === 'string'
      ? JSON.parse(row.rule_payload) : row.rule_payload).provider === rule.provider));

    const selectorRaceFx = {
      ...structuredClone(fxRequest.fxRate), id: 'ci03-fx-selector-race', sourceCurrency: 'GBP',
    };
    const selectorRaceFxV1 = await registerFxRateV2({
      schemaVersion: '2.0.0', requestId: 'ci03-fx-selector-race-v1',
      idempotencyKey: 'ci03-fx-selector-race-v1-idem', scope, fxRate: selectorRaceFx,
    }, ports);
    assert.equal(selectorRaceFxV1.ok, true);
    const selectorRaceFxV2 = {
      ...selectorRaceFx, revision: 2,
      effectiveFrom: fixture.selection.revision_two_effective_from,
      retrievedAt: fixture.selection.revision_two_published_at,
      rate: '1.6',
    };
    const [stableFxRace, changedFxRace] = await Promise.all([
      registerFxRateV2({
        schemaVersion: '2.0.0', requestId: 'ci03-fx-selector-race-stable',
        idempotencyKey: 'ci03-fx-selector-race-stable-idem', scope, fxRate: selectorRaceFxV2,
      }, ports),
      registerFxRateV2({
        schemaVersion: '2.0.0', requestId: 'ci03-fx-selector-race-changed',
        idempotencyKey: 'ci03-fx-selector-race-changed-idem', scope,
        fxRate: { ...selectorRaceFxV2, targetCurrency: 'JPY' },
      }, ports),
    ]);
    assert.equal(stableFxRace.ok, true);
    assert.equal(changedFxRace.ok, false,
      'a competing currency-pair change cannot win an FX identity revision race');
    const selectorFxRows = await pool.query(
      'SELECT fx_rate_payload FROM cost_intelligence.pricing_fx_rate_versions WHERE tenant_id = $1 AND fx_rate_id = $2 ORDER BY record_revision',
      [scope.tenantId, selectorRaceFx.id],
    );
    assert.equal(selectorFxRows.rowCount, 2);
    assert.ok(selectorFxRows.rows.every(row => {
      const value = typeof row.fx_rate_payload === 'string' ? JSON.parse(row.fx_rate_payload) : row.fx_rate_payload;
      return value.sourceCurrency === selectorRaceFx.sourceCurrency && value.targetCurrency === selectorRaceFx.targetCurrency;
    }));

    const cardV2 = {
      ...card,
      revision: 2,
      pricingRuleRef: ruleV2Write.value.reference,
      effectiveFrom: fixture.selection.revision_two_effective_from,
      retrievedAt: fixture.selection.revision_two_published_at,
      unitRates: card.unitRates.map(rate => rate.category === 'input_ordinary' ? { ...rate, rate: '9' } : rate),
    };
    const cardV2Write = await registerRateCardV2({
      schemaVersion: '2.0.0', requestId: 'ci03-card-v2', idempotencyKey: 'ci03-card-v2-idem', scope, rateCard: cardV2,
    }, ports);
    assert.equal(cardV2Write.ok, true, cardV2Write.ok ? '' : cardV2Write.error.safe_message);

    const unchangedExactRuleEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time);
    const unchangedExactRule = await callEstimate(requestBase(scope, unchangedExactRuleEvent, 'ci03-card-pins-old-rule'), ports);
    assert.equal(unchangedExactRule.status, 'complete');
    assert.equal(unchangedExactRule.rateCardRef.revision, 1);
    assert.equal(unchangedExactRule.pricingRuleRef.revision, 1,
      'a card remains eligible through its exact immutable rule reference after a new rule revision is published');

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

    const lateHistoricalEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, { model: 'ci03-late-model' });
    const lateHistoricalRequest = requestBase(scope, lateHistoricalEvent, 'ci03-late-historical-source');
    const beforeLateSource = await callEstimate(lateHistoricalRequest, ports);
    assert.equal(beforeLateSource.status, 'pricing_unknown', 'an unknown event without an eligible historical source is not fabricated as zero');
    clock.value = '2026-10-11T03:31:00.000Z';
    const lateCard = {
      ...card, id: 'ci03-late-historical-card', modelOrSku: 'ci03-late-model', aliases: [],
      effectiveFrom: fixture.selection.published_at, retrievedAt: clock.value, pricingRuleRef: ruleWrite.value.reference,
    };
    const lateCardWrite = await registerRateCardV2({
      schemaVersion: '2.0.0', requestId: 'ci03-late-card', idempotencyKey: 'ci03-late-card-idem', scope,
      rateCard: lateCard,
    }, ports);
    assert.equal(lateCardWrite.ok, true, lateCardWrite.ok ? '' : lateCardWrite.error.safe_message);
    const pinnedLateEvent = makeEvent(sharedEvent, scope, fixture.selection.event_time, { model: 'ci03-late-model' });
    const pinnedLateRequest = requestBase(scope, pinnedLateEvent, 'ci03-pinned-late-first', {
      rateCardRef: lateCardWrite.value.reference,
    });
    const pinnedLateFirst = await callEstimate(pinnedLateRequest, ports);
    assert.equal(pinnedLateFirst.status, 'complete');
    assert.equal(pinnedLateFirst.rateCardRef.content_hash, lateCardWrite.value.reference.content_hash);
    const firstLateEstimate = await callEstimate(lateHistoricalRequest, ports);
    assert.equal(firstLateEstimate.status, 'complete');
    assert.equal(firstLateEstimate.rateCardRef.id, lateCard.id,
      'a source retrieved and registered after event time can support its historical effective interval at valuation time');

    clock.value = '2026-10-11T03:32:00.000Z';
    const lateCardCorrection = {
      ...lateCard,
      revision: 2,
      effectiveFrom: '2026-10-11T03:30:05.000Z',
      retrievedAt: clock.value,
      unitRates: lateCard.unitRates.map(rate => ({ ...rate, rate: '99' })),
    };
    const [lateCorrectionWrite, pinnedConcurrentCorrectionReplay] = await Promise.all([
      registerRateCardV2({
        schemaVersion: '2.0.0', requestId: 'ci03-late-card-revision', idempotencyKey: 'ci03-late-card-revision-idem', scope,
        rateCard: lateCardCorrection,
      }, ports),
      callEstimate({
        ...pinnedLateRequest, requestId: 'ci03-pinned-late-concurrent-correction',
        idempotencyKey: 'ci03-pinned-late-concurrent-correction-idem',
      }, ports),
    ]);
    assert.equal(lateCorrectionWrite.ok, true, lateCorrectionWrite.ok ? '' : lateCorrectionWrite.error.safe_message);
    assert.deepEqual({ ...pinnedConcurrentCorrectionReplay, requestId: pinnedLateFirst.requestId }, pinnedLateFirst,
      'a correction committed concurrently cannot bypass the existing original-pin valuation');
    const lateReplayWithNewKey = await callEstimate({
      ...lateHistoricalRequest, requestId: 'ci03-late-historical-replay', idempotencyKey: 'ci03-late-historical-replay-idem',
    }, ports);
    assert.equal(lateReplayWithNewKey.rateCardRef.revision, 1);
    assert.equal(lateReplayWithNewKey.knownSubtotal, firstLateEstimate.knownSubtotal,
      'catalog corrections do not silently reprice an immutable event valuation or an alternate retry key');
    const pinnedReplayWithNewKey = await callEstimate({
      ...pinnedLateRequest, requestId: 'ci03-pinned-late-replay', idempotencyKey: 'ci03-pinned-late-replay-idem',
    }, ports);
    assert.deepEqual({ ...pinnedReplayWithNewKey, requestId: pinnedLateFirst.requestId }, pinnedLateFirst,
      'the explicit original rate-card pin replays the exact durable valuation after a backdated correction');
    const changedPinnedSelection = await callEstimate({
      ...pinnedLateRequest,
      requestId: 'ci03-pinned-late-changed-selection',
      idempotencyKey: 'ci03-pinned-late-changed-selection-idem',
      selection: { ...pinnedLateRequest.selection, requestedCurrency: 'EUR' },
    }, ports);
    assert.equal(changedPinnedSelection.status, 'unknown');
    assert.ok(changedPinnedSelection.missingDimensions.includes('existing_immutable_valuation_requires_authorized_revaluation'));
    const concurrentPinnedReplays = await Promise.all([1, 2].map(index => callEstimate({
      ...pinnedLateRequest,
      requestId: 'ci03-pinned-late-concurrent-' + index,
      idempotencyKey: 'ci03-pinned-late-concurrent-' + index + '-idem',
    }, ports)));
    for (const concurrentReplay of concurrentPinnedReplays) {
      assert.deepEqual({ ...concurrentReplay, requestId: pinnedLateFirst.requestId }, pinnedLateFirst,
        'concurrent alternate retry keys bind to the same pinned historical result');
    }
    const pinnedRateOnNewEvent = await callEstimate(requestBase(scope,
      makeEvent(sharedEvent, scope, fixture.selection.event_time, { model: 'ci03-late-model' }), 'ci03-pinned-late-new-event', {
        rateCardRef: lateCardWrite.value.reference,
      }), ports);
    assert.equal(pinnedRateOnNewEvent.status, 'pricing_unknown',
      'a superseded explicit pin cannot price a new usage event without its own durable snapshot');
    let replayDeniedConnections = 0;
    const deniedPinnedReplay = await estimateV2(pinnedLateRequest, makePorts(pool, scope, clock, {
      database: { connect: async () => { replayDeniedConnections += 1; throw new Error('denied replay reached database'); } },
      actionAuthority: { authorize: async ({ scope: authorizedScope, action }) => ({
        decisionId: 'synthetic-denied-replay', action, scope: authorizedScope, actorId: authorizedScope.actorId,
        allowed: false, issuedAt: '2026-10-11T03:29:00.000Z', expiresAt: '2026-10-11T04:30:00.000Z',
      }) },
    }));
    assert.equal(deniedPinnedReplay.ok, false);
    assert.equal(deniedPinnedReplay.error.code, 'FORBIDDEN_SCOPE');
    assert.equal(replayDeniedConnections, 0, 'current estimate authority is checked before returning a durable replay');
    const newLateAttempt = await callEstimate(requestBase(scope,
      makeEvent(sharedEvent, scope, fixture.selection.event_time, { model: 'ci03-late-model' }), 'ci03-late-new-attempt'), ports);
    assert.equal(newLateAttempt.rateCardRef.revision, 2);
    assert.ok(Number(newLateAttempt.knownSubtotal) > Number(firstLateEstimate.knownSubtotal),
      'a later first valuation sees the corrected backdated version while an existing snapshot remains stable');

    const contractRef = sourceReference('ContractTimeEvidence', 'ci03-contract-time', 'sha256:' + 'c'.repeat(64));
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
    assert.equal(Number(counts.rows[0].rules), 10);
    assert.equal(Number(counts.rows[0].cards), 14);
    assert.equal(Number(counts.rows[0].fx), 3);

    const reconnectPool = new Pool({ ...databaseConfigFromEnvironment('CI_TEST_DB'), max: 4 });
    try {
      const reconnectPorts = makePorts(reconnectPool, scope, clock);
      const changedRuleAfterReconnect = await registerPricingRuleV2({
        schemaVersion: '2.0.0', requestId: 'ci03-rule-alt-key-reconnected',
        idempotencyKey: 'ci03-rule-alt-key-idem', scope,
        rule: { ...rule, id: 'ci03-different-rule-after-reconnect' },
      }, reconnectPorts);
      assert.equal(changedRuleAfterReconnect.ok, false);
      assert.equal(changedRuleAfterReconnect.error.code, 'IDEMPOTENCY_CONFLICT');
      const changedCardAfterReconnect = await registerRateCardV2({
        schemaVersion: '2.0.0', requestId: 'ci03-card-alt-key-reconnected',
        idempotencyKey: 'ci03-card-alt-key-idem', scope,
        rateCard: { ...card, id: 'ci03-different-card-after-reconnect' },
      }, reconnectPorts);
      assert.equal(changedCardAfterReconnect.ok, false);
      assert.equal(changedCardAfterReconnect.error.code, 'IDEMPOTENCY_CONFLICT');
      const changedFxAfterReconnect = await registerFxRateV2({
        schemaVersion: '2.0.0', requestId: 'ci03-fx-alt-key-reconnected',
        idempotencyKey: 'ci03-fx-alt-key-idem', scope,
        fxRate: { ...fxRequest.fxRate, id: 'ci03-different-fx-after-reconnect' },
      }, reconnectPorts);
      assert.equal(changedFxAfterReconnect.ok, false);
      assert.equal(changedFxAfterReconnect.error.code, 'IDEMPOTENCY_CONFLICT');

      const replayAfterReconnect = await callEstimate({
        ...oldRequest,
        requestId: 'ci03-old-replay-after-reconnect',
        idempotencyKey: 'idem-ci03-old-replay-after-reconnect',
      }, reconnectPorts);
      assert.equal(replayAfterReconnect.status, 'complete');
      assert.equal(replayAfterReconnect.rateCardRef.revision, 1);
      assert.equal(replayAfterReconnect.knownSubtotal, exact.knownSubtotal,
        'a fresh pool replays the first immutable valuation after later catalog revisions');
      const pinnedReplayAfterReconnect = await callEstimate({
        ...pinnedLateRequest,
        requestId: 'ci03-pinned-late-after-reconnect',
        idempotencyKey: 'ci03-pinned-late-after-reconnect-idem',
      }, reconnectPorts);
      assert.deepEqual({ ...pinnedReplayAfterReconnect, requestId: pinnedLateFirst.requestId }, pinnedLateFirst,
        'a fresh pool returns the exact pinned valuation after a backdated card correction');
    } finally {
      await reconnectPool.end();
    }
  } finally {
    await pool.end();
  }
});
