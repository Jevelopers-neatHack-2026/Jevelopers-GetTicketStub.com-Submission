import type { BatchPolicy } from "../jobs/durable-batch.js";
import { DurableBatchEngine } from "../jobs/durable-batch.js";
import { requireOutput } from "../exporters/private-policy.js";
import { createPrivateBatch } from "./private-batch.js";
import type { BatchContext } from "./private-batch.js";
import { parseCsv } from "./private-csv.js";
import { requireCsvCapability } from "./private-csv-policy.js";
import type { CsvPolicy, CsvRow } from "./private-csv-policy.js";

export async function createPrivateCsvBatch(request: {
	readonly enabled: boolean;
	readonly engine: DurableBatchEngine;
	readonly key: string;
	readonly context: BatchContext;
	readonly source: AsyncIterable<Uint8Array>;
	readonly fileDigest: string;
	readonly csvPolicy: CsvPolicy;
	readonly policy?: BatchPolicy;
	readonly signal?: AbortSignal;
}) {
	requireCsvCapability(request.enabled);
	const csvRows: CsvRow[] = [];
	for await (const row of parseCsv({
		source: request.source,
		fileDigest: request.fileDigest,
		policy: request.csvPolicy,
		...(request.signal ? { signal: request.signal } : {}),
	})) {
		requireOutput(
			csvRows.length < request.context.rows.maxRows,
			"OUTPUT_LIMIT",
			"csv.batchRows",
		);
		csvRows.push(row);
	}
	return createPrivateBatch({
		engine: request.engine,
		key: request.key,
		context: request.context,
		rows: csvRows.map((r) => r.row),
		csvRows,
		...(request.policy ? { policy: request.policy } : {}),
	});
}
