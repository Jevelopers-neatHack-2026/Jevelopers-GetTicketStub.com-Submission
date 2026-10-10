import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { compareEntityIdentity, EntityIdentityError } from '../../../src/discovery/entities/identity.mjs';

const HASH = 'a'.repeat(64);

function reference(value, options = {}) {
  return {
    evidenceId: options.evidenceId ?? 'evidence-1',
    contentHash: options.contentHash ?? HASH,
    locator: options.locator ?? { kind: 'json-pointer', pointer: '/organization/identifier' },
    field: options.field ?? 'organization_id',
    value,
  };
}

function identifier(namespace, value, options = {}) {
  return {
    namespace,
    value,
    origin: options.origin ?? 'sourced',
    supports: [reference(value, options)],
  };
}

function name(value, options = {}) {
  return {
    value,
    origin: options.origin ?? 'sourced',
    supports: [reference(value, {
      evidenceId: options.evidenceId ?? 'name-evidence',
      contentHash: options.contentHash ?? HASH,
      locator: options.locator ?? { kind: 'json-pointer', pointer: '/organization/name' },
      field: options.field ?? 'organization_name',
    })],
  };
}

function entity(candidateId, { kind = 'organization', names = [], identifiers = [] } = {}) {
  return {
    schema: 'ei-entity-observation-internal/v1',
    candidateId,
    kind,
    names,
    identifiers,
  };
}

test('name and brand similarity routes to review and never merges similarly named companies', () => {
  const result = compareEntityIdentity(
    entity('company-a', { names: [name('Northern Lights Touring')] }),
    entity('company-b', { names: [name('Northern Lights Touring Group', { evidenceId: 'page-b', contentHash: 'b'.repeat(64) })] }),
  );

  assert.equal(result.relation, 'review');
  assert.deepEqual(result.reasonCodes, ['name_similarity_without_strong_identity']);
  assert.equal(result.sourceAuthority, 'not_evaluated');
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.duplicateContentHashes, []);
});
test('an exact source-bound identifier yields a qualified candidate match with provenance', () => {
  const support = { evidenceId: 'registry-record', locator: { kind: 'json-pointer', pointer: '/entity/lei' }, field: 'lei' };
  const result = compareEntityIdentity(
    entity('organization-b', { identifiers: [identifier('lei', '549300EXAMPLE', support)] }),
    entity('organization-a', { identifiers: [identifier('lei', '549300EXAMPLE', support)] }),
  );

  assert.equal(result.relation, 'same_entity_candidate');
  assert.deepEqual(result.reasonCodes, ['shared_source_bound_identifier']);
  assert.deepEqual(result.candidateIds, ['organization-a', 'organization-b']);
  assert.equal(result.provenanceReferences.length, 1);
  assert.equal(result.provenanceReferences[0].contentHash, HASH);
  assert.equal(result.provenanceReferences[0].field, 'lei');
  assert.equal(result.provenanceReferences[0].value, '549300EXAMPLE');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.candidates[0].identifiers[0].supports[0]), true);
});

test('a matching identifier from different source positions remains a review candidate', () => {
  const result = compareEntityIdentity(
    entity('a', { identifiers: [identifier('registry:us-ca', 'C-481', { evidenceId: 'registry-page-a' })] }),
    entity('b', { identifiers: [identifier('registry:us-ca', 'C-481', { evidenceId: 'registry-page-b', contentHash: 'b'.repeat(64) })] }),
  );

  assert.equal(result.relation, 'review');
  assert.deepEqual(result.reasonCodes, ['identifier_match_without_shared_source_position']);
  assert.equal(result.provenanceReferences.length, 2);
});

test('duplicate claims in one identifier namespace cannot hide a shared source-bound identifier', () => {
  const shared = identifier('registry:us-ca', 'C-481', { evidenceId: 'registry-record' });
  const separate = identifier('registry:us-ca', 'C-481', { evidenceId: 'other-registry-record', contentHash: 'b'.repeat(64) });
  const left = entity('left', { identifiers: [shared, separate] });
  const right = entity('right', { identifiers: [identifier('registry:us-ca', 'C-481', { evidenceId: 'registry-record' })] });

  const forward = compareEntityIdentity(left, right);
  const reverse = compareEntityIdentity(right, left);
  assert.equal(forward.relation, 'same_entity_candidate');
  assert.deepEqual(forward, reverse);
  assert.equal(forward.provenanceReferences.length, 2);
});

test('conflicting explicit identifiers keep candidates distinct even when names match', () => {
  const result = compareEntityIdentity(
    entity('a', { names: [name('Crescent Live')], identifiers: [identifier('company-registry:us-ca', '00017')] }),
    entity('b', { names: [name('Crescent Live', { evidenceId: 'name-page-b', contentHash: 'b'.repeat(64) })], identifiers: [identifier('company-registry:us-ca', '00092', { evidenceId: 'registry-b', contentHash: 'c'.repeat(64) })] }),
  );

  assert.equal(result.relation, 'different_entity_candidate');
  assert.deepEqual(result.reasonCodes, ['identifier_value_mismatch']);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.provenanceReferences.some((ref) => ref.value === '00017'), true);
  assert.equal(result.provenanceReferences.some((ref) => ref.value === '00092'), true);
});

test('identical bytes from different evidence records are surfaced as duplicates, not corroboration', () => {
  const result = compareEntityIdentity(
    entity('a', { names: [name('Red Harbor Events', { evidenceId: 'copy-one' })] }),
    entity('b', { names: [name('Red Harbor Events', { evidenceId: 'copy-two' })] }),
  );

  assert.equal(result.relation, 'review');
  assert.deepEqual(result.reasonCodes, ['duplicate_content_is_not_independent_support']);
  assert.deepEqual(result.duplicateContentHashes, [HASH]);
  assert.equal(Object.hasOwn(result, 'independentSupportCount'), false);
});

test('without identity evidence, comparison is unknown and stays deterministic under argument reversal', () => {
  const left = entity('z-company');
  const right = entity('a-company');
  const forward = compareEntityIdentity(left, right);
  const reverse = compareEntityIdentity(right, left);

  assert.equal(forward.relation, 'unknown');
  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.candidateIds, ['a-company', 'z-company']);
});

test('candidate ID order is locale-independent for mixed-case and punctuation IDs', () => {
  const identityModuleUrl = new URL('../../../src/discovery/entities/identity.mjs', import.meta.url).href;
  const source = `
    const { compareEntityIdentity } = await import(${JSON.stringify(identityModuleUrl)});
    const ids = ['A', 'a', 'a-b', 'a.b', 'a:b', 'a_b'];
    const observation = (candidateId) => ({
      schema: 'ei-entity-observation-internal/v1', candidateId, kind: 'organization',
    });
    const results = [];
    for (let index = 0; index < ids.length; index += 1) {
      for (let other = index + 1; other < ids.length; other += 1) {
        const first = ids[index];
        const second = ids[other];
        results.push([
          compareEntityIdentity(observation(first), observation(second)).candidateIds,
          compareEntityIdentity(observation(second), observation(first)).candidateIds,
        ]);
      }
    }
    console.log(JSON.stringify({ locale: new Intl.Collator().resolvedOptions().locale, results }));
  `;
  const runForLocale = (locale) => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      encoding: 'utf8',
      env: { ...process.env, LANG: `${locale}.UTF-8`, LC_ALL: `${locale}.UTF-8` },
    });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout.trim());
  };
  const english = runForLocale('en_US');
  const danish = runForLocale('da_DK');
  const ids = ['A', 'a', 'a-b', 'a.b', 'a:b', 'a_b'];
  const expected = [];
  for (let index = 0; index < ids.length; index += 1) {
    for (let other = index + 1; other < ids.length; other += 1) {
      const pair = [ids[index], ids[other]];
      expected.push([pair, pair]);
    }
  }

  assert.equal(english.locale, 'en-US');
  assert.equal(danish.locale, 'da-DK');
  assert.deepEqual(english.results, expected);
  assert.deepEqual(danish.results, expected);
});

test('malformed, private, accessor-backed, and over-bounded input fails without invoking getters', () => {
  let getterCalled = false;
  const accessor = { schema: 'ei-entity-observation-internal/v1', kind: 'organization', names: [], identifiers: [] };
  Object.defineProperty(accessor, 'candidateId', { enumerable: true, get() { getterCalled = true; return 'forged'; } });

  assert.throws(() => compareEntityIdentity(accessor, entity('valid')), EntityIdentityError);
  assert.equal(getterCalled, false);
  assert.throws(() => compareEntityIdentity(Object.create({ candidateId: 'prototype-injected' }), entity('valid')), EntityIdentityError);
  assert.throws(() => compareEntityIdentity(entity('a', { identifiers: [identifier('lei', 'X', { contentHash: 'not-a-hash' })] }), entity('b')), EntityIdentityError);
  assert.throws(() => compareEntityIdentity({ ...entity('a'), official: true }, entity('b')), EntityIdentityError);
  assert.throws(() => compareEntityIdentity({ ...entity('a'), names: null }, entity('b')), EntityIdentityError);
  assert.throws(() => compareEntityIdentity(entity('a', { names: Array.from({ length: 25 }, (_, index) => name(`Name ${index}`)) }), entity('b')), EntityIdentityError);
});
