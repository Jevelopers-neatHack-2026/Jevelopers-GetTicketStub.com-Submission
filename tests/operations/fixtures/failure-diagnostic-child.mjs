import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const mode = process.argv[2];
const sourceLocation = `${pathToFileURL(resolve('tests/operations/operations.test.js')).href}:4400:9`;
const cases = {
  assertion: { name: 'AssertionError', code: 'ERR_ASSERTION', failureType: 'testCodeFailure', operator: 'strictEqual' },
  busy: { name: 'Error', code: 'SQLITE_BUSY', failureType: 'testCodeFailure', operator: 'throws' },
  parse: { name: 'SyntaxError', code: 'ERR_TEST_FAILURE', failureType: 'testCodeFailure', operator: null }
};

if (mode === 'timeout') {
  process.stdout.write('TAP version 13\n# Subtest: OPS13.C01 controlled timeout\n');
  setInterval(() => {}, 60_000);
} else {
  const failure = cases[mode];
  if (!failure) process.exit(2);
  process.stdout.write([
    'TAP version 13',
    '1..1',
    'not ok 1 - OPS13.C01 controlled failure diagnostic',
    '  ---',
    `  failureType: '${failure.failureType}'`,
    `  location: '${sourceLocation}'`,
    `  name: '${failure.name}'`,
    `  code: '${failure.code}'`,
    failure.operator ? `  operator: '${failure.operator}'` : null,
    "  actual: 'SYNTHETIC_PRIVATE_DIAGNOSTIC_CANARY_96d'",
    "  expected: 'safe-control-value'",
    "  error: 'SYNTHETIC_PRIVATE_DIAGNOSTIC_CANARY_96d'",
    '  stack: |-',
    '    at controlled failure fixture',
    '  ...',
    '# tests 1',
    '# pass 0',
    '# fail 1',
    '# skipped 0',
    ''
  ].filter(line => line !== null).join('\n'));
  process.exitCode = 1;
}
