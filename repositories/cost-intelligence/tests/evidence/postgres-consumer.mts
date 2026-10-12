// Strict packed-consumer contract; no database or provider requests occur here.
import { createPostgresEvidenceReader as createRootReader } from '@jevelopers/cost-intelligence';
import type {
  ApiResult, Clock, FinanceAuthorizationPort, PostingEvidence, ReverseEvidence,
  PostgresEvidenceReader, PostgresEvidenceReaderPorts, PostgresEvidenceDatabasePort,
  PostgresEvidenceTransactionPort,
} from '@jevelopers/cost-intelligence';
import { createPostgresEvidenceReader as createSubpathReader } from '@jevelopers/cost-intelligence/evidence';
import type {
  PostgresEvidenceReader as SubpathReader,
  PostgresEvidenceTransactionPort as SubpathTransaction,
} from '@jevelopers/cost-intelligence/evidence';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? ((<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false) : false;
type Check<T extends true> = T;
type NotAny<T> = 0 extends (1 & T) ? false : true;
type PublicContract = [
  Check<Equal<ReturnType<typeof createRootReader>, PostgresEvidenceReader>>,
  Check<Equal<ReturnType<typeof createSubpathReader>, SubpathReader>>,
  Check<Equal<PostgresEvidenceReader, SubpathReader>>,
  Check<Equal<PostgresEvidenceTransactionPort, SubpathTransaction>>,
  Check<Equal<Parameters<typeof createRootReader>, [ports: PostgresEvidenceReaderPorts]>>,
  Check<Equal<Awaited<ReturnType<PostgresEvidenceReader['lookupPostingEvidence']>>, ApiResult<PostingEvidence>>>,
  Check<Equal<Awaited<ReturnType<PostgresEvidenceReader['lookupByOperationalReference']>>, ApiResult<ReverseEvidence>>>,
  Check<NotAny<Awaited<ReturnType<PostgresEvidenceReader['lookupPostingEvidence']>>>>,
  Check<NotAny<Awaited<ReturnType<PostgresEvidenceReader['lookupByOperationalReference']>>>>,
];

declare const clock: Clock;
declare const financeAuthority: FinanceAuthorizationPort;
declare const pool: { connect(): Promise<{
  query(text: string, values?: readonly unknown[]): ReturnType<PostgresEvidenceTransactionPort['query']>;
  release(destroy?: boolean): void;
}> };

// An explicit host adapter must give physical eviction its own capability.
const database: PostgresEvidenceDatabasePort = { async connect() {
  const client = await pool.connect();
  return {
    query: (text, values) => client.query(text, values),
    release: () => client.release(),
    discard: () => client.release(true),
  };
} };
const reader = createRootReader({ database, clock, financeAuthority });
const subpathReader: PostgresEvidenceReader = createSubpathReader({ database, clock, financeAuthority });

declare const legacyClient: { query: PostgresEvidenceTransactionPort['query']; release(): void };
// @ts-expect-error A legacy release-only client cannot prove that poisoned connections are evicted.
const invalidClient: PostgresEvidenceTransactionPort = legacyClient;
// @ts-expect-error Transaction/store capabilities never escape the authorized reader.
reader.store;
// @ts-expect-error A caller cannot commit or reuse the private lookup transaction.
reader.commit();

async function consume() {
  const posting: ApiResult<PostingEvidence> = await reader.lookupPostingEvidence(undefined);
  const reverse: ApiResult<ReverseEvidence> = await subpathReader.lookupByOperationalReference(undefined);
  if (posting.ok) { const authority: false = posting.value.billingAuthority; void authority; }
  if (reverse.ok) { const authority: false = reverse.value.billingAuthority; void authority; }
}
void consume;
