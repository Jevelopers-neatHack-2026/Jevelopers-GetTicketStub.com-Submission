import assert from 'node:assert/strict';

const publicSubpaths = [
  'api/v1',
  'contracts',
  'contracts/creative/v1',
  'contracts/decision-port/v1',
  'contracts/metering',
  'contracts/approval-handoff',
  'contracts/composition-authority',
  'preflight',
  'planning',
  'versions',
  'controls',
  'inspection',
  'models',
  'telemetry',
];
const imported = [];
for (const subpath of publicSubpaths) {
  const specifier = `creative-engine/${subpath}`;
  const module = await import(specifier);
  assert.ok(Object.keys(module).length > 0, `${specifier} must resolve to its public module`);
  imported.push({ specifier, exports: Object.keys(module).sort() });
}
console.log(JSON.stringify({ public_exports_imported: imported }));
