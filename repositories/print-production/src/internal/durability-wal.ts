import { performance } from "node:perf_hooks";
import type { DatabaseSync } from "node:sqlite";

const busyTimeoutMs = 10000;
const maxAttempts = 1000;
const pause = new Int32Array(new SharedArrayBuffer(4));

/** Retry only an initial WAL transition, never an application transaction. */
export function enableDurabilityWal(sql: DatabaseSync): void {
	if (sql.isTransaction) throw new Error("WAL_SETUP_IN_TRANSACTION");
	const deadline = performance.now() + busyTimeoutMs;
	let lastError: unknown;
	try {
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const remaining = Math.max(0, Math.floor(deadline - performance.now()));
			if (attempt > 0 && remaining === 0) throw lastError;
			// SQLite can return BUSY without invoking its busy handler during
			// journal-mode lock promotion. Do not grant a new 10s per attempt.
			sql.exec(`PRAGMA busy_timeout=${remaining}`);
			try {
				const mode = sql.prepare("PRAGMA journal_mode=WAL").get();
				if (mode?.["journal_mode"] !== "wal")
					throw new Error("WAL_UNAVAILABLE");
				return;
			} catch (error) {
				if (
					!(error instanceof Error) ||
					!("code" in error) ||
					error.code !== "ERR_SQLITE_ERROR" ||
					!("errcode" in error) ||
					error.errcode !== 5 ||
					attempt === maxAttempts - 1
				)
					throw error;
				lastError = error;
				const delay = Math.min(10, deadline - performance.now());
				if (delay <= 0) throw error;
				Atomics.wait(pause, 0, 0, delay);
			}
		}
	} finally {
		// Preserve the existing transaction lock-wait policy on this connection.
		sql.exec("PRAGMA busy_timeout=10000");
	}
}
