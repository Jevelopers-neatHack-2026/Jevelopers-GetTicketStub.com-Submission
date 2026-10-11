import { readFile, access, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { root, readJson, schemaFiles, compiler, outputs } from './generate.mjs';
import { validateContract, parseContract, checkTrustedContext, hashBytes, hashManifest, canonicalJson } from '../tooling/runtime.mjs';
import { checkOperation, compareUsageIdentity } from '../tooling/operations.mjs';
import { checkResearchCreative } from '../tooling/research-creative.mjs';
import { schemaImpact } from './compatibility.mjs';

const knownConsumers = ['agent-harness', 'event-intelligence', 'creative-engine', 'print-production', 'fulfillment-connectors', 'cost-intelligence', 'team-dashboard', 'integration-evals', 'getticketstub.com'];
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
export function classifications(schema, taxonomy, path = '') {
  const issues = [];
  if (schema.properties) for (const [key, field] of Object.entries(schema.properties)) {
    const fieldPath = path + '/' + key;
    if (!taxonomy.includes(field['x-classification'])) issues.push({ code: 'UNCLASSIFIED_FIELD', path: fieldPath });
    issues.push(...classifications(field, taxonomy, fieldPath));
  }
  if (schema.items) issues.push(...classifications(schema.items, taxonomy, path + '/*'));
  for (const field of Object.values(schema.patternProperties ?? {})) {
    if (!taxonomy.includes(field['x-classification'])) issues.push({ code: 'UNCLASSIFIED_FIELD', path: path + '/*' });
    issues.push(...classifications(field, taxonomy, path + '/*'));
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    if (!taxonomy.includes(schema.additionalProperties['x-classification'])) issues.push({ code: 'UNCLASSIFIED_FIELD', path: path + '/*' });
    issues.push(...classifications(schema.additionalProperties, taxonomy, path + '/*'));
  }
  for (const keyword of ['$defs', 'definitions']) for (const field of Object.values(schema[keyword] ?? {})) issues.push(...classifications(field, taxonomy, path));
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) for (const field of schema[keyword] ?? []) issues.push(...classifications(field, taxonomy, path));
  return issues;
}
export function assertFixture(result, expected) {
  if (expected.ok) {
    if (!result.ok) throw new Error('Positive fixture rejected');
    if (Object.hasOwn(expected, 'value') && canonicalJson(result.value) !== canonicalJson(expected.value)) throw new Error('Fixture value mismatch');
  } else if (result.ok || !result.errors.some(error => error.code === expected.code && error.path === expected.path)) throw new Error('Negative fixture did not produce expected code/path');
}
export async function runFixtures(entry) {
  if (!await exists(entry.fixtures)) return [{ code: 'MISSING_FIXTURES', contract: entry.name }];
  const manifest = await readJson(entry.fixtures);
  const categories = new Set();
  const failures = [];
  for (const fixture of manifest.cases) {
    categories.add(fixture.category);
    let result;
    const payload = structuredClone(manifest.valid);
    for (const key of fixture.remove ?? []) delete payload[key];
    Object.assign(payload, fixture.set ?? {});
    if (fixture.mode === 'research_creative') {
      const context = structuredClone(fixture.context);
      if (context.artifact_bytes) context.artifact_bytes = Object.fromEntries(Object.entries(context.artifact_bytes).map(([id, bytes]) => [id, Uint8Array.from(bytes)]));
      result = checkResearchCreative(entry.name, payload, context);
    }
    else if (fixture.mode === 'semantic') result = checkOperation(entry.name, payload, fixture.context);
    else if (fixture.mode === 'relationship') result = compareUsageIdentity(fixture.prior, payload);
    else if (fixture.mode === 'context') result = checkTrustedContext(payload, fixture.expected_context);
    else if (fixture.mode === 'parse') result = parseContract(entry.name, fixture.json);
    else result = validateContract(entry.name, payload);
    try { assertFixture(result, fixture.expected); } catch (error) {
      if (!(error instanceof Error)) throw error;
      failures.push({ code: 'FIXTURE_MISMATCH', contract: entry.name, case: fixture.id });
    }
  }
  for (const category of ['minimal', 'full', 'missing', 'type', 'enum', 'malformed_json', 'unsupported_version', 'unknown_field']) if (!categories.has(category)) failures.push({ code: 'MISSING_FIXTURE_CATEGORY', contract: entry.name, category });
  return failures;
}
export function pinsMatch(entry, schemas, fixtureDigest) {
  return sha(entry.shared_source_revision) && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.package_integrity ?? '') &&
    entry.fixture_digest === fixtureDigest && entry.schema_pins?.length > 0 &&
    entry.schema_pins.every(pin => schemas.some(schema => schema.contract === pin.contract && schema.version === pin.version && schema.sha256 === pin.sha256)) &&
    entry.acknowledgement?.status === 'accepted' && entry.acknowledgement.consumer_sha === entry.source_sha &&
    entry.acknowledgement.shared_source_revision === entry.shared_source_revision && entry.acknowledgement.fixture_digest === fixtureDigest &&
    typeof entry.acknowledgement.record_ref === 'string' && entry.acknowledgement.record_ref.length > 0;
}

export async function consumerChecks(manifest, paths = {}) {
  const failures = [];
  const records = [];
  const schemaManifest = await readJson('generated/schema-manifest.json');
  const fixtureManifest = await readJson('generated/fixture-manifest.json');
  if (hashManifest(fixtureManifest.files) !== fixtureManifest.digest) return { failures: [{ code: 'INVALID_FIXTURE_DIGEST' }], records };
  for (const [path, digest] of Object.entries(fixtureManifest.files)) if (!await exists(path) || hashBytes(await readFile(root + path)) !== digest) return { failures: [{ code: 'STALE_FIXTURE_DIGEST' }], records };
  for (const repository of knownConsumers) {
    const matches = manifest.repositories.filter(entry => entry.repository === repository);
    if (matches.length !== 1) { failures.push({ code: 'MISSING_OR_DUPLICATE_CONSUMER', repository }); continue; }
    const entry = matches[0];
    const path = paths[repository] ?? entry.local_path;
    const block = code => failures.push({ code, repository });
    if (!sha(entry.source_sha)) { block('INVALID_SOURCE_PIN'); continue; }
    if (!path) { block('BLOCKED_MISSING_CHECKOUT'); continue; }
    const revision = spawnSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    if (revision.status !== 0 || revision.stdout.trim() !== entry.source_sha) { block('BLOCKED_REVISION_MISMATCH'); continue; }
    const dirty = spawnSync('git', ['-C', path, 'status', '--porcelain'], { encoding: 'utf8' });
    if (dirty.status !== 0 || dirty.stdout.trim()) { block('BLOCKED_DIRTY_CHECKOUT'); continue; }
    if (!pinsMatch(entry, schemaManifest.schemas, fixtureManifest.digest) || entry.dependency_mode !== 'offline') { block('BLOCKED_MISSING_INTEGRATION_PIN'); continue; }
    const required = (await catalog()).filter(contract => contract.producers.includes(repository) || contract.consumers.includes(repository));
    if (required.some(contract => !entry.schema_pins.some(pin => pin.contract === contract.name))) { block('BLOCKED_INCOMPLETE_CONSUMER_COVERAGE'); continue; }
    if (!Array.isArray(entry.command) || entry.command.length !== 2 || entry.command[0] !== 'node' || typeof entry.command[1] !== 'string' || !entry.command[1].endsWith('.mjs')) { block('BLOCKED_MISSING_CONSUMER_COMMAND'); continue; }
    const script = resolve(path, entry.command[1]);
    const checkout = await realpath(path);
    const actualScript = await realpath(script);
    if (isAbsolute(entry.command[1]) || relative(checkout, actualScript).startsWith('..')) { block('INVALID_CONSUMER_COMMAND'); continue; }
    const result = spawnSync(process.execPath, [actualScript], { cwd: checkout, encoding: 'utf8', timeout: 120000, env: { PATH: process.env.PATH, SHARED_CONTRACTS_ROOT: root, SHARED_CONTRACTS_OFFLINE: '1' } });
    if (result.status !== 0) { block('CONSUMER_CHECK_FAILED'); continue; }
    let receipt;
    try { receipt = JSON.parse(result.stdout); } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      block('MISSING_CONSUMER_RECEIPT'); continue;
    }
    if (receipt.status !== 'passed' || receipt.consumer_sha !== entry.source_sha || receipt.shared_source_revision !== entry.shared_source_revision || receipt.fixture_digest !== entry.fixture_digest || !Array.isArray(receipt.contracts_tested) || required.some(contract => !receipt.contracts_tested.includes(contract.name))) { block('INVALID_CONSUMER_RECEIPT'); continue; }
    records.push({ repository, source_sha: entry.source_sha, status: 'passed', command: entry.command });
  }
  return { failures, records };
}

export async function execute(command, options) {
  const entries = await catalog();
  const selected = options.contract ? entries.filter(entry => entry.name === options.contract || entry.group === options.contract) : options.foundation ? entries.filter(entry => entry.state === 'foundation_candidate') : options.implemented ? entries.filter(entry => entry.schema_path) : entries;
  const failures = [];
  const add = (code, entry, extra = {}) => failures.push({ code, ...(entry ? { contract: entry.name } : {}), ...extra });
  if (!selected.length) add('UNKNOWN_CONTRACT');
  const policy = await readJson('compatibility/version-policy.json');
  const privacy = await readJson('compatibility/privacy-policy.json');
  switch (command) {
    case 'check': {
      const ajv = compiler();
      const paths = await schemaFiles();
      for (const path of paths) ajv.addSchema(await readJson(path));
      for (const entry of selected) {
        if (!await exists(entry.schema_path) || !await exists(entry.generated_export)) { add('MISSING_SCHEMA_OR_EXPORT', entry); continue; }
        const schema = await readJson(entry.schema_path);
        ajv.getSchema(schema.$id);
        failures.push(...classifications(schema, privacy.classifications).map(issue => ({ ...issue, contract: entry.name })));
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
      for (const entry of selected) {
        if (!await exists(entry.schema_path)) { add('MISSING_COMPAT_SCHEMA', entry); continue; }
        const fixture = await readJson(entry.fixtures);
        const baseline = baselines.schemas.find(schema => schema.contract === entry.name && schema.version === entry.schema_version);
        if (!baseline || 'sha256:' + baseline.sha256 !== hashBytes(await readFile(root + entry.schema_path))) add('IMMUTABLE_SCHEMA_DRIFT', entry);
        const rows = matrix.cases.filter(row => row.contract === entry.name);
        if (!rows.length) add('MISSING_COMPAT_CASE', entry);
        for (const row of rows) {
          const payload = { ...fixture.valid, schema_version: row.producer_version };
          const result = validateContract(entry.name, payload);
          const expected = row.accept ? { ok: true } : { ok: false, code: 'UNSUPPORTED_VERSION', path: '/schema_version' };
          try { assertFixture(result, expected); } catch (error) {
            if (!(error instanceof Error)) throw error;
            add('COMPAT_MISMATCH', entry);
          }
          if (row.consumer_version !== entry.schema_version) add('MISSING_CONSUMER_VERSION_VALIDATOR', entry);
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
        if (options['require-leaf'] && (!Number.isInteger(entry.issue) || entry.issue < 4 || entry.issue > 28)) add('MISSING_LEAF', entry);
        if (options['require-version-policy'] && !await exists(entry.version_policy)) add('MISSING_VERSION_POLICY', entry);
        if (options['require-field-classification'] && !options['policy-only']) {
          if (!await exists(entry.schema_path)) add('MISSING_CLASSIFIED_SCHEMA', entry);
          else failures.push(...classifications(await readJson(entry.schema_path), privacy.classifications).map(issue => ({ ...issue, contract: entry.name })));
        }
        if (options['require-fixtures']) failures.push(...await runFixtures(entry));
        if (options['require-docs'] && (!await exists(entry.docs) || !await exists(entry.schema_path) || !await exists(entry.generated_export) || !await exists(entry.helper))) add('MISSING_DISCOVERABLE_ARTIFACT', entry);
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
      break;
    }
    case 'consumers': {
      const manifest = options.manifest ? JSON.parse(await readFile(options.manifest, 'utf8')) : await readJson('compatibility/consumers.json');
      const paths = options.paths ? JSON.parse(await readFile(options.paths, 'utf8')) : {};
      const result = await consumerChecks(manifest, paths);
      failures.push(...result.failures);
      break;
    }
    case 'docs': {
      for (const path of ['README.md', 'docs/contract-catalog.md', 'docs/identity-policy.md', 'docs/privacy-policy.md', 'docs/adr/0001-canonical-schemas.md', 'docs/operations-contracts.md', 'docs/research-creative-contracts.md']) {
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
      const requirements = await readJson('docs/requirements.json');
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
  const valued = ['contract', 'manifest', 'paths', 'before', 'after'];
  const allowed = { check: ['contract', 'foundation', 'implemented'], fixtures: ['contract', 'foundation', 'implemented'], compat: ['foundation', 'implemented', 'before', 'after'], inventory: [...flags, 'foundation', 'implemented'], consumers: ['manifest', 'paths'], docs: [] };
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
