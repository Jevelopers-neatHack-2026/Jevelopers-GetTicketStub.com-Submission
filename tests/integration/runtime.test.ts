import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { PNG } from "pngjs";
import { PDFDocument, PDFDict, PDFName, PDFArray } from "pdf-lib";
import { verifyRuntime } from "../../src/runtime/calibration.js";
import { loadPins } from "../../src/runtime/environment.js";
import { VerificationFailure } from "../../src/runtime/errors.js";
import { inspectCalibration } from "../../src/preflight/calibration-output.js";
import { loadCalibrationFont } from "../../src/typography/calibration-font.js";
import { openOfflineBrowser } from "../../src/exporters/offline-browser.js";
import { resource } from "../../src/runtime/resources.js";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

let temporary: string;
let calibration: Awaited<ReturnType<typeof verifyRuntime>>;
before(async () => {
	temporary = await mkdtemp(join(tmpdir(), "pp01a-runtime-"));
	calibration = await verifyRuntime(join(temporary, "calibration"));
});
after(async () => {
	if (temporary) await rm(temporary, { recursive: true, force: true });
});
const expected = {
	widthPx: 384,
	heightPx: 192,
	widthPt: 288,
	heightPt: 144,
	lines: ["Calibration office AV fi", "Café Ångström 0123456789", "Café • –"],
} as const;
function cli(args: readonly string[], env: NodeJS.ProcessEnv = process.env) {
	return spawnSync(
		process.execPath,
		[fileURLToPath(resource("dist/scripts/verify/cli.js")), ...args],
		{ env, encoding: "utf8" },
	);
}
const typed = (code: string) => (error: unknown) =>
	error instanceof VerificationFailure && error.code === code;

test("renders actual physical dimensions and text when calibration runs offline", () => {
	// Given a real Chromium render. When inspected. Then dimensions, text and font provenance match.
	assert.equal(calibration.first.inspection.widthPx, 384);
	assert.equal(calibration.first.inspection.heightPx, 192);
	assert.equal(calibration.first.inspection.widthPt, 288);
	assert.equal(calibration.first.inspection.heightPt, 144);
	assert.equal(calibration.first.inspection.pages, 1);
	assert.deepEqual(
		calibration.first.inspection.lines,
		expected.lines.map((line) => line.normalize("NFC")),
	);
	assert.equal(calibration.first.network.calibrationRequests, 0);
	assert.deepEqual(calibration.first.network.probeDenied.sort(), [
		"fetch",
		"font",
	]);
	assert.ok(
		calibration.first.font.platformFonts
			.flat()
			.every(
				(font) =>
					font.isCustomFont && font.postScriptName === "NotoSans-Regular",
			),
	);
});
test("preserves normalized render fingerprints when the same fixture is rendered twice", () => {
	// Given two independent browsers. When hashes are compared. Then decoded and normalized outputs agree.
	assert.equal(
		calibration.first.inspection.pngPixelSha256,
		calibration.second.inspection.pngPixelSha256,
	);
	assert.equal(
		calibration.first.inspection.pdfNormalizedByteSha256,
		calibration.second.inspection.pdfNormalizedByteSha256,
	);
	assert.equal(
		calibration.first.inspection.pdfSemanticSha256,
		calibration.second.inspection.pdfSemanticSha256,
	);
});
test("rejects wrong PNG dimensions when the output is changed", async () => {
	// Given a real PDF and a wrongly sized PNG. When preflight runs. Then dimension failure is typed.
	const pdf = await readFile(
		join(temporary, "calibration/render-1/calibration.pdf"),
	);
	const png = PNG.sync.write(new PNG({ width: 383, height: 192 }));
	await assert.rejects(
		inspectCalibration(png, pdf, expected),
		typed("DIMENSION_MISMATCH"),
	);
});
test("rejects missing PDF content when page size still matches", async () => {
	// Given a real PNG and an empty correctly sized PDF. When inspected. Then content fails.
	const png = await readFile(
		join(temporary, "calibration/render-1/calibration.png"),
	);
	const pdf = await PDFDocument.create();
	pdf.addPage([288, 144]);
	await assert.rejects(
		inspectCalibration(png, await pdf.save(), expected),
		typed("CONTENT_MISMATCH"),
	);
});
test("rejects wrong PDF page dimensions when text remains intact", async () => {
	// Given a real PDF with changed media box. When inspected. Then dimensions fail.
	const png = await readFile(
		join(temporary, "calibration/render-1/calibration.png"),
	);
	const pdf = await PDFDocument.load(
		await readFile(join(temporary, "calibration/render-1/calibration.pdf")),
	);
	pdf.getPage(0).setSize(289, 144);
	await assert.rejects(
		inspectCalibration(png, await pdf.save(), expected),
		typed("DIMENSION_MISMATCH"),
	);
});
test("rejects browser bytes when its expected executable pin differs", async () => {
	// Given different expected bytes. When the installed browser opens. Then launch is denied.
	const pins = await loadPins();
	await assert.rejects(
		openOfflineBrowser({
			...pins,
			browser: {
				...pins.browser,
				executableSha256: { darwin: "0".repeat(64), linux: "0".repeat(64) },
			},
		}),
		typed("BROWSER_PIN_MISMATCH"),
	);
});

test("rejects browser versions when the launched version differs", async () => {
	// Given correct bytes but a wrong version. When the real browser opens. Then it fails.
	const pins = await loadPins();
	await assert.rejects(
		openOfflineBrowser({
			...pins,
			browser: { ...pins.browser, version: "0.0.0.0" },
		}),
		typed("BROWSER_PIN_MISMATCH"),
	);
});

test("reports a typed sandbox failure without retry when browser launch rejects", async (t) => {
	const pins = await loadPins();
	const launch = t.mock.method(chromium, "launch", async () => {
		throw new Error(
			"browserType.launch: Target closed\nCall log:\n  - <launching> /private/chrome --url=https://private.invalid/token\n  - [pid=42][err] chrome_crashpad_handler: --database is required",
		);
	});
	await assert.rejects(openOfflineBrowser(pins), (error: unknown) => {
		assert.ok(error instanceof VerificationFailure);
		assert.equal(error.code, "SANDBOX_POLICY_FAILURE");
		assert.ok(error.message.includes("[CRASHPAD_DATABASE_REQUIRED]"));
		for (const privateValue of ["/private", "https://", "token", "pid=42"])
			assert.ok(!error.message.includes(privateValue));
		return true;
	});
	assert.equal(launch.mock.callCount(), 1);
});

test("rejects missing embedded PDF font programs when text still parses", async () => {
	// Given a real PDF without its embedded font program. When preflight runs. Then host fallback is forbidden.
	const png = await readFile(
		join(temporary, "calibration/render-1/calibration.png"),
	);
	const pdf = await PDFDocument.load(
		await readFile(join(temporary, "calibration/render-1/calibration.pdf")),
	);
	const resources = pdf.getPage(0).node.Resources();
	assert.ok(resources);
	const fonts = resources.lookup(PDFName.of("Font"), PDFDict);
	for (const [, reference] of fonts.entries()) {
		const font = pdf.context.lookup(reference, PDFDict);
		const descendants = font.lookup(PDFName.of("DescendantFonts"), PDFArray);
		descendants
			.lookup(0, PDFDict)
			.lookup(PDFName.of("FontDescriptor"), PDFDict)
			.delete(PDFName.of("FontFile2"));
	}
	await assert.rejects(
		inspectCalibration(png, await pdf.save(), expected),
		typed("FONT_FALLBACK"),
	);
});

test("rejects font tampering when the asset differs from its pin", async () => {
	// Given mismatched expected font bytes. When loaded. Then the font gate fails.
	const pins = await loadPins();
	await assert.rejects(
		loadCalibrationFont(
			{ ...pins, font: { ...pins.font, sha256: "0".repeat(64) } },
			expected.lines,
			18,
		),
		typed("FONT_PIN_MISMATCH"),
	);
});
test("rejects missing fonts when the file is unavailable", async () => {
	// Given an absent font path. When loaded. Then a typed failure precedes any render.
	const pins = await loadPins();
	await assert.rejects(
		loadCalibrationFont(
			{ ...pins, font: { ...pins.font, file: "tests/fixtures/absent.woff2" } },
			expected.lines,
			18,
		),
		typed("FONT_PIN_MISMATCH"),
	);
});
test("rejects unsupported glyphs when the corpus exceeds the pinned subset", async () => {
	// Given a CJK character outside the Latin subset. When shaped. Then no fallback is allowed.
	await assert.rejects(
		loadCalibrationFont(await loadPins(), ["漢"], 18),
		typed("FONT_UNSUPPORTED"),
	);
});
test("blocks actual loopback fetch and remote fonts when a server is listening", async () => {
	// Given a real local HTTP server and the renderer policy. When requests run. Then no server sees traffic.
	let hits = 0;
	const server = createServer((_request, response) => {
		hits++;
		response.end("unexpected");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const browser = await openOfflineBrowser(await loadPins());
	try {
		const page = await browser.context.newPage();
		const results = await page.evaluate(
			async (url) =>
				Promise.all([
					fetch(`${url}/fetch`).then(
						() => false,
						() => true,
					),
					new FontFace("ForbiddenFont", `url(${url}/font.woff2)`).load().then(
						() => false,
						() => true,
					),
				]),
			`http://127.0.0.1:${address.port}`,
		);
		assert.deepEqual(results, [true, true]);
		assert.equal(hits, 0);
		assert.deepEqual(browser.denied.sort(), ["fetch", "font"]);
	} finally {
		await browser.browser.close();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});
test("exits nonzero with sanitized stderr when required CLI arguments are absent", () => {
	// Given no arguments. When the real CLI runs. Then it fails without exposing a path.
	const result = cli([]);
	assert.equal(result.status, 1);
	assert.equal(JSON.parse(result.stderr).failure.code, "INVALID_ARGUMENTS");
	assert.ok(!result.stderr.includes(temporary));
});
test("exits nonzero when the environment timezone is unpinned", async () => {
	// Given an incompatible process environment. When runtime dispatches. Then evidence fails closed.
	const directory = join(temporary, "wrong-timezone");
	const result = cli(
		["--suite", "runtime", "--mode", "offline", "--evidence-dir", directory],
		{ ...process.env, TZ: "Pacific/Honolulu" },
	);
	assert.equal(result.status, 1);
	const evidence = JSON.parse(
		await readFile(join(directory, "runtime.json"), "utf8"),
	);
	assert.equal(evidence.failure.code, "ENVIRONMENT_PIN_MISMATCH");
});
test("exits nonzero when the pinned browser installation is missing", async () => {
	// Given an empty browser cache. When runtime dispatches. Then it fails before launching another browser.
	const directory = join(temporary, "missing-browser");
	const result = cli(
		["--suite", "runtime", "--mode", "offline", "--evidence-dir", directory],
		{
			...process.env,
			PLAYWRIGHT_BROWSERS_PATH: join(temporary, "absent-browser-cache"),
		},
	);
	assert.equal(result.status, 1);
	const evidence = JSON.parse(
		await readFile(join(directory, "runtime.json"), "utf8"),
	);
	assert.equal(evidence.failure.code, "BROWSER_PIN_MISMATCH");
});

test("exits nonzero when evidence cannot be written", async () => {
	// Given a file used as an evidence directory. When CLI writes its failure. Then the write failure is explicit.
	const file = join(temporary, "calibration/render-1/calibration.png");
	const result = cli([
		"--suite",
		"api-contracts",
		"--mode",
		"offline",
		"--evidence-dir",
		file,
	]);
	assert.equal(result.status, 1);
	assert.equal(
		JSON.parse(result.stderr).failure.code,
		"EVIDENCE_WRITE_FAILURE",
	);
	assert.ok(!result.stderr.includes(temporary));
});
