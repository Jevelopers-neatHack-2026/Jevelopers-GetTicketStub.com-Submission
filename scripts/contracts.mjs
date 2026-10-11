import { readFile, access, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { root, readJson, schemaFiles, compiler, outputs } from './generate.mjs';
import { validateContract, validateContractVersion, parseContract, checkTrustedContext, hashBytes, hashManifest, canonicalJson } from '../tooling/runtime.mjs';
import { checkOperation, compareUsageIdentity } from '../tooling/operations.mjs';
import { checkResearchCreative } from '../tooling/research-creative.mjs';
import { checkCommerceEvidence } from '../tooling/commerce-evidence.mjs';
import { schemaImpact } from './compatibility.mjs';
import { dependencyErrors, deliverableGraph, graphErrors } from './dependency-map.mjs';

const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export async function catalog() {
  const text = await readFile(root + 'docs/contract-catalog.md', 'utf8');
  const match = text.match(/```json catalog\n([\s\S]*?)\n```/);
  if (!match) throw new Error('Missing machine catalog');
  return JSON.parse(match[1]).contracts;
}
const exists = async path => {
  if (!path || isAbsolute(path) || relative(root, resolve(root, path)).startsWith('..')) return false;
  try { await access(root + path); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};
export function classifications(schema, taxonomy, path = '', registry = new Map()) {
  const roots = new Map(registry);
  if (schema.$id) roots.set(schema.$id, schema);
  const issues = [], active = new Set();
  const escape = key => key.replaceAll('~', '~0').replaceAll('/', '~1');
  function walk(node, current, document) {
    if (!node || typeof node !== 'object' || active.has(node)) return;
    active.add(node);
    if (node.$ref) {
      const [id, fragment = ''] = node.$ref.split('#');
      let target = id ? roots.get(id) : document;
      for (const part of fragment.split('/').filter(Boolean)) target = target?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
      if (!target) issues.push({ code: 'UNRESOLVED_CLASSIFICATION_REFERENCE', path: current });
      else walk(target, current, id ? roots.get(id) : document);
    }
    for (const [key, field] of Object.entries(node.properties ?? {})) {
      const next = current + '/' + escape(key);
      if (!taxonomy.includes(field['x-classification'])) issues.push({ code: 'UNCLASSIFIED_FIELD', path: next });
      walk(field, next, document);
    }
    for (const field of Object.values(node.patternProperties ?? {})) {
      if (!taxonomy.includes(field['x-classification'])) issues.push({ code: 'UNCLASSIFIED_FIELD', path: current + '/*' });
      walk(field, current + '/*', document);
    }
    for (const key of ['items', 'contains', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'propertyNames', 'not', 'if', 'then', 'else']) {
      if (key === 'additionalProperties' && node[key] && typeof node[key] === 'object' && !taxonomy.includes(node[key]['x-classification'])) issues.push({ code: 'UNCLASSIFIED_FIELD', path: current + '/*' });
      walk(node[key], current + (['items', 'contains', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems'].includes(key) ? '/*' : ''), document);
    }
    for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) for (const child of node[key] ?? []) walk(child, current + (key === 'prefixItems' ? '/*' : ''), document);
    for (const key of ['$defs', 'definitions', 'dependentSchemas']) for (const child of Object.values(node[key] ?? {})) walk(child, current, document);
    active.delete(node);
  }
  walk(schema, path, schema);
  return [...new Map(issues.map(issue => [JSON.stringify(issue), issue])).values()];
}
export { assertFixture } from '../tooling/fixture-harness.mjs';
export async function runFixtures(entry) {
  const failures = [];
  for (const version of contractVersions(entry)) {
    if (!await exists(version.fixtures)) failures.push({ code: 'MISSING_FIXTURES', contract: entry.name, ...(version.schema_version ? { version: version.schema_version } : {}) });
    else failures.push(...runCanonicalFixtures(entry.name, await readJson(version.fixtures)).failures);
  }
  return failures;
}
export function contractVersions(entry) { return entry.versions ? entry.versions.map(version => ({ ...entry, ...version, versions: undefined })) : [entry]; }

export async function execute(command, options) {
  const entries = await catalog();
  const [name, versionSelection] = (options.contract ?? '').split('@');
  const selected = options.contract ? entries.filter(entry => entry.name === name || entry.group === name).map(entry => versionSelection ? { ...entry, versions: contractVersions(entry).filter(version => version.schema_version === versionSelection) } : entry) : options.foundation ? entries.filter(entry => entry.state === 'foundation_candidate') : options.implemented ? entries.filter(entry => entry.schema_path) : entries;
  const failures = [];
  const add = (code, entry, extra = {}) => failures.push({ code, ...(entry ? { contract: entry.name } : {}), ...extra });
  if (!selected.length) add('UNKNOWN_CONTRACT');
  for (const entry of selected) if (!contractVersions(entry).length) add('UNSUPPORTED_CONTRACT_VERSION', entry);
  const policy = await readJson('compatibility/version-policy.json');
  const privacy = await readJson('compatibility/privacy-policy.json');
  const classificationRegistry = new Map(await Promise.all((await schemaFiles()).map(async path => { const schema = await readJson(path); return [schema.$id, schema]; })));
  switch (command) {
    case 'check': {
      const ajv = compiler();
      const paths = await schemaFiles();
      for (const path of paths) ajv.addSchema(await readJson(path));
      for (const entry of selected.flatMap(contractVersions)) {
        if (!await exists(entry.schema_path) || !await exists(entry.generated_export)) { add('MISSING_SCHEMA_OR_EXPORT', entry); continue; }
        const schema = await readJson(entry.schema_path);
        ajv.getSchema(schema.$id);
        failures.push(...classifications(schema, privacy.classifications, '', classificationRegistry).map(issue => ({ ...issue, contract: entry.name })));
      }
      for (const [path, content] of await outputs()) if (await readFile(root + 'generated/' + path, 'utf8') !== content) add('GENERATED_DRIFT', null, { path });
      break;
    }
    case 'fixtures':
      for (const entry of selected) failures.push(...await runFixtures(entry));
      break;
    case 'compat': {
      if (options.before || options.after) {
        if (!options.before || !options.after) { add('MISSING_COMPARISON_PATH'); break; }
        const comparison = schemaImpact(JSON.parse(await readFile(options.before, 'utf8')), JSON.parse(await readFile(options.after, 'utf8')));
        if (comparison.impact === 'breaking_or_unproven') add('BREAKING_CHANGE_REQUIRES_REVIEW', null, { changes: comparison.changes });
        break;
      }
      const matrix = await readJson('compatibility/matrix.json');
      const baselines = await readJson('compatibility/baselines.json');
      for (const entry of selected.flatMap(contractVersions)) {
        if (!await exists(entry.schema_path)) { add('MISSING_COMPAT_SCHEMA', entry); continue; }
        const fixture = await readJson(entry.fixtures);
        const baseline = baselines.schemas.find(schema => schema.contract === entry.name && schema.version === entry.schema_version);
        if (!baseline || 'sha256:' + baseline.sha256 !== hashBytes(await readFile(root + entry.schema_path))) add('IMMUTABLE_SCHEMA_DRIFT', entry);
        const rows = matrix.cases.filter(row => row.contract === entry.name && row.consumer_version === entry.schema_version);
        if (!rows.length) add('MISSING_COMPAT_CASE', entry);
        for (const row of rows) {
          const producer = contractVersions(entries.find(item => item.name === entry.name)).find(item => item.schema_version === row.producer_version);
          const producerFixture = producer ? await readJson(producer.fixtures) : fixture;
          const payload = { ...producerFixture.valid, schema_version: row.producer_version };
          const supported = row.consumer_version === '2.0.0' ? ['1.0.0', '2.0.0'] : [row.consumer_version];
          const result = validateContractVersion(entry.name, supported.includes(row.producer_version) ? row.producer_version : row.consumer_version, payload);
          const expected = row.accept ? { ok: true } : { ok: false, code: 'UNSUPPORTED_VERSION', path: '/schema_version' };
          try { assertFixture(result, expected); } catch (error) {
            if (!(error instanceof Error)) throw error;
            add('COMPAT_MISMATCH', entry);
          }
          if (!contractVersions(entries.find(item => item.name === entry.name)).some(item => item.schema_version === row.consumer_version)) add('MISSING_CONSUMER_VERSION_VALIDATOR', entry);
        }
      }
      if (!policy.breaking_changes.length || !policy.deprecation.minimum_days || policy.deprecation.removal_conditions.length < 4) add('INVALID_VERSION_POLICY');
      break;
    }
    case 'inventory': {
      const names = new Set();
      for (const entry of selected) {
        if (names.has(entry.name)) add('DUPLICATE_CONTRACT', entry);
        names.add(entry.name);
        if (!entry.requirement || !entry.trust_boundary || !entry.semantic_authority || !entry.field_steward || !entry.lifecycle) add('INCOMPLETE_INVENTORY', entry);
        if (options['require-owner'] && (!entry.named_owner || !entry.reviewer || !entry.owner_acknowledgement)) add('BLOCKED_OWNER_ACCEPTANCE', entry);
        if (options['require-consumer'] && (!entry.producers.length || !entry.consumers.length || entry.consumers.some(name => !knownConsumers.includes(name)))) add('MISSING_CONSUMER', entry);
        if (options['require-leaf'] && (!Number.isInteger(entry.issue) || entry.issue < 4 || (entry.issue > 28 && ![32, 34, 35, 36, 37].includes(entry.issue)))) add('MISSING_LEAF', entry);
        if (options['require-version-policy'] && !await exists(entry.version_policy)) add('MISSING_VERSION_POLICY', entry);
        if (options['require-field-classification'] && !options['policy-only']) {
          for (const version of contractVersions(entry)) {
            if (!await exists(version.schema_path)) add('MISSING_CLASSIFIED_SCHEMA', version);
            else failures.push(...classifications(await readJson(version.schema_path), privacy.classifications, '', classificationRegistry).map(issue => ({ ...issue, contract: entry.name, version: version.schema_version })));
          }
        }
        if (options['require-fixtures']) failures.push(...await runFixtures(entry));
        if (options['require-docs']) for (const version of contractVersions(entry)) if (!await exists(version.docs) || !await exists(version.schema_path) || !await exists(version.generated_export) || !await exists(version.helper)) add('MISSING_DISCOVERABLE_ARTIFACT', version);
      }
      if (options['require-field-classification'] && (!privacy.classifications?.length || !privacy.public_fields?.length || !privacy.always_exclude?.length)) add('MISSING_PRIVACY_POLICY');
      if (options['policy-only'] && !options['require-field-classification']) add('INVALID_POLICY_ONLY_USAGE');
      if (options['require-consumer-pins']) {
        const manifest = await readJson('compatibility/consumers.json');
        const schemas = (await readJson('generated/schema-manifest.json')).schemas;
        const fixtureDigest = (await readJson('generated/fixture-manifest.json')).digest;
        for (const repository of knownConsumers) {
          const consumer = manifest.repositories.find(entry => entry.repository === repository);
          if (!consumer || !sha(consumer.source_sha) || !pinsMatch(consumer, schemas, fixtureDigest) || consumer.result !== 'passed') add('BLOCKED_CONSUMER_PIN', null, { repository });
        }
      }
      if (options['require-owner']) {
        const findings = await readJson('compatibility/owner-findings.json');
        for (const finding of findings.findings.filter(row => row.status !== 'resolved')) add('BLOCKED_PRODUCER_FINDING', null, { finding: finding.id, issue: finding.issue });
        const proposals = await readJson('compatibility/proposal-intake.json');
        for (const proposal of proposals.requests) add('BLOCKED_OWNER_PROPOSAL', null, { owner: proposal.owner, source: proposal.source });
        const checkpoint = await readJson('compatibility/checkpoint-findings.json');
        for (const finding of checkpoint.findings.filter(row => row.status !== 'resolved')) add('BLOCKED_CHECKPOINT_REVIEW', null, { finding: finding.id, status: finding.status });
      }
      break;
    }
    case 'consumers': {
      const manifest = await readJson('compatibility/consumers.json');
      const paths = options.paths ? JSON.parse(await readFile(options.paths, 'utf8')) : {};
      const result = await consumerChecks(manifest, paths);
      failures.push(...result.failures);
      return { command, scope: 'checked_in_consumer_manifest', status: failures.length ? 'failed_or_blocked' : 'passed', checked: knownConsumers.length, ...result };
      break;
    }
    case 'docs': {
      for (const path of ['README.md', 'CHANGELOG.md', 'docs/contract-catalog.md', 'docs/identity-policy.md', 'docs/privacy-policy.md', 'docs/adr/0001-canonical-schemas.md', 'docs/operations-contracts.md', 'docs/research-creative-contracts.md', 'docs/commerce-evidence-contracts.md', 'docs/finance-v2-contracts.md', 'docs/capability-contracts.md', 'docs/fixture-harness.md', 'docs/consumer-handoff.md', 'docs/release-guide.md', 'docs/architecture/OWNERSHIP.md', 'docs/architecture/ACCEPTANCE.md']) {
        const text = await readFile(root + path, 'utf8');
        for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
          if (/^(https?:|#)/.test(match[1])) continue;
          const target = resolve(root, path, '..', match[1].split('#')[0]);
          try { await access(target); } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            add('BROKEN_DOC_LINK', null, { path, target: match[1] });
          }
        }
      }
      const readme = await readFile(root + 'README.md', 'utf8');
      for (const entry of entries) {
        for (const target of [entry.schema_path, entry.generated_export, entry.helper, entry.fixtures]) if (!await exists(target) || !readme.includes('](' + target + ')')) add('MISSING_README_EXPORT_LINK', entry);
        if (!readme.includes('/shared-contracts/issues/' + entry.issue + ')')) add('MISSING_README_OWNER_LINK', entry);
      }
      const fixtureManifest = await readJson('generated/fixture-manifest.json');
      const schemaManifest = await readJson('generated/schema-manifest.json');
      for (const schema of schemaManifest.schemas) if (!fixtureManifest.contracts.some(row => row.contract === schema.contract && row.version === schema.version)) add('MISSING_VERSION_FIXTURE', null, { contract: schema.contract, version: schema.version });
      const requirements = await readJson('docs/requirements.json');
      const authority = await readJson('docs/authority-dependencies.json');
      failures.push(...dependencyErrors(requirements, authority), ...graphErrors(deliverableGraph(requirements)));
      const criteria = (await readJson('docs/acceptance-criteria.json')).criteria;
      const expectedIds = requirements.issues.flatMap(row => row.acceptance_ids).concat(['SC-EPIC.1', 'SC-EPIC.2', 'SC-EPIC.3']);
      if (new Set(criteria.map(row => row.id)).size !== criteria.length || expectedIds.some(id => !criteria.some(row => row.id === id)) || criteria.some(row => !expectedIds.includes(row.id))) add('INCOMPLETE_ACCEPTANCE_COVERAGE');
      const followups = (await readJson('docs/acceptance-criteria.json')).followup_criteria ?? [];
      const followupIds = (requirements.followups ?? []).flatMap(row => row.acceptance_ids);
      if (new Set(followups.map(row => row.id)).size !== followups.length || followupIds.length !== followups.length || followupIds.some(id => !followups.some(row => row.id === id))) add('INCOMPLETE_FOLLOWUP_COVERAGE');
      for (let issue = 4; issue <= 30; issue++) if (!requirements.issues.some(row => row.issue === issue)) add('MISSING_REQUIREMENT_MAP', null, { issue });
      break;
    }
    default: add('UNKNOWN_COMMAND');
  }
  return { command, scope: options.before || options.after ? 'schema_comparison' : options.contract ?? (options.foundation ? 'foundation_only' : options.implemented ? 'implemented_candidates_only' : 'full_catalog'), status: failures.length ? 'failed_or_blocked' : 'passed', checked: options.before || options.after ? 2 : command === 'consumers' ? knownConsumers.length : selected.length, failures };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const flags = ['require-owner', 'require-consumer', 'require-leaf', 'require-version-policy', 'require-field-classification', 'policy-only', 'require-fixtures', 'require-docs', 'require-consumer-pins'];
  const valued = ['contract', 'paths', 'before', 'after'];
  const allowed = { check: ['contract', 'foundation', 'implemented'], fixtures: ['contract', 'foundation', 'implemented'], compat: ['contract', 'foundation', 'implemented', 'before', 'after'], inventory: [...flags, 'foundation', 'implemented'], consumers: ['paths'], docs: [] };
  if (!Object.hasOwn(allowed, command)) throw new Error('Unknown command');
  if (args.length === 1 && args[0] === '--help') console.log('contracts ' + command + ' ' + allowed[command].map(flag => '--' + flag + (valued.includes(flag) ? ' VALUE' : '')).join(' '));
  else {
    const options = {};
    for (let index = 0; index < args.length; index++) {
      const flag = args[index].slice(2);
      if (!args[index].startsWith('--') || !allowed[command]?.includes(flag) || Object.hasOwn(options, flag)) throw new Error('Unknown or duplicate flag');
      if (valued.includes(flag)) {
        const value = args[++index];
        if (!value || value.startsWith('--')) throw new Error('Missing flag value');
        options[flag] = value;
      } else options[flag] = true;
    }
    if ([options.contract, options.foundation, options.implemented].filter(Boolean).length > 1) throw new Error('Choose one contract-check scope');
    const result = await execute(command, options);
    console.log(JSON.stringify(result, null, 2));
    if (result.failures.length) process.exitCode = 1;
  }
}
import { runCanonicalFixtures, assertFixture } from '../tooling/fixture-harness.mjs';
import { consumerChecks, pinsMatch, knownConsumers } from './consumer-checks.mjs';
export { consumerChecks, pinsMatch } from './consumer-checks.mjs';
