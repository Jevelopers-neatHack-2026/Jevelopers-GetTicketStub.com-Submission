import { createHash } from "node:crypto";
import { relative, sep } from "node:path";

// Diagnostic-only side channel. Never substitute this for a complete receipt.
export function createProgressEmitter(write, root = process.cwd()) {
	const seen = new Set();
	return (event) => {
		const kind =
			event.type === "test:dequeue"
				? "started"
				: event.type === "test:summary"
					? "summary"
					: null;
		const file = event.data?.entryFile ?? event.data?.file;
		if (!kind || typeof file !== "string" || file.length === 0) return;
		const path = relative(root, file).split(sep).join("/");
		const hash = createHash("sha256").update(path).digest("hex");
		const key = `${kind}:${hash}`;
		if (seen.has(key)) return;
		seen.add(key);
		write(`PP_CI_FILE ${kind} ${hash}\n`);
	};
}

// Child stderr can contain unrelated diagnostics. Forward only the finite
// protocol, never raw stderr, file paths, test names, exceptions or messages.
export function createProgressForwarder(write) {
	let pending = "";
	let dropping = false;
	return (chunk) => {
		for (const character of chunk.toString("utf8")) {
			if (character === "\n") {
				const match =
					!dropping &&
					/^PP_CI_FILE (started|summary) ([a-f0-9]{64})$/.exec(pending);
				if (match)
					write(
						`${JSON.stringify({
							ciWorkloadProgress: {
								event: match[1],
								filePathSha256: match[2],
							},
						})}\n`,
					);
				pending = "";
				dropping = false;
			} else if (!dropping) {
				if (pending.length < 128) pending += character;
				else {
					pending = "";
					dropping = true;
				}
			}
		}
	};
}
