// Compile against the actual packed package; no provider or database execution.
import { createPostgresStoredLineageReader as createRootReader, STORED_LINEAGE_SCHEMA_VERSION } from '@jevelopers/cost-intelligence';
import type {
  ApiResult, PostgresEvidenceDatabasePort, Clock, FinanceAuthorizationPort,
  PostgresStoredLineageReader, PostgresStoredLineageReaderPorts,
  IntakeLineageRequest, IntakeLineageResult, SnapshotInputLineageRequest, SnapshotInputLineageResult,
} from '@jevelopers/cost-intelligence';
import { createPostgresStoredLineageReader as createSubpathReader } from '@jevelopers/cost-intelligence/evidence';
import type { PostgresStoredLineageReader as SubpathReader } from '@jevelopers/cost-intelligence/evidence';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? ((<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false) : false;
type Check<T extends true> = T;
type NotAny<T> = 0 extends (1 & T) ? false : true;
type PublicContract = [
  Check<Equal<ReturnType<typeof createRootReader>, PostgresStoredLineageReader>>,
  Check<Equal<ReturnType<typeof createSubpathReader>, SubpathReader>>,
  Check<Equal<PostgresStoredLineageReader, SubpathReader>>,
  Check<Equal<keyof PostgresStoredLineageReader, 'readIntakeLineage' | 'readSnapshotInputLineage'>>,
  Check<Equal<Parameters<typeof createRootReader>, [ports: PostgresStoredLineageReaderPorts]>>,
  Check<Equal<Awaited<ReturnType<PostgresStoredLineageReader['readIntakeLineage']>>, ApiResult<IntakeLineageResult>>>,
  Check<Equal<Awaited<ReturnType<PostgresStoredLineageReader['readSnapshotInputLineage']>>, ApiResult<SnapshotInputLineageResult>>>,
  Check<NotAny<IntakeLineageResult['observations'][number]>>,
  Check<NotAny<NonNullable<SnapshotInputLineageResult['snapshot']>>>,
  Check<Equal<IntakeLineageResult['billingAuthority'], false>>,
  Check<Equal<SnapshotInputLineageResult['billingAuthority'], false>>,
  Check<Equal<SnapshotInputLineageResult['wholeSnapshotHashVerified'], false>>,
  Check<Equal<SnapshotInputLineageResult['inputMeaning'], 'recorded_input_only'>>,
];
declare const database: PostgresEvidenceDatabasePort;
declare const clock: Clock;
declare const financeAuthority: FinanceAuthorizationPort;
declare const intakeRequest: IntakeLineageRequest;
declare const snapshotRequest: SnapshotInputLineageRequest;
const reader = createRootReader({ database, clock, financeAuthority });
const subpath: PostgresStoredLineageReader = createSubpathReader({ database, clock, financeAuthority });
const version: '1.0.0' = STORED_LINEAGE_SCHEMA_VERSION;
// @ts-expect-error The public reader exposes no arbitrary query or store/session capability.
reader.query('SELECT 1');
// @ts-expect-error A caller cannot commit the private read transaction.
reader.commit();
// @ts-expect-error Stored input membership never claims a financial amount.
const unsupported: SnapshotInputLineageResult['amount'] = 0;
async function consume() {
  const intake = await reader.readIntakeLineage(intakeRequest);
  if (intake.ok) {
    const result: IntakeLineageResult = intake.value;
    const verification: 'stored_reference_match' = result.verification;
    const billingAuthority: false = result.billingAuthority;
    for (const item of result.observations) {
      const storedOnly: 'stored_commitments_only' = item.commitments.verification;
      const posting: { eventId: string; eventHash: string } | null = item.currentAttempt.posting;
      void [storedOnly, posting];
    }
    void [verification, billingAuthority];
  }
  const snapshot = await subpath.readSnapshotInputLineage(snapshotRequest);
  if (snapshot.ok) {
    const result: SnapshotInputLineageResult = snapshot.value;
    const hashVerified: false = result.wholeSnapshotHashVerified;
    const status: 'recorded_input' | 'not_recorded_input' | 'snapshot_not_found' | 'posting_not_found' = result.status;
    void [hashVerified, status];
  }
}
void [consume, version];
