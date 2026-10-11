import { projectApplyResult, projectCounters, projectHistoryList, projectHistoryResult } from '../../../src/controls/public-result.mjs';
const input: unknown = JSON.parse('{}');
const apply = projectApplyResult(input);
const operation: string | undefined = apply.operation_id;
const count: number | undefined = projectCounters(input)?.image_calls;
const historical: string | undefined = projectHistoryList(input)?.items[0]?.artifact.content_hash;
const restored: string | undefined = projectHistoryResult(input, true).result?.design_version_id;
const compared: string | undefined = projectHistoryResult(input, false).result?.left;
void [operation, count, historical, restored, compared];
// @ts-expect-error the projection never declares private upstream message data
apply.message;
