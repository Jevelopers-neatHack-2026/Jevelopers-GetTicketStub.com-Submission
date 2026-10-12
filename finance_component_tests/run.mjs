import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createContainer } from './container.mjs';
import { prepareDatabase } from './database.mjs';
import { verifySource, buildSource, fileManifest, recordEvaluator } from './custody.mjs';
import { expectedFiles, expectedCases, validateReceipt, sanitizedJson } from './receipt.mjs';

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[2] === '--candidate-924-fixtures') {
  assert.equal(process.argv.length, 4, 'Candidate fixture mode accepts exactly one output path');
  const { runCandidate924 } = await import('./candidate924.mjs');
  await runCandidate924(process.argv[3]);
  process.exit(process.exitCode ?? 0);
}
const [sourceArg, outputArg] = process.argv.slice(2);
assert.ok(sourceArg && outputArg, 'Usage: node finance_component_tests/run.mjs SOURCE OUTPUT');
const source = resolve(sourceArg);
const output = resolve(outputArg);
const pin = JSON.parse(await readFile(join(here, '../contracts/finance-producer-pin.json'), 'utf8'));
await mkdir(output, { recursive: false });
const home = join(output, 'home');
await mkdir(home);
const environment = { PATH: process.env.PATH, HOME: home, npm_config_cache: join(home, 'npm-cache'), CI: '1', NODE_ENV: 'test' };
const receipt = { kind: 'synthetic-issuer-component-development', source: pin.revision, platform: process.platform,
  node: process.version, status: 'failed', adoptionAccepted: false, tests: [], cases: [] };
const container = createContainer(pin.postgres, home);
receipt.container = container.receipt;
let database;
let sanitize = text => String(text);
try {
  assert.equal(process.platform, 'linux', 'Actual PostgreSQL proof requires authorized Linux CI');
  for (const key of Object.keys(process.env)) assert.ok(!/^(CI_TEST_DB|CI_TEST_DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|DATABASE_URL)/.test(key), `External database environment rejected: ${key}`);
  await recordEvaluator(here, output);
  await verifySource(source, pin, output);
  const ownerSanitizer = await import(pathToFileURL(join(source, 'scripts/sanitize.mjs')));
  sanitize = text => ownerSanitizer.sanitizeOutput(text, [...container.secrets, ...(database?.secrets ?? [])]);
  await buildSource(source, { pin, output, environment, sanitize });
  const connection = container.start();
  database = await prepareDatabase(source, pin, connection);
  receipt.database = database.receipt;
  await database.initialize();
  const { runTestFile } = await import(pathToFileURL(join(source, 'scripts/test-file-evidence.mjs')));
  const testEnvironment = { ...environment, ...database.environment, FINANCE_SOURCE: source, FINANCE_EVIDENCE: output };
  for (const file of expectedFiles) {
    const result = runTestFile(join(here, file), { cwd: here, env: testEnvironment, timeoutMs: 120000 });
    receipt.tests.push({ file, result });
    await writeFile(join(output, `${file}.result.json`), sanitizedJson(result, sanitize));
    assert.equal(result.passed, true, `Actual public scenario failed: ${file}`);
  }
  for (const id of expectedCases) {
    const body = await readFile(join(output, `${id}.json`), 'utf8');
    const parsed = JSON.parse(body);
    assert.equal(parsed.id, id);
    assert.equal(parsed.authority, 'synthetic-owner-fixtures');
    assert.ok(parsed.trace.length > 0);
    await writeFile(join(output, `${id}.json`), sanitizedJson(parsed, sanitize));
  }
  receipt.cases = expectedCases;
  await verifySource(source, pin, output);
  receipt.status = 'passed';
} catch (error) {
  receipt.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  try { if (database) await database.cleanup(); }
  catch (error) { receipt.status = 'failed'; receipt.roleCleanupError = String(error); process.exitCode = 1; }
  try { await writeFile(join(output, 'postgres.log'), sanitize(container.cleanup()) || 'No container logs; no PostgreSQL acceptance.\n'); }
  catch (error) { receipt.status = 'failed'; receipt.containerCleanupError = String(error); process.exitCode = 1; }
  if (receipt.status === 'passed') {
    try { validateReceipt(receipt, pin); }
    catch (error) { receipt.status = 'failed'; receipt.validationError = String(error); process.exitCode = 1; }
  }
  await writeFile(join(output, 'receipt.json'), sanitizedJson(receipt, sanitize));
  const artifacts = (await fileManifest(output)).filter(row => !row.path.startsWith('home/'));
  await writeFile(join(output, 'artifacts.json'), JSON.stringify(artifacts, null, 2));
  console.log(`Finance component ${receipt.status}; receipt: ${join(output, 'receipt.json')}`);
}
