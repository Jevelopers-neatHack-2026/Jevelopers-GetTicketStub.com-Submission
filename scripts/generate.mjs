import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { compile } from 'json-schema-to-typescript';
import { createHash } from 'node:crypto';
import { productionSchema, validatorModules } from './production-validator-modules.mjs';
import ts from 'typescript';
import { packageContentManifest } from './package-content.mjs';

function immutableDeclaration(source) {
  const ast = ts.createSourceFile('contract.d.ts', source, ts.ScriptTarget.Latest, true);
  const transformed = ts.transform(ast, [context => {
    function visit(node) {
      const child = ts.visitEachChild(node, visit, context);
      if (ts.isPropertySignature(child)) return ts.factory.updatePropertySignature(child, [ts.factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)], child.name, child.questionToken, child.type);
      if (ts.isIndexSignatureDeclaration(child)) return ts.factory.updateIndexSignature(child, [ts.factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)], child.parameters, child.type);
      if (ts.isArrayTypeNode(child)) return ts.factory.createTypeOperatorNode(ts.SyntaxKind.ReadonlyKeyword, child);
      if (ts.isTupleTypeNode(child)) return ts.factory.createTypeOperatorNode(ts.SyntaxKind.ReadonlyKeyword, child);
      return child;
    }
    return node => ts.visitNode(node, visit);
  }]);
  const result = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed.transformed[0]);
  transformed.dispose();
  return result;
}

export function versionTypeHeader(versions) {
  const names = Object.keys(versions);
  const imports = names.flatMap(name => Object.values(versions[name]).map(exportName => `import type { ${name} as ${exportName} } from './${exportName}.js';\nexport type { ${exportName} };`));
  return imports.join('\n') + '\n' + names.map(name => `export type ${name} = ${Object.values(versions[name]).join(' | ')};`).join('\n');
}
export const root = fileURLToPath(new URL('../', import.meta.url));
export const readJson = async path => JSON.parse(await readFile(root + path, 'utf8'));
export async function schemaFiles() {
  const contracts = (await readdir(root + 'schemas', { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const result = [];
  for (const contract of contracts) {
    for (const file of (await readdir(root + 'schemas/' + contract)).filter(file => file.endsWith('.json')).sort()) result.push('schemas/' + contract + '/' + file);
  }
  return result;
}
export function compiler() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, inlineRefs: false, ownProperties: true, coerceTypes: false, useDefaults: false, removeAdditional: false, code: { source: true, esm: true, formats: false } });
  ajv.addKeyword({ keyword: 'x-classification', schemaType: 'string' });
  ajv.addKeyword({ keyword: 'tsType', schemaType: 'string' });
  ajv.addFormat('uuid', /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  // Calendar validity is enforced by this expression, including Gregorian leap years.
  ajv.addFormat('utc-time', /^(?:(?:[0-9]{4})-(?:(?:01|03|05|07|08|10|12)-(?:0[1-9]|[12][0-9]|3[01])|(?:04|06|09|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8]))|(?:[0-9]{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)-02-29)T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{3})?Z$/);
  return ajv;
}
export async function outputs() {
  const paths = await schemaFiles();
  const ajv = compiler();
  const schemas = await Promise.all(paths.map(readJson));
  const packageManifest = await readJson('package.json');
  const localSchemas = new Map(schemas.map(schema => [schema.$id, schema]));
  const refOptions = { resolve: { file: false, http: false, local: { order: 1, canRead: file => localSchemas.has(file.url), read: file => structuredClone(localSchemas.get(file.url)) } } };
  for (const schema of schemas) ajv.addSchema(schema);
  const versions = {};
  const exports = {};
  const primitiveValidators = {};
  let primitiveDeclarations = "import type { Brand } from './brands.js';\n";
  const manifest = [];
  const result = new Map();
  for (const [index, schema] of schemas.entries()) {
    const version = schema.properties.schema_version.const;
    if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[A-Z][A-Za-z0-9]+$/.test(schema.title) || paths[index] !== `schemas/${schema.title}/${version}.json` || schema.$id !== `https://schemas.jevelopers.org/${schema.title}/${version}`) throw new Error('Schema identity/path mismatch: ' + paths[index]);
    if (Object.hasOwn(versions[schema.title] ?? {}, version)) throw new Error('Duplicate contract version');
    const exportName = schema.title + '_' + version.replaceAll('.', '_');
    versions[schema.title] ??= {};
    versions[schema.title][version] = exportName;
    exports[exportName] = schema.$id;
    for (const [name, definition] of Object.entries(schema.$defs ?? {})) {
      if (!definition.tsType) continue;
      if (Object.hasOwn(primitiveValidators, name)) throw new Error('Duplicate primitive: ' + name);
      const primitiveExport = 'Primitive' + name;
      exports[primitiveExport] = schema.$id + '#/$defs/' + name;
      primitiveValidators[name] = primitiveExport;
      const declaration = await compile(definition, name, { bannerComment: '', unknownAny: true, $refOptions: refOptions });
      primitiveDeclarations += immutableDeclaration(declaration);
    }
    const source = await readFile(root + paths[index]);
    manifest.push({ contract: schema.title, version, schema_id: schema.$id, path: paths[index], sha256: createHash('sha256').update(source).digest('hex') });
    const declaration = await compile(schema, schema.title, { bannerComment: "import type { Brand } from './brands.js';", cwd: root, $refOptions: refOptions, additionalProperties: false, unknownAny: true, ...(['PrintSpec', 'FulfillmentCapabilitySnapshot'].includes(schema.title) || productionSchema(schema) ? { ignoreMinAndMaxItems: true } : {}) });
    result.set(exportName + '.d.ts', immutableDeclaration(declaration));
  }
  exports.DefinitionVersionedReference = 'https://schemas.jevelopers.org/ErrorEnvelope/1.0.0#/$defs/VersionedReference';
  exports.DefinitionDecisionQuestion = 'https://schemas.jevelopers.org/DecisionPortRequest/1.0.0#/properties/questions/additionalProperties';
  exports.DefinitionApprovalBinding = 'https://schemas.jevelopers.org/ApprovalReceipt/1.0.0#/$defs/ApprovalBinding';
  exports.DefinitionProductionReference = 'https://schemas.jevelopers.org/ProductionReference/1.0.0#/$defs/Reference';
  const modules = await validatorModules(ajv, exports, root);
  for (const module of modules) result.set(module.filename, module.contents);
  const bundled = { metafile: { inputs: Object.assign({}, ...modules.map(module => module.bundled.metafile.inputs)) } };
  const lock = await readJson('package-lock.json');
  const embedded = [...new Set(Object.keys(bundled.metafile.inputs).filter(path => path.includes('node_modules/')).map(path => path.split('node_modules/').at(-1).split('/')[0]))].sort();
  const provenance = [];
  let notices = '# Third-party notices\n\nThese notices apply to bundled dependency code only. They do not license shared-contracts.\n';
  for (const name of embedded) {
    const metadata = await readJson('node_modules/' + name + '/package.json');
    const licenseFile = (await readdir(root + 'node_modules/' + name)).find(path => /^licen[cs]e(?:\\.|$)/i.test(path));
    if (!licenseFile || !lock.packages['node_modules/' + name]?.integrity) throw new Error('Missing dependency notice or immutable lock: ' + name);
    const license = await readFile(root + 'node_modules/' + name + '/' + licenseFile, 'utf8');
    notices += '\n## ' + name + '@' + metadata.version + '\n\n' + license.trimEnd() + '\n';
    provenance.push({ name, version: metadata.version, license: metadata.license, integrity: lock.packages['node_modules/' + name].integrity, source_files: Object.keys(bundled.metafile.inputs).filter(path => path.includes('node_modules/' + name + '/')).sort(), notice_sha256: 'sha256:' + createHash('sha256').update(license).digest('hex') });
  }
  result.set('THIRD_PARTY_NOTICES.md', notices);
  result.set('dependency-provenance.json', JSON.stringify({ project_license: null, runtime_npm_dependencies: 0, embedded, packages: provenance, build_dependencies: Object.entries(packageManifest.devDependencies).map(([name, version]) => ({ name, version, integrity: lock.packages['node_modules/' + name].integrity, license: lock.packages['node_modules/' + name].license })) }, null, 2) + '\n');
  result.set('registry.mjs', 'const records = ' + JSON.stringify(versions, null, 2) + ';\nfor (const record of Object.values(records)) Object.freeze(record);\nexport const versions = Object.freeze(records);\nexport const primitiveValidators = Object.freeze(' + JSON.stringify(primitiveValidators, null, 2) + ');\n');
  result.set('primitives.d.ts', primitiveDeclarations);
  const fixtureFiles = (await readdir(root + 'fixtures')).filter(name => name.endsWith('.json')).sort();
  const fixtureHashes = {};
  for (const name of fixtureFiles) fixtureHashes['fixtures/' + name] = 'sha256:' + createHash('sha256').update(await readFile(root + 'fixtures/' + name)).digest('hex');
  const fixtureContracts = [];
  for (const name of fixtureFiles) {
    const fixture = await readJson('fixtures/' + name);
    if (!fixture.cases) continue;
    fixtureContracts.push({ contract: fixture.contract, version: fixture.schema_version, policy_version: fixture.policy_version, path: 'fixtures/' + name, cases: fixture.cases.map(row => ({ id: row.id, category: row.category, policy_version: row.policy_version, mode: row.mode ?? 'structural', expected: row.expected })) });
  }
  result.set('fixture-manifest.json', JSON.stringify({ files: fixtureHashes, digest: 'sha256:' + createHash('sha256').update(JSON.stringify(fixtureHashes)).digest('hex'), status: 'synthetic_candidates_only', contracts: fixtureContracts }, null, 2) + '\n');
  result.set('schema-manifest.json', JSON.stringify({ package_version: packageManifest.version, source_revision: null, status: 'unreleased_candidates', toolchain: { ajv: '8.17.1', esbuild: '0.25.12', typescript: '5.9.3', json_schema_to_typescript: '15.0.4', node: '22.23.3' }, schemas: manifest }, null, 2) + '\n');
  result.set('brands.d.ts', 'declare const brand: unique symbol;\nexport type Brand<T, Name extends string> = T & { readonly [brand]: Name };\n');
  const names = Object.keys(versions);
  result.set('index.mjs', "export { validateContract, validateContractVersion, parseContract, parseContractVersion, validatePrimitive, checkTrustedContext, projectEvidence, canonicalJson, hashManifest, hashBytes, ContractError } from '../tooling/runtime.mjs';\nexport * from '../tooling/operations.mjs';\nexport * from '../tooling/research-creative.mjs';\nexport * from '../tooling/commerce-evidence.mjs';\nexport * from '../tooling/finance-v2.mjs';\nexport * from '../tooling/capability.mjs';\nexport { versions } from './registry.mjs';\n");
  result.set('operations.d.ts', (await readFile(root + 'tooling/operations-api.d.ts', 'utf8')).replace('../generated/index.js', './index.js'));
  result.set('research-creative.d.ts', (await readFile(root + 'tooling/research-creative-api.d.ts', 'utf8')).replaceAll('../generated/index.js', './index.js'));
  result.set('commerce-evidence.d.ts', (await readFile(root + 'tooling/commerce-evidence-api.d.ts', 'utf8')).replaceAll('../generated/index.js', './index.js'));
  result.set('finance-v2.d.ts', (await readFile(root + 'tooling/finance-v2-api.d.ts', 'utf8')).replaceAll('../generated/index.js', './index.js'));
  result.set('capability.d.ts', (await readFile(root + 'tooling/capability-api.d.ts', 'utf8')).replaceAll('../generated/index.js', './index.js'));
  result.set('production-operations.d.ts', (await readFile(root + 'tooling/production-operations-api.d.ts', 'utf8')).replaceAll('../generated/index.js', './index.js'));
  const details = localSchemas.get('https://schemas.jevelopers.org/ErrorEnvelope/1.0.0').$defs.ErrorDetail.oneOf;
  const errorRegistry = Object.fromEntries(details.map(detail => [detail.properties.code.const, { category: detail.properties.category.const, safe_message: detail.properties.safe_message.const }]));
  result.set('error-registry.mjs', 'const records = ' + JSON.stringify(errorRegistry, null, 2) + ';\nfor (const record of Object.values(records)) Object.freeze(record);\nexport const errorRegistry = Object.freeze(records);\n');
  result.set('fixture-harness.d.ts', `export type FixtureExpectation = { readonly ok: boolean; readonly code?: string; readonly path?: string; readonly value?: unknown; readonly canonical_sha256?: string };
export type FixtureCase = { readonly id: string; readonly category: string; readonly policy_version: string; readonly consumer_version?: string; readonly mode?: string; readonly remove?: readonly string[]; readonly set?: Readonly<Record<string, unknown>>; readonly context?: unknown; readonly expected_context?: unknown; readonly prior?: unknown; readonly json?: string; readonly expected: FixtureExpectation };
export type FixtureManifest = { readonly contract: string; readonly schema_version: string; readonly policy_version: string; readonly valid: unknown; readonly cases: readonly FixtureCase[] };
export type FixtureIssue = { readonly code: string; readonly contract: string; readonly case?: string | null; readonly category?: string };
export type FixtureRecord = { readonly contract: string; readonly version: string; readonly case: string; readonly category: string; readonly policy_version: string; readonly mode: string; readonly expected: FixtureExpectation; readonly profile?: 'historical_finance_characterization'; readonly operational_authority?: false; readonly canonical_sha256: string | null };
export declare const fixtureCategories: readonly string[];
export declare function fixturePayload(manifest: FixtureManifest, fixture: FixtureCase): unknown;
export declare function evaluateFixture(contract: string, manifest: FixtureManifest, fixture: FixtureCase): { readonly ok: boolean; readonly value?: unknown; readonly errors?: readonly { readonly code: string; readonly path: string }[] };
export declare function assertFixture(result: { readonly ok: boolean; readonly value?: unknown; readonly errors?: readonly { readonly code: string; readonly path: string }[] }, expected: FixtureExpectation): void;
export declare function runCanonicalFixtures(contract: string, manifest: FixtureManifest): { readonly failures: readonly FixtureIssue[]; readonly records: readonly FixtureRecord[] };
`);
  result.set('index.d.ts', versionTypeHeader(versions) + `
export type { Brand } from './brands.js';
export * from './operations.js';
export * from './research-creative.js';
export * from './commerce-evidence.js';
export * from './finance-v2.js';
export * from './capability.js';
export type * from './primitives.js';
import type * as Primitives from './primitives.js';
export type PrimitiveName = keyof PrimitiveMap;
export type PrimitiveMap = { ${Object.keys(primitiveValidators).map(name => `readonly ${name}: Primitives.${name}`).join('; ')} };
export type ContractMap = { ${names.map(name => `readonly ${name}: ${name}`).join('; ')} };
export type ContractName = keyof ContractMap;
export type ContractVersionMap = { ${names.map(name => `readonly ${name}: { ${Object.entries(versions[name]).map(([version, exportName]) => `readonly '${version}': ${exportName}`).join('; ')} }`).join('; ')} };
export type ValidationCode = 'UNKNOWN_CONTRACT' | 'INVALID_PAYLOAD' | 'UNSUPPORTED_VERSION' | 'MALFORMED_JSON' | 'INVALID_TRUST_CONTEXT' | 'SCOPE_MISMATCH' | 'NON_CANONICAL_NUMBER' | 'INVALID_UNICODE' | 'NON_JSON_VALUE' | 'CYCLIC_VALUE' | 'INVALID_BYTES';
export type Issue = { readonly code: ValidationCode; readonly path: string; readonly keyword?: string };
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly Issue[] };
export type TrustedContext = Pick<CommonEnvelope, 'tenant_id' | 'project_id'> & Partial<Pick<CommonEnvelope, 'design_id' | 'design_version_id' | 'artifact_id' | 'order_id'>>;
export declare function validateContract<K extends ContractName>(contract: K, value: unknown): Result<ContractMap[K]>;
export declare function parseContract<K extends ContractName>(contract: K, json: string): Result<ContractMap[K]>;
export declare function validateContractVersion<K extends ContractName, V extends keyof ContractVersionMap[K]>(contract: K, version: V, value: unknown): Result<ContractVersionMap[K][V]>;
export declare function parseContractVersion<K extends ContractName, V extends keyof ContractVersionMap[K]>(contract: K, version: V, json: string): Result<ContractVersionMap[K][V]>;
export declare function validatePrimitive<K extends keyof PrimitiveMap>(name: K, value: unknown): Result<PrimitiveMap[K]>;
export declare function checkTrustedContext<T extends TrustedContext>(value: T, expected: TrustedContext): Result<T>;
export declare function projectEvidence(value: unknown): Result<EvidenceProjection>;
export declare function canonicalJson(value: unknown): string;
export declare function hashManifest(value: unknown): string;
export declare function hashBytes(bytes: Uint8Array): string;
export declare const versions: { ${names.map(name => `readonly ${name}: { ${Object.entries(versions[name]).map(([version, exportName]) => `readonly '${version}': '${exportName}'`).join('; ')} }`).join('; ')} };
export declare class ContractError extends Error { readonly code: ValidationCode; readonly path: string; constructor(code: ValidationCode, path?: string); }
`);
  result.set('package-content-manifest.json', JSON.stringify(await packageContentManifest(root, result), null, 2) + '\n');
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags = process.argv.slice(2);
  if (flags.length === 1 && flags[0] === '--help') { console.log('generate [--check]: generate all supported schemas or fail on drift'); }
  else {
    if (flags.some(flag => flag !== '--check')) throw new Error('Unknown generation flag');
    const result = await outputs();
    await mkdir(root + 'generated', { recursive: true });
    const stale = (await readdir(root + 'generated')).filter(name => !result.has(name));
    if (stale.length) throw new Error('Unindexed generated files: ' + stale.join(', '));
    for (const [path, content] of result) {
      if (flags.includes('--check')) {
        const actual = await readFile(root + 'generated/' + path, 'utf8');
        if (actual !== content) throw new Error('Generated drift: ' + path);
      } else await writeFile(root + 'generated/' + path, content);
    }
    console.log(JSON.stringify({ status: 'passed', generated_files: result.size, drift: flags.includes('--check') ? 'none' : 'generated' }));
  }
}
