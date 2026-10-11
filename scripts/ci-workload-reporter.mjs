import { createHash } from "node:crypto";
import { relative } from "node:path";

export default async function* report(events) {
	const files = new Map();
	let summary;
	const state = (path) => {
		if (!files.has(path))
			files.set(path, {
				stdout: createHash("sha256"),
				stderr: createHash("sha256"),
				failures: [],
			});
		return files.get(path);
	};
	for await (const event of events) {
		const file = event.data.entryFile ?? event.data.file;
		switch (event.type) {
			case "test:stdout":
				state(file).stdout.update(event.data.message);
				break;
			case "test:stderr":
				state(file).stderr.update(event.data.message);
				break;
			case "test:fail":
				state(file).failures.push(
					createHash("sha256").update(event.data.name).digest("hex"),
				);
				break;
			case "test:summary":
				if (file) state(file).summary = event.data;
				else summary = event.data;
				break;
		}
	}
	const counts = (value) => ({
		tests: value.tests,
		pass: value.passed,
		fail: value.failed,
		cancelled: value.cancelled,
		skipped: value.skipped,
		todo: value.todo,
	});
	yield `${JSON.stringify({
		counts: summary && counts(summary.counts),
		success: summary?.success,
		files: [...files].map(([file, value]) => ({
			path: relative(process.cwd(), file),
			counts: value.summary && counts(value.summary.counts),
			success: value.summary?.success,
			durationMs: value.summary?.duration_ms,
			stdoutDigest: value.stdout.digest("hex"),
			stderrDigest: value.stderr.digest("hex"),
			failures: value.failures,
		})),
	})}\n`;
}
