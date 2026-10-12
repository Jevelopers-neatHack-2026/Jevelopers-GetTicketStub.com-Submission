import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { validateContract } from "@jevelopers/shared-contracts";
import type { PreflightReport } from "@jevelopers/shared-contracts";
import { checkProductionPreflight } from "@jevelopers/shared-contracts/production-operations";
import { fixtureHost } from "../fixtures/canonical-production/host.js";
import { CandidateRuntime } from "../../src/api/canonical-runtime.js";
import {
	readArtifact,
	artifactReference,
} from "../../src/api/canonical-artifacts.js";
import { projectPreflight } from "../../src/api/canonical-preflight.js";
import { composeArtifact } from "../../src/composition/private-model.js";
import type { PrivateArtifact } from "../../src/composition/private-model.js";
import { inspectArtifact } from "../../src/preflight/private-inspection.js";
import type { Finding } from "../../src/preflight/private-inspection.js";
import { fixtureFonts } from "../fixtures/composition/corpus.js";
import { digest } from "../../src/composition/primitives.js";

async function projectionFixture() {
	const given = await fixtureHost();
	try {
		const composed = await given.candidate.operations.composeArtifact(
			given.candidate.context,
			given.records.request,
		);
		assert.ok(composed.ok);
		const runtime = new CandidateRuntime(given.host());
		const stored = await readArtifact(runtime, composed.value);
		return {
			given,
			runtime,
			stored,
			composed: composed.value,
			async project(
				artifact = stored.artifact,
				constraints = stored.inputs.profile.constraints,
				ports = stored.inputs.ports,
			) {
				const report = await inspectArtifact(
					artifact,
					constraints,
					ports,
					Date.parse(runtime.now()),
				);
				return {
					privateReport: report,
					canonical: projectPreflight(runtime, {
						artifact: artifactReference(
							artifact,
							composed.value.composition_ref,
							composed.value.artifact_ref.id,
						),
						inputs: stored.inputs,
						report,
						fileEvidence: [],
						files: [],
					}),
				};
			},
			async [Symbol.asyncDispose]() {
				await given[Symbol.asyncDispose]();
			},
		};
	} catch (error) {
		await given[Symbol.asyncDispose]();
		throw error;
	}
}

function detail(
	runtime: CandidateRuntime,
	finding: PreflightReport["body"]["findings"][number],
) {
	return z
		.object({
			value: z.object({
				finding: z.object({
					code: z.string(),
					path: z.string(),
					observed: z.union([z.string(), z.number(), z.null()]),
					expected: z.union([z.string(), z.number()]),
					unit: z.string(),
					ruleVersion: z.string(),
					specRevision: z.string().nullable(),
				}),
			}),
		})
		.parse(runtime.state.get(`evidence:${finding.evidence_ref.id}`)).value
		.finding;
}

test("preserves measured overflow, low DPI and warning quantities without changing source facts", async () => {
	// Given
	await using f = await projectionFixture();
	const { inputs } = f.stored;
	const nodes = inputs.input.nodes.map((node) => {
		if (node.kind === "artwork")
			return {
				...node,
				transform: { ...node.transform, scaleX: 2, scaleY: 2 },
			};
		if (node.kind === "text")
			return {
				...node,
				field: { ...node.field, bounds: { ...node.field.bounds, width: 1 } },
			};
		if (node.kind === "overlay") return { ...node, opacity: 0.9 };
		return node;
	});
	const artifact = await composeArtifact(
		{ ...inputs.input, nodes },
		inputs.layout,
		inputs.profile.fonts.map((v) => v.font),
		inputs.ports,
		Date.parse(f.runtime.now()),
	);
	// When
	const { canonical, privateReport } = await f.project(artifact);
	// Then
	assert.ok(validateContract("PreflightReport", canonical).ok);
	assert.equal(canonical.body.findings.length, privateReport.findings.length);
	assert.deepEqual(
		canonical.body.findings.map((v) => detail(f.runtime, v).path),
		privateReport.findings.map((v) => v.path),
	);
	for (const code of ["DPI_LOW", "TEXT_OVERFLOW", "LAYER_OPACITY"]) {
		const index = privateReport.findings.findIndex((v) => v.code === code);
		const source = privateReport.findings[index],
			projected = canonical.body.findings[index];
		assert.ok(source && projected);
		assert.equal(projected.severity, source.severity);
		assert.equal(projected.state, source.state);
		assert.equal(projected.repair_eligible, source.repairEligible);
		assert.deepEqual(detail(f.runtime, projected), {
			code: source.code,
			path: source.path,
			observed: source.observed,
			expected: source.expected,
			unit: source.unit,
			ruleVersion: source.ruleVersion,
			specRevision: source.specRevision,
		});
		if (code === "DPI_LOW") {
			assert.equal(projected.code, "DPI_MISMATCH");
			assert.equal(projected.unit, "dpi");
			assert.equal(projected.observed, 150);
			assert.equal(projected.expected, 290);
		} else if (code === "LAYER_OPACITY") {
			assert.equal(projected.unit, "state");
			assert.equal(projected.observed, 0.9);
			assert.equal(projected.expected, 1);
		}
	}
	assert.deepEqual(
		artifact.sourceArtworkHashes,
		f.stored.artifact.sourceArtworkHashes,
	);
	assert.deepEqual(
		artifact.model.input.nodes.flatMap((v) =>
			v.kind === "text" ? [v.field.source] : [],
		),
		inputs.input.nodes.flatMap((v) =>
			v.kind === "text" ? [v.field.source] : [],
		),
	);
	assert.equal(canonical.body.model_ready, false);
	assert.equal(canonical.eligibility.handoff_eligible, false);
});

test("retains passed information when an approved pinned fallback is actually measured", async () => {
	// Given
	await using f = await projectionFixture();
	const fonts = await fixtureFonts();
	const { inputs } = f.stored;
	const layout = {
		...inputs.layout,
		fonts: fonts.map((font) => font.descriptor.ref),
		slots: inputs.layout.slots.map((slot) => ({
			...slot,
			allowedFonts: fonts.map((font) => font.descriptor.ref),
		})),
	};
	const artifact = await composeArtifact(
		{
			...inputs.input,
			nodes: inputs.input.nodes.map((node) =>
				node.kind === "text"
					? {
							...node,
							field: {
								...node.field,
								fontOrder: ["synthetic-arabic", "synthetic-latin"],
							},
						}
					: node,
			),
		},
		layout,
		fonts,
		inputs.ports,
		Date.parse(f.runtime.now()),
	);
	// When
	const { canonical, privateReport } = await f.project(artifact);
	// Then
	assert.ok(
		artifact.texts.some(
			(v) => v.state === "measured" && v.fontDecision === "approved-fallback",
		),
	);
	const index = privateReport.findings.findIndex(
		(v) => v.code === "APPROVED_FONT_FALLBACK",
	);
	const finding = canonical.body.findings[index];
	assert.ok(finding);
	assert.equal(finding.state, "passed");
	assert.equal(finding.severity, "information");
	assert.equal(finding.observed, "approved-fallback");
	assert.equal(finding.expected, "pinned order");
	assert.equal(finding.repair_eligible, false);
	assert.equal(detail(f.runtime, finding).code, "APPROVED_FONT_FALLBACK");
	assert.ok(validateContract("PreflightReport", canonical).ok);
});

test("converts exact mm and preserves unrepresentable precision and unsafe values in safe evidence", async () => {
	// Given: exercise projection representation limits independently of measurement.
	await using f = await projectionFixture();
	const original = await inspectArtifact(
		f.stored.artifact,
		f.stored.inputs.profile.constraints,
		f.stored.inputs.ports,
		Date.parse(f.runtime.now()),
	);
	const base: Finding = {
		code: "TEXT_OVERFLOW",
		path: "nodes.name.text",
		severity: "repairable",
		state: "failed",
		observed: 1.234567,
		expected: 1,
		unit: "mm",
		repairEligible: true,
		ruleVersion: "private-preflight-2",
		specRevision: "synthetic-1",
		evidenceRef: "private-test",
	};
	const findings = [
		base,
		{ ...base, observed: 1.23456789 },
		{
			...base,
			observed: "customer secret",
			expected: "/Users/private/source.txt",
			path: "/Users/private/source.txt",
		},
		{ ...base, observed: 16.777215, expected: 1e-6 },
	];
	// When
	const report = projectPreflight(f.runtime, {
		artifact: f.composed,
		inputs: f.stored.inputs,
		report: { ...original, findings, modelReady: false, draftReady: false },
		fileEvidence: [],
		files: [],
	});
	// Then
	const [exact, imprecise, unsafe] = report.body.findings;
	assert.ok(exact && imprecise && unsafe);
	assert.equal(exact.unit, "nm");
	assert.equal(exact.observed, 1234567);
	assert.equal(exact.expected, 1000000);
	assert.equal(imprecise.unit, "state");
	assert.equal(imprecise.observed, "detail in evidence");
	assert.equal(detail(f.runtime, imprecise).observed, 1.23456789);
	assert.equal(detail(f.runtime, imprecise).unit, "mm");
	assert.equal(unsafe.field_path, "/preflight");
	const bytes = JSON.stringify(
		f.runtime.state.get(`evidence:${unsafe.evidence_ref.id}`),
	);
	assert.ok(
		!bytes.includes("customer secret") && !bytes.includes("/Users/private"),
	);
	assert.ok(validateContract("PreflightReport", report).ok);
	const binaryInexact = report.body.findings[3];
	assert.ok(binaryInexact);
	assert.equal(binaryInexact.unit, "nm");
	assert.equal(binaryInexact.observed, 16777215);
	assert.equal(binaryInexact.expected, 1);
});

test("an invoked scoped fulfillment fake rejects every blocking rule in the private inspection corpus", async () => {
	// Given: actual model/asset rules, no supplier transport.
	await using f = await projectionFixture();
	const { artifact: base, inputs } = f.stored;
	const unsafeSvg = Buffer.from(
		'<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>',
	);
	const textMutation = (
		value: string,
		changedDigest = true,
	): PrivateArtifact => ({
		...base,
		model: {
			...base.model,
			input: {
				...base.model.input,
				nodes: base.model.input.nodes.map((node) =>
					node.kind === "text"
						? {
								...node,
								field: {
									...node.field,
									source: { kind: "display", value },
									sourceDigest: changedDigest
										? digest(value)
										: node.field.sourceDigest,
								},
							}
						: node,
				),
			},
		},
	});
	const cases: readonly {
		readonly code: string;
		readonly artifact?: PrivateArtifact;
		readonly constraints?: typeof inputs.profile.constraints;
		readonly ports?: typeof inputs.ports;
	}[] = [
		{ code: "EXPORT_MISSING" },
		{ code: "SPEC_UNKNOWN", constraints: null },
		{
			code: "CURRENT_PERMISSION_BLOCKED",
			ports: { ...inputs.ports, compositionPermission: async () => null },
		},
		{
			code: "DIMENSIONS_MISMATCH",
			constraints: inputs.profile.constraints
				? { ...inputs.profile.constraints, width: 100 }
				: null,
		},
		{
			code: "GEOMETRY_INVALID",
			artifact: {
				...base,
				model: { ...base.model, layout: { ...base.model.layout, width: -1 } },
			},
		},
		{
			code: "DPI_LOW",
			artifact: await composeArtifact(
				{
					...inputs.input,
					nodes: inputs.input.nodes.map((v) =>
						v.kind === "artwork"
							? { ...v, transform: { ...v.transform, scaleX: 2, scaleY: 2 } }
							: v,
					),
				},
				inputs.layout,
				inputs.profile.fonts.map((v) => v.font),
				inputs.ports,
				Date.parse(f.runtime.now()),
			),
		},
		{
			code: "BLEED_COVERAGE",
			artifact: await composeArtifact(
				{
					...inputs.input,
					nodes: inputs.input.nodes.map((v) =>
						v.kind === "artwork" ? { ...v, opacity: 0.9 } : v,
					),
				},
				inputs.layout,
				inputs.profile.fonts.map((v) => v.font),
				inputs.ports,
				Date.parse(f.runtime.now()),
			),
		},
		{
			code: "SAFE_BOUNDS",
			artifact: await composeArtifact(
				{
					...inputs.input,
					nodes: inputs.input.nodes.map((v) =>
						v.kind === "text"
							? { ...v, transform: { ...v.transform, x: -4 } }
							: v,
					),
				},
				inputs.layout,
				inputs.profile.fonts.map((v) => v.font),
				inputs.ports,
				Date.parse(f.runtime.now()),
			),
		},
		{ code: "FONT_MISSING", artifact: { ...base, fontBytes: [] } },
		{
			code: "GLYPH_MISSING",
			artifact: textMutation(String.fromCodePoint(0x10ffff)),
		},
		{ code: "TEXT_FORMAT", artifact: textMutation("Unsafe\u202evalue", false) },
		{ code: "ASSET_MISSING", artifact: { ...base, assets: [] } },
		{
			code: "ASSET_HASH",
			artifact: {
				...base,
				assets: base.assets.map((v) => ({
					...v,
					sourceBase64: Buffer.from("changed asset").toString("base64"),
				})),
			},
		},
		{
			code: "COMPOSITION_INTEGRITY",
			artifact: { ...base, compositionHash: digest("changed") },
		},
		{
			code: "PROFILE_UNSUPPORTED",
			artifact: {
				...base,
				model: {
					...base.model,
					layout: { ...base.model.layout, profile: "cmyk" },
				},
			},
		},
		{
			code: "ASSET_UNSAFE",
			artifact: {
				...base,
				assets: base.assets.map((v) =>
					v.mime === "image/svg+xml"
						? {
								...v,
								binding: { ...v.binding, digest: digest(unsafeSvg) },
								sourceBase64: unsafeSvg.toString("base64"),
							}
						: v,
				),
			},
		},
	];
	const rejected: string[] = [],
		eligible: PreflightReport[] = [];
	const consumer = (report: PreflightReport, rule: string) => {
		assert.ok(validateContract("PreflightReport", report).ok);
		assert.deepEqual(f.runtime.context.scope, f.given.records.scope);
		for (const finding of report.body.findings) {
			const stored = z
				.object({
					record: z.object({ tenant_id: z.string(), project_id: z.string() }),
				})
				.parse(f.runtime.state.get(`evidence:${finding.evidence_ref.id}`));
			assert.deepEqual(stored.record, f.given.records.scope);
		}
		const checked = checkProductionPreflight(report, {
			artifact_ref: report.body.artifact_ref,
			spec_ref: report.body.spec_ref,
			rule_ref: report.body.rule_ref,
			parser_ref: inputs.composition.runtime_ref,
			files: [],
		});
		if (!checked.ok) {
			assert.ok(
				report.body.findings.some(
					(finding) =>
						detail(f.runtime, finding).code === rule &&
						(finding.state !== "passed" || finding.severity === "repairable"),
				),
			);
			rejected.push(rule);
			return;
		}
		if (report.eligibility.handoff_eligible) eligible.push(report);
	};
	// When
	for (const row of cases) {
		const { canonical, privateReport } = await f.project(
			row.artifact ?? base,
			row.constraints === undefined
				? inputs.profile.constraints
				: row.constraints,
			row.ports ?? inputs.ports,
		);
		assert.ok(
			privateReport.findings.some((v) => v.code === row.code),
			`${row.code}: ${privateReport.findings.map((v) => v.code).join(",")}`,
		);
		assert.equal(canonical.body.findings.length, privateReport.findings.length);
		consumer(canonical, row.code);
	}
	// Then
	assert.deepEqual(
		rejected,
		cases.map((v) => v.code),
	);
	assert.equal(eligible.length, 0);
});
