import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function evidence(name: string, value: unknown): void {
	const directory = process.env["PP_DURABILITY_EVIDENCE_DIR"];
	if (!directory) return;
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, `${name}.json`),
		`${JSON.stringify(value, null, 2)}\n`,
	);
}
