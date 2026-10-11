import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { baselineFiles } from "./ci-workload-baseline.mjs";

export const groups = Object.freeze(["cli", "private", "standalone"]);
const isolated = new Map([
	["dist/tests/integration/production-output-cli.test.js", "cli"],
	["dist/tests/unit/production-output-dispatcher.test.js", "private"],
	["dist/tests/unit/durability-dispatcher.test.js", "private"],
	["dist/tests/unit/durability-independent-tests.test.js", "private"],
]);
export const digest = (value) =>
	createHash("sha256").update(value).digest("hex");

export async function workloadPlan(root) {
	const files = [];
	for (const directory of ["unit", "contract", "integration"]) {
		const source = await readdir(join(root, "tests", directory), {
			withFileTypes: true,
		});
		const compiled = await readdir(join(root, "dist/tests", directory), {
			withFileTypes: true,
		});
		const names = (entries, suffix) =>
			entries
				.filter((entry) => entry.name.endsWith(suffix))
				.map((entry) => {
					assert.ok(entry.isFile(), "Test entries must be regular files.");
					assert.match(entry.name, /^[a-z0-9-]+\.test\.(ts|js)$/);
					return entry.name.replace(suffix, "");
				})
				.sort();
		const sourceNames = names(source, ".test.ts");
		assert.ok(sourceNames.length > 0, "Every test directory is required.");
		assert.deepEqual(names(compiled, ".test.js"), sourceNames);
		for (const name of sourceNames) {
			const path = `dist/tests/${directory}/${name}.test.js`;
			files.push({
				path,
				digest: digest(await readFile(join(root, path))),
				group: isolated.get(path) ?? "standalone",
			});
		}
	}
	files.sort((a, b) => a.path.localeCompare(b.path, "en"));
	for (const path of baselineFiles)
		assert.ok(files.some((file) => file.path === path));
	for (const group of groups)
		assert.ok(files.some((file) => file.group === group));
	return Object.freeze({
		files: Object.freeze(files.map((file) => Object.freeze(file))),
		unionDigest: digest(JSON.stringify(files)),
	});
}

export function selectGroup(plan, group) {
	assert.ok(groups.includes(group), "Unknown workload group.");
	const files = plan.files.filter((file) => file.group === group);
	assert.ok(files.length > 0, "Empty workload group.");
	return files;
}
