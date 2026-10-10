import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compilePlan,
  executeLocalStep,
  executePlanLocally,
  getNextReadyStep,
  getPlanStepIds,
  PlanError,
  validateCompletedResults
} from '../../src/orchestrator/internal/plan.js';
import {
  executeLocalOperation,
  createDefaultRegistry,
  inspectOperation,
  listRegistryOperations
} from '../../src/tools/internal/registry.js';
import { createLimitSet, LIMIT_DEFAULTS } from '../../src/orchestrator/internal/limits.js';

const PLAN_KIND = 'agent-harness.private-synthetic-plan';

function planJson(steps, version = 1, kind = PLAN_KIND) {
  return JSON.stringify({ kind, version, steps });
}

function addStep(id, left, right, dependsOn = []) {
  return { id, operation: 'number.add', dependsOn, args: { left, right } };
}

function mainPlanSteps() {
  return [
    {
      id: 'join',
      operation: 'text.concat',
      dependsOn: ['beta', 'alpha'],
      args: { parts: [{ $result: 'alpha' }, { $result: 'beta' }] }
    },
    {
      id: 'alpha',
      operation: 'text.concat',
      dependsOn: [],
      args: { parts: ['hello'] }
    },
    {
      id: 'beta',
      operation: 'text.concat',
      dependsOn: [],
      args: { parts: [' ', 'world'] }
    },
    addStep('sum', 20, 22)
  ];
}

function errorCode(error) {
  return error instanceof PlanError ? error.code : undefined;
}

function numericChain(count) {
  const steps = [];
  for (let index = 0; index < count; index += 1) {
    const id = 'n' + String(index).padStart(2, '0');
    if (index === 0) steps.push(addStep(id, 0, 1));
    else steps.push(addStep(id, { $result: 'n' + String(index - 1).padStart(2, '0') }, 1, [
      'n' + String(index - 1).padStart(2, '0')
    ]));
  }
  return steps;
}

test('a private dependent plan computes local results with deterministic choice and identity pins', () => {
  const compiled = compilePlan(planJson(mainPlanSteps()));
  const result = executePlanLocally(compiled);

  assert.equal(result.kind, 'agent-harness.private-synthetic-local-result');
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.results.map(item => item.stepId), ['alpha', 'beta', 'join', 'sum']);
  assert.equal(result.results.find(item => item.stepId === 'join').output, 'hello world');
  assert.equal(result.results.find(item => item.stepId === 'sum').output, 42);
  assert.equal(result.results.every(item => item.planHash === compiled.planHash), true);
  assert.equal(result.results.every(item => item.registryVersion === compiled.registryVersion), true);
  assert.equal(result.results.every(item => item.runIdentity === compiled.runIdentity), true);
  assert.equal(result.results.every(item => /^sha256_[0-9a-f]{64}$/.test(item.inputHash)), true);
  assert.equal(result.results.every(item => /^sha256_[0-9a-f]{64}$/.test(item.resultHash)), true);
  assert.equal(result.stoppingFacts.stepsAdmitted, 4);
  assert.equal(result.stoppingFacts.stepAttempts, 4);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.results), true);
  assert.equal(Object.isFrozen(result.results[0]), true);
});

test('equivalent JSON key and step order produces the same plan and result identities', () => {
  const forward = planJson(mainPlanSteps());
  const reversed = JSON.stringify({
    steps: mainPlanSteps().slice().reverse().map(step => ({
      args: step.args,
      dependsOn: step.dependsOn.slice().reverse(),
      operation: step.operation,
      id: step.id
    })),
    version: 1,
    kind: PLAN_KIND
  });

  const firstPlan = compilePlan(forward);
  const secondPlan = compilePlan(reversed);
  const firstResult = executePlanLocally(firstPlan);
  const secondResult = executePlanLocally(secondPlan);
  assert.equal(firstPlan.planHash, secondPlan.planHash);
  assert.equal(firstPlan.registryVersion, secondPlan.registryVersion);
  assert.equal(firstResult.resultHash, secondResult.resultHash);
});

test('the single-step API enforces deterministic readiness and validates saved results', () => {
  const compiled = compilePlan(planJson(mainPlanSteps()));
  const alpha = executeLocalStep(compiled, 'alpha');
  const alphaJson = JSON.stringify({ alpha });
  assert.equal(getNextReadyStep(compiled, alphaJson), 'beta');
  assert.throws(
    () => executeLocalStep(compiled, 'join', alphaJson),
    error => errorCode(error) === 'PLAN_STEP_NOT_READY'
  );

  const beta = executeLocalStep(compiled, 'beta', alphaJson);
  const priorJson = JSON.stringify({ alpha, beta });
  assert.equal(getNextReadyStep(compiled, priorJson), 'join');
  const join = executeLocalStep(compiled, 'join', priorJson);
  assert.equal(join.output, 'hello world');
  assert.equal(validateCompletedResults(compiled, JSON.stringify({ alpha, beta, join })).resultCount, 3);
  assert.throws(
    () => executeLocalStep(compiled, 'alpha', alphaJson),
    error => errorCode(error) === 'PLAN_STEP_ALREADY_COMPLETE'
  );
});

test('local result identity rejects a different workflow and modified output before reuse', () => {
  const source = planJson(mainPlanSteps());
  const first = compilePlan(source, undefined, undefined, 'workflow-a');
  const second = compilePlan(source, undefined, undefined, 'workflow-b');
  const saved = executeLocalStep(first, 'alpha');

  assert.notEqual(first.runIdentity, second.runIdentity);
  assert.throws(
    () => executeLocalStep(second, 'beta', JSON.stringify({ alpha: saved })),
    error => errorCode(error) === 'PLAN_RESULT_IDENTITY_INVALID'
  );

  const forged = { ...saved, output: 'foreign' };
  assert.throws(
    () => executeLocalStep(first, 'beta', JSON.stringify({ alpha: forged })),
    error => errorCode(error) === 'PLAN_RESULT_IDENTITY_INVALID'
  );
});

test('object, accessor, proxy, and toJSON inputs are rejected without invoking caller code', () => {
  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'kind', {
    enumerable: true,
    get() {
      reads += 1;
      return PLAN_KIND;
    }
  });
  const proxied = new Proxy({}, {
    get() {
      reads += 1;
      return PLAN_KIND;
    },
    ownKeys() {
      reads += 1;
      return [];
    }
  });
  const withToJSON = {
    toJSON() {
      reads += 1;
      return planJson(mainPlanSteps());
    }
  };

  for (const hostile of [accessor, proxied, withToJSON]) {
    assert.throws(() => compilePlan(hostile), error => errorCode(error) === 'PLAN_INPUT_INVALID');
  }
  assert.equal(reads, 0);
});

test('the static registry rejects direct accessor and proxy arguments without reading them', () => {
  let reads = 0;
  const parts = ['unused'];
  Object.defineProperty(parts, '0', {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1;
      return 'secret';
    }
  });
  const proxiedArgs = new Proxy({ left: 1, right: 2 }, {
    get() {
      reads += 1;
      return 1;
    },
    ownKeys() {
      reads += 1;
      return ['left', 'right'];
    }
  });
  const registry = createDefaultRegistry();

  assert.deepEqual(executeLocalOperation(registry, 'text.concat', { parts }), {
    ok: false,
    code: 'INVALID_LOCAL_INPUT'
  });
  assert.deepEqual(executeLocalOperation(registry, 'number.add', proxiedArgs), {
    ok: false,
    code: 'INVALID_LOCAL_INPUT'
  });
  assert.equal(reads, 0);
});

test('unknown operations and every external, provider, and privileged effect stay unavailable', () => {
  const registry = createDefaultRegistry();
  const metadata = listRegistryOperations(registry);
  assert.equal(Object.isFrozen(metadata), true);

  assert.equal(Object.hasOwn(registry, 'dispatch'), false);
  assert.equal(metadata.some(entry => Object.values(entry).some(value => typeof value === 'function')), false);

  for (const operation of ['network.fetch', 'provider.image', 'provider.reason', 'system.shell']) {
    assert.deepEqual(inspectOperation(registry, operation), {
      status: 'unavailable',
      effect: operation === 'network.fetch'
        ? 'external'
        : operation === 'system.shell'
          ? 'privileged'
          : 'provider',
      input: 'none',
      output: 'none',
      version: 1
    });
    assert.deepEqual(executeLocalOperation(registry, operation, {}), {
      ok: false,
      code: 'EFFECT_UNAVAILABLE'
    });
    assert.throws(
      () => compilePlan(planJson([{
        id: 'blocked',
        operation,
        dependsOn: [],
        args: {}
      }])),
      error => errorCode(error) === 'PLAN_EFFECT_UNAVAILABLE'
    );
  }

  assert.throws(
    () => compilePlan(planJson([{
      id: 'dynamic',
      operation: 'runtime.from-input',
      dependsOn: [],
      args: {}
    }])),
    error => errorCode(error) === 'PLAN_UNKNOWN_OPERATION'
  );
});

test('plan identity rejects unsupported versions, unknown fields, and non-finite JSON numbers', () => {
  assert.throws(
    () => compilePlan(planJson(mainPlanSteps(), 2)),
    error => errorCode(error) === 'PLAN_UNSUPPORTED_VERSION'
  );
  assert.throws(
    () => compilePlan(JSON.stringify({
      kind: PLAN_KIND,
      version: 1,
      steps: [addStep('one', 1, 2)],
      approval: true
    })),
    error => errorCode(error) === 'PLAN_INVALID_SHAPE'
  );
  assert.throws(
    () => compilePlan(JSON.stringify({
      kind: PLAN_KIND,
      version: 1,
      steps: [addStep('one', 1, 2)],
      maxSteps: 1_000_000
    })),
    error => errorCode(error) === 'PLAN_INVALID_SHAPE'
  );
  assert.throws(
    () => compilePlan(JSON.stringify({
      kind: PLAN_KIND,
      version: 1,
      steps: [{
        id: 'one',
        operation: 'number.add',
        dependsOn: [],
        args: { left: 1, right: 2, toJSON: 'unexpected' }
      }]
    })),
    error => errorCode(error) === 'PLAN_ARGUMENT_INVALID'
  );
  assert.throws(
    () => compilePlan(
      '{"kind":"' + PLAN_KIND + '","version":1,"steps":[{"id":"one","operation":"number.add","dependsOn":[],"args":{"left":1e400,"right":2}}]}'
    ),
    error => errorCode(error) === 'PLAN_ARGUMENT_INVALID'
  );
});

test('dependency validation rejects duplicate, self, unknown, cyclic, and undeclared references', () => {
  const valid = addStep('one', 1, 2);
  assert.throws(
    () => compilePlan(planJson([valid, { ...valid }])),
    error => errorCode(error) === 'PLAN_INVALID_SHAPE'
  );
  assert.throws(
    () => compilePlan(planJson([addStep('one', { $result: 'one' }, 2, ['one'])])),
    error => errorCode(error) === 'PLAN_DEPENDENCY_INVALID'
  );
  assert.throws(
    () => compilePlan(planJson([addStep('one', { $result: 'missing' }, 2, ['missing'])])),
    error => errorCode(error) === 'PLAN_DEPENDENCY_INVALID'
  );
  assert.throws(
    () => compilePlan(planJson([
      addStep('one', { $result: 'two' }, 1, ['two']),
      addStep('two', { $result: 'one' }, 1, ['one'])
    ])),
    error => errorCode(error) === 'PLAN_CYCLE'
  );
  assert.throws(
    () => compilePlan(planJson([
      addStep('one', { $result: 'zero' }, 1, []),
      addStep('zero', 1, 2)
    ])),
    error => errorCode(error) === 'PLAN_DEPENDENCY_INVALID'
  );
});

test('byte, node, edge, depth, queue, input, and result limits stop at configured boundaries', () => {
  const single = planJson([addStep('one', 1, 2)]);
  const exactBytes = createLimitSet(JSON.stringify({ maxPlanBytes: Buffer.byteLength(single, 'utf8') }));
  assert.equal(compilePlan(single, exactBytes).stepCount, 1);
  const shortBytes = createLimitSet(JSON.stringify({ maxPlanBytes: Buffer.byteLength(single, 'utf8') - 1 }));
  assert.throws(
    () => compilePlan(single, shortBytes),
    error => errorCode(error) === 'PLAN_TOO_LARGE'
  );

  const oneStep = createLimitSet(JSON.stringify({ maxSteps: 1 }));
  assert.equal(compilePlan(single, oneStep).stepCount, 1);
  assert.throws(
    () => compilePlan(planJson([addStep('one', 1, 2), addStep('two', 3, 4)]), oneStep),
    error => errorCode(error) === 'PLAN_BOUNDS_EXCEEDED'
  );

  const edgeLimit = createLimitSet(JSON.stringify({ maxEdges: 1 }));
  assert.equal(compilePlan(planJson(numericChain(2)), edgeLimit).stepCount, 2);
  assert.throws(
    () => compilePlan(planJson(numericChain(3)), edgeLimit),
    error => errorCode(error) === 'PLAN_BOUNDS_EXCEEDED'
  );

  const shallow = createLimitSet(JSON.stringify({ maxDepth: 5 }));
  assert.throws(
    () => compilePlan(planJson(numericChain(6)), shallow),
    error => errorCode(error) === 'PLAN_BOUNDS_EXCEEDED'
  );

  const queueLimit = createLimitSet(JSON.stringify({ maxReadyQueue: 1 }));
  assert.throws(
    () => compilePlan(planJson([addStep('one', 1, 1), addStep('two', 2, 2)]), queueLimit),
    error => errorCode(error) === 'PLAN_BOUNDS_EXCEEDED'
  );

  const inputLimit = createLimitSet(JSON.stringify({ maxInputBytes: 8 }));
  assert.throws(
    () => compilePlan(planJson([{
      id: 'text',
      operation: 'text.concat',
      dependsOn: [],
      args: { parts: ['long input'] }
    }]), inputLimit),
    error => errorCode(error) === 'PLAN_ARGUMENT_TOO_LARGE'
  );

  const resultLimit = createLimitSet(JSON.stringify({ maxResultBytes: 2 }));
  const tooLargeResult = planJson([{
    id: 'text',
    operation: 'text.concat',
    dependsOn: [],
    args: { parts: ['abc'] }
  }]);
  assert.throws(
    () => executePlanLocally(compilePlan(tooLargeResult, resultLimit)),
    error => errorCode(error) === 'PLAN_RESULT_TOO_LARGE'
  );

  const tooLarge = planJson([{
    id: 'text',
    operation: 'text.concat',
    dependsOn: [],
    args: { parts: ['x'.repeat(LIMIT_DEFAULTS.maxPlanBytes)] }
  }]);
  assert.throws(
    () => compilePlan(tooLarge),
    error => errorCode(error) === 'PLAN_TOO_LARGE'
  );
});

test('dependency depth and ready queue are bounded before any local operation executes', () => {
  const deep = createLimitSet(JSON.stringify({ maxDepth: 7 }));
  assert.equal(compilePlan(planJson(numericChain(7)), deep).stepCount, 7);
  assert.throws(
    () => compilePlan(planJson(numericChain(8)), deep),
    error => errorCode(error) === 'PLAN_BOUNDS_EXCEEDED'
  );

  const tooManyEdges = [];
  for (let index = 0; index < 13; index += 1) {
    const id = 'n' + String(index).padStart(2, '0');
    const dependencies = [];
    for (let prior = 0; prior < index; prior += 1) {
      dependencies.push('n' + String(prior).padStart(2, '0'));
    }
    if (index === 0) tooManyEdges.push(addStep(id, 1, 1));
    else tooManyEdges.push(addStep(id, 1, 1, dependencies));
  }
  assert.throws(
    () => compilePlan(planJson(tooManyEdges)),
    error => errorCode(error) === 'PLAN_BOUNDS_EXCEEDED'
  );
});

test('workflow identity is opaque in results and cannot be recovered from private diagnostics', () => {
  const sensitiveId = 'tenant-secret-project-123';
  const compiled = compilePlan(planJson([addStep('one', 1, 2)]), undefined, undefined, sensitiveId);
  const result = executePlanLocally(compiled);
  assert.equal(result.results[0].runIdentity, compiled.runIdentity);
  assert.equal(JSON.stringify(result).includes(sensitiveId), false);
});
