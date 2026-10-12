import type { FinanceV2Input, FinanceV2ReadRequest, FinanceV2SyntheticReadPort } from '@jevelopers/team-dashboard';
import { financeV2Fixture, syntheticQueryContentHash, syntheticSnapshotId, syntheticSummaryContentHash, syntheticOpaqueScope, type FinanceV2FixtureName } from '../../src/views/finance-v2/fixtures';

/**
 * Fixture-host only: a SYNTHETIC_PROPOSAL read port over the named fixture, with scripted behaviour for browser journeys. It is data,
 * not Finance. The packed package never imports it; the host injects it, and only in SYNTHETIC_PROPOSAL mode.
 */
export const portBehaviors = ['ok', 'tagged', 'slow', 'fault401', 'fault403', 'fault429', 'fault500', 'timeout', 'hang', 'flaky'] as const;
export type PortBehavior = (typeof portBehaviors)[number];
export { syntheticOpaqueScope, syntheticSnapshotId, syntheticQueryContentHash, syntheticSummaryContentHash };

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const fault = (status: number) => Object.assign(new Error('fixture fault'), { status });

export type FixturePortLog = { calls: Array<{ actorId: string; revision: string; token: string }> };
export function fixtureFinanceV2Port(name: FinanceV2FixtureName, behavior: PortBehavior, log: FixturePortLog = { calls: [] }): FinanceV2SyntheticReadPort {
  let attempts = 0;
  return {
    kind: 'SYNTHETIC_PROPOSAL',
    read: async (request: FinanceV2ReadRequest): Promise<FinanceV2Input> => {
      attempts += 1;
      log.calls.push({ actorId: request.scope.actorId, revision: request.authorization.revision, token: request.authorization.token });
      // `slow` deliberately ignores request.signal, to prove the dashboard drops a late answer even when the port does not honour the abort.
      if (behavior === 'slow') await delay(1500);
      if (behavior === 'hang') await new Promise<never>(() => undefined);
      if (behavior === 'fault401') throw fault(401);
      if (behavior === 'fault403') throw fault(403);
      if (behavior === 'fault429') throw fault(429);
      if (behavior === 'fault500') throw fault(503);
      if (behavior === 'timeout') throw Object.assign(new Error('fixture timeout'), { code: 'TIMEOUT' });
      if (behavior === 'flaky' && attempts === 1) throw fault(500);
      const fixture = financeV2Fixture(name);
      const input = fixture.input;
      if (input.status !== 'ready' || behavior === 'ok') return input;
      const page = input.page as { scope: unknown; requestId: string };
      // Rebind a non-forged page to the requested scope and tag it with the request identity, so a stale answer is visible to a test.
      const unforged = JSON.stringify(page.scope) === JSON.stringify(syntheticOpaqueScope);
      return unforged
        ?{ status: 'ready', page: { ...page, scope: request.scope, requestId: `${page.requestId}:${request.scope.actorId}:rev-${request.authorization.revision}` } }
        : input;
    },
  };
}
