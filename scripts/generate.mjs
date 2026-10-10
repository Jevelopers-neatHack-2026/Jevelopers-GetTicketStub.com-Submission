import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import standalone from 'ajv/dist/standalone/index.js';
import { compile } from 'json-schema-to-typescript';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import ts from 'typescript';

function immutableDeclaration(source) {
  const ast = ts.createSourceFile('contract.d.ts', source, ts.ScriptTarget.Latest, true);
  const transformed = ts.transform(ast, [context => {
    function visit(node) {
      const child = ts.visitEachChild(node, visit, context);
      if (ts.isPropertySignature(child)) return ts.factory.updatePropertySignature(child, [ts.factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)], child.name, child.questionToken, child.type);
      if (ts.isArrayTypeNode(child)) return ts.factory.createTypeOperatorNode(ts.SyntaxKind.ReadonlyKeyword, child);
      return child;
    }
    return node => ts.visitNode(node, visit);
  }]);
  const result = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed.transformed[0]);
  transformed.dispose();
  return result;
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
  const ajv = new Ajv2020({ strict: true, allErrors: true, ownProperties: true, coerceTypes: false, useDefaults: false, removeAdditional: false, code: { source: true, esm: true, formats: false } });
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
    ajv.addSchema(schema);
    const exportName = schema.title + '_' + version.replaceAll('.', '_');
    versions[schema.title] ??= {};
    versions[schema.title][version] = exportName;
    exports[exportName] = schema.$id;
    for (const [name, definition] of Object.entries(schema.$defs ?? {})) {
      if (Object.hasOwn(primitiveValidators, name)) throw new Error('Duplicate primitive: ' + name);
      const primitiveExport = 'Primitive' + name;
      exports[primitiveExport] = schema.$id + '#/$defs/' + name;
      primitiveValidators[name] = primitiveExport;
      const declaration = await compile(definition, name, { bannerComment: '', unknownAny: true });
      primitiveDeclarations += immutableDeclaration(declaration);
    }
    const source = await readFile(root + paths[index]);
    manifest.push({ contract: schema.title, version, schema_id: schema.$id, path: paths[index], sha256: createHash('sha256').update(source).digest('hex') });
    const declaration = await compile(schema, schema.title, { bannerComment: "import type { Brand } from './brands.js';", cwd: root, $refOptions: { resolve: { http: false } }, additionalProperties: false, unknownAny: true });
    result.set(exportName + '.d.ts', immutableDeclaration(declaration));
  }
  const bundled = await build({ stdin: { contents: standalone.default(ajv, exports), resolveDir: root, sourcefile: 'validators.mjs' }, bundle: true, write: false, metafile: true, format: 'esm', platform: 'node', target: 'node22', legalComments: 'none' });
  const validation = bundled.outputFiles[0].text;
  if (Object.values(bundled.metafile.outputs).some(output => output.imports.length)) throw new Error('Standalone validators require a runtime dependency');
  result.set('validators.mjs', validation.trimEnd() + '\n');
  result.set('registry.mjs', 'const records = ' + JSON.stringify(versions, null, 2) + ';\nfor (const record of Object.values(records)) Object.freeze(record);\nexport const versions = Object.freeze(records);\nexport const primitiveValidators = Object.freeze(' + JSON.stringify(primitiveValidators, null, 2) + ');\n');
  result.set('primitives.d.ts', primitiveDeclarations);
  const fixtureFiles = (await readdir(root + 'fixtures')).filter(name => name.endsWith('.json')).sort();
  const fixtureHashes = {};
  for (const name of fixtureFiles) fixtureHashes['fixtures/' + name] = 'sha256:' + createHash('sha256').update(await readFile(root + 'fixtures/' + name)).digest('hex');
  result.set('fixture-manifest.json', JSON.stringify({ files: fixtureHashes, digest: 'sha256:' + createHash('sha256').update(JSON.stringify(fixtureHashes)).digest('hex'), status: 'synthetic_foundation_only' }, null, 2) + '\n');
  result.set('schema-manifest.json', JSON.stringify({ package_version: '0.1.0', source_revision: null, status: 'unreleased_foundation', toolchain: { ajv: '8.17.1', esbuild: '0.25.12', typescript: '5.9.3', json_schema_to_typescript: '15.0.4', node: '22.23.3' }, schemas: manifest }, null, 2) + '\n');
  result.set('brands.d.ts', 'declare const brand: unique symbol;\nexport type Brand<T, Name extends string> = T & { readonly [brand]: Name };\n');
  const names = Object.keys(versions);
  result.set('index.mjs', "export { validateContract, parseContract, validatePrimitive, checkTrustedContext, projectEvidence, canonicalJson, hashManifest, hashBytes, ContractError } from '../tooling/runtime.mjs';\nexport { versions } from './registry.mjs';\n");
  result.set('index.d.ts', names.map(name => `import type { ${name} } from './${versions[name][Object.keys(versions[name]).at(-1)]}.js';\nexport type { ${name} } from './${versions[name][Object.keys(versions[name]).at(-1)]}.js';`).join('\n') + `
export type { Brand } from './brands.js';
export type * from './primitives.js';
import type * as Primitives from './primitives.js';
export type PrimitiveName = keyof PrimitiveMap;
export type PrimitiveMap = { ${Object.keys(primitiveValidators).map(name => `readonly ${name}: Primitives.${name}`).join('; ')} };
export type ContractMap = { ${names.map(name => `readonly ${name}: ${name}`).join('; ')} };
export type ContractName = keyof ContractMap;
export type ValidationCode = 'UNKNOWN_CONTRACT' | 'INVALID_PAYLOAD' | 'UNSUPPORTED_VERSION' | 'MALFORMED_JSON' | 'INVALID_TRUST_CONTEXT' | 'SCOPE_MISMATCH' | 'NON_CANONICAL_NUMBER' | 'INVALID_UNICODE' | 'NON_JSON_VALUE' | 'CYCLIC_VALUE' | 'INVALID_BYTES';
export type Issue = { readonly code: ValidationCode; readonly path: string; readonly keyword?: string };
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly Issue[] };
export type TrustedContext = Pick<CommonEnvelope, 'tenant_id' | 'project_id'> & Partial<Pick<CommonEnvelope, 'design_id' | 'design_version_id' | 'artifact_id' | 'order_id'>>;
export declare function validateContract<K extends ContractName>(contract: K, value: unknown): Result<ContractMap[K]>;
export declare function parseContract<K extends ContractName>(contract: K, json: string): Result<ContractMap[K]>;
export declare function validatePrimitive<K extends keyof PrimitiveMap>(name: K, value: unknown): Result<PrimitiveMap[K]>;
export declare function checkTrustedContext<T extends CommonEnvelope>(value: T, expected: TrustedContext): Result<T>;
export declare function projectEvidence(value: unknown): Result<EvidenceProjection>;
export declare function canonicalJson(value: unknown): string;
export declare function hashManifest(value: unknown): string;
export declare function hashBytes(bytes: Uint8Array): string;
export declare const versions: Readonly<Record<ContractName, Readonly<Record<string, string>>>>;
export declare class ContractError extends Error { readonly code: ValidationCode; readonly path: string; constructor(code: ValidationCode, path?: string); }
`);
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
