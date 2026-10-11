import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baselineFiles } from "./ci-workload-baseline.mjs";

export async function fixtureWorkload() {
	const root = await mkdtemp(join(tmpdir(), "pp-ci-workload-"));
	const counts = Object.fromEntries(
		baselineFiles.map((file) => [
			file.slice("dist/tests/".length, -".test.js".length),
			file === "dist/tests/unit/composition-assets.test.js" ? 445 : 1,
		]),
	);
	for (const [path, count] of Object.entries(counts)) {
		await mkdir(join(root, "tests", path.split("/")[0]), { recursive: true });
		await mkdir(join(root, "dist/tests", path.split("/")[0]), {
			recursive: true,
		});
		const code = `import {test} from 'node:test'; for(let i=0;i<${count};i++) test('case '+i,()=>{});`;
		await writeFile(join(root, "tests", `${path}.test.ts`), code);
		await writeFile(join(root, "dist/tests", `${path}.test.js`), code);
	}
	return root;
}
