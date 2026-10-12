import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const api = await import(pathToFileURL(join(config.snapshot, 'tooling/fixture-harness.mjs')).href);
const records = [];
for (const fixture of config.required_fixtures) {
  const manifest = JSON.parse(await readFile(join(config.snapshot, fixture.path), 'utf8'));
  const checked = api.runCanonicalFixtures(fixture.contract, manifest);
  if (checked.failures.length) throw new Error('TRUSTED_PACKAGE_FIXTURE_FAILED');
  records.push({ contract: fixture.contract, version: fixture.version, cases: checked.records.length });
}
console.log(JSON.stringify({ status: 'passed', records }));
