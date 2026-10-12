import { readFile } from "node:fs/promises";
import { crc32 } from "node:zlib";
import { PNG } from "pngjs";
import { assetBindingSchema } from "../../../src/assets/private-assets.js";
import type { AssetBinding } from "../../../src/assets/private-assets.js";
import { composeArtifact } from "../../../src/composition/private-model.js";
import type { RepairPorts } from "../../../src/repair/private-repair.js";
import {
	digest,
	parse,
	refSchema,
	scopeSchema,
} from "../../../src/composition/primitives.js";
import {
	resolveConstraints,
	resolveLayout,
} from "../../../src/templates/private-layout.js";
import { pinFont } from "../../../src/typography/private-text.js";
import type { PinnedFont } from "../../../src/typography/private-text.js";
import { resource } from "../../../src/runtime/resources.js";

export const fontPins = Object.freeze({
	latin: {
		ref: "synthetic-latin",
		digest: "b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5",
		licenseDigest:
			"0dab92d0544f7b233403f14b84a663bdbfa746982eda629e7f4f9ffe1b036feb",
		license: "OFL-1.1",
		postscriptName: "NotoSans-Regular",
		provenance:
			"https://raw.githubusercontent.com/notofonts/noto-fonts/ffebf8c1ee449e544955a7e813c54f9b73848eac/hinted/ttf/NotoSans/NotoSans-Regular.ttf",
		format: "truetype",
	},
	arabic: {
		ref: "synthetic-arabic",
		digest: "4e2ca0745c908761dc5c5db951662873887c59366fa1a5693ad22c0864abf1bd",
		licenseDigest:
			"91053c23e8a0fe5fc9b5fdbe5ff74ceffd66f6f996c123f1a6ca4c23487c1fff",
		license: "OFL-1.1",
		postscriptName: "NotoSansArabic-Regular",
		provenance:
			"https://registry.npmjs.org/@fontsource/noto-sans-arabic/-/noto-sans-arabic-5.3.0.tgz",
		format: "woff2",
	},
	subset: {
		ref: "synthetic-latin-subset",
		digest: "09aee8065d25508f23a4c3d92cd777ac869c52d93fd868a88f025d888a7937d6",
		licenseDigest:
			"54ec7b5a35310ad66f9f3091426f7028484cbf9ae1ab5da30122ee412a3009e1",
		license: "OFL-1.1",
		postscriptName: "NotoSans-Regular",
		provenance:
			"https://registry.npmjs.org/@fontsource/noto-sans/-/noto-sans-5.3.0.tgz",
		format: "woff2",
	},
});
export async function fixtureFonts(): Promise<readonly PinnedFont[]> {
	const [latin, latinLicense, arabic, arabicLicense] = await Promise.all([
		readFile(resource("src/assets/fonts/composition-noto-sans.ttf")),
		readFile(resource("src/assets/fonts/composition-noto-sans-OFL.txt")),
		readFile(
			resource(
				"node_modules/@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-400-normal.woff2",
			),
		),
		readFile(resource("node_modules/@fontsource/noto-sans-arabic/LICENSE")),
	]);
	const [subset, subsetLicense] = await Promise.all([
		readFile(resource("src/assets/fonts/noto-sans-latin-400-normal.woff2")),
		readFile(resource("src/assets/fonts/OFL.txt")),
	]);
	return [
		pinFont(fontPins.latin, latin, latinLicense),
		pinFont(fontPins.arabic, arabic, arabicLicense),
		pinFont(fontPins.subset, subset, subsetLicense),
	];
}
export const scope = parse(scopeSchema, {
	tenant: "synthetic-tenant",
	project: "synthetic-project",
});
export const identityTransform = {
	x: 0,
	y: 0,
	scaleX: 1,
	scaleY: 1,
	rotation: 0,
} as const;
export function artworkPng(width = 1200, height = 600): Buffer {
	const png = new PNG({ width, height });
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			png.data[i] = 230 - Math.floor((x / width) * 30);
			png.data[i + 1] = 241 - Math.floor((y / height) * 12);
			png.data[i + 2] = 245;
			png.data[i + 3] = 255;
		}
	const bytes = PNG.sync.write(png);
	const chunk = Buffer.alloc(13);
	chunk.writeUInt32BE(1, 0);
	chunk.write("sRGB", 4, "ascii");
	chunk[8] = 0;
	chunk.writeUInt32BE(crc32(chunk.subarray(4, 9)), 9);
	return Buffer.concat([bytes.subarray(0, 33), chunk, bytes.subarray(33)]);
}
export const safeLogo = Buffer.from(
	'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><title>Synthetic logo</title><rect x="5" y="5" width="90" height="90" fill="#134c67"/><circle cx="50" cy="50" r="25" fill="#ffffff"/></svg>',
);
export function binding(
	ref: string,
	bytes: Uint8Array,
	purpose: "artwork" | "overlay",
): AssetBinding {
	return parse(assetBindingSchema, {
		ref,
		version: "synthetic-1",
		digest: digest(bytes),
		permissionRef: "synthetic-permission",
		scope,
		purpose,
		normalization: "none",
	});
}
export function fixtureLayout() {
	const fonts = [
		"synthetic-latin",
		"synthetic-arabic",
		"synthetic-latin-subset",
	];
	const slot = (
		id: string,
		kind: "artwork" | "text" | "overlay" | "shape" | "guide",
		bounds: { x: number; y: number; width: number; height: number },
		required: boolean,
	) => ({
		id,
		kind,
		bounds,
		required,
		minFontMm: 2,
		maxFontMm: 7,
		allowedFonts: fonts,
		allowCrop: false,
		maxRotation: 180,
		fits: ["contain", "exact"],
	});
	return resolveLayout({
		privateVersion: 1,
		id: "synthetic-layout",
		revision: "fixture-1",
		productRef: "synthetic-product-not-supplier",
		policyRevision: "synthetic-policy-1",
		units: "mm",
		origin: "top-left",
		width: 101.6,
		height: 50.8,
		orientation: "landscape",
		trim: { x: 2, y: 2, width: 97.6, height: 46.8 },
		bleed: { x: 0, y: 0, width: 101.6, height: 50.8 },
		safe: { x: 5, y: 5, width: 91.6, height: 40.8 },
		minDpi: 290,
		profile: "srgb",
		transparency: "allow",
		exports: ["svg", "png", "pdf"],
		fonts,
		background: "#ffffff",
		includeProofGuides: true,
		allowedWarnings: [],
		slots: [
			slot(
				"art-slot",
				"artwork",
				{ x: 0, y: 0, width: 101.6, height: 50.8 },
				true,
			),
			slot("name-slot", "text", { x: 7, y: 7, width: 74, height: 16 }, true),
			slot("detail-slot", "text", { x: 7, y: 28, width: 74, height: 13 }, true),
			slot("logo-slot", "overlay", { x: 85, y: 7, width: 8, height: 8 }, true),
			slot(
				"shape-slot",
				"shape",
				{ x: 7, y: 25, width: 86, height: 0.5 },
				false,
			),
			slot(
				"guide-slot",
				"guide",
				{ x: 0, y: 0, width: 101.6, height: 50.8 },
				false,
			),
		],
	});
}
export function fixtureConstraints(layout = fixtureLayout()) {
	return resolveConstraints({
		specRef: "synthetic-spec-not-supplier",
		revision: "synthetic-1",
		sourceDigest: digest("synthetic constraints only"),
		productRef: layout.productRef,
		width: layout.width,
		height: layout.height,
		bleed: layout.bleed,
		safe: layout.safe,
		minDpi: layout.minDpi,
		profiles: ["srgb"],
		exports: ["svg", "png", "pdf"],
		fonts: layout.fonts,
		transparency: "allow",
		requiredChecks: ["dimensions", "content", "fonts", "container", "profile"],
	});
}
export function fixtureInput(
	art: Uint8Array,
	logo: Uint8Array = safeLogo,
	name = "Café O’Connor",
	detail = "Seat 0007 • Serial 000123",
	rtl = false,
) {
	const common = (id: string, slot: string, order: number) => ({
		id,
		slot,
		order,
		visible: true,
		transform: identityTransform,
		clip: null,
		opacity: 1,
		blend: "normal",
	});
	const field = (
		id: string,
		value: string,
		bounds: { x: number; y: number; width: number; height: number },
		direction: "ltr" | "rtl",
	) => ({
		fieldRef: id,
		rowRef: "synthetic-row-001",
		sourceRef: `synthetic-source-${id}`,
		sourceDigest: digest(value),
		source: { kind: "display", value },
		formatRevision: "synthetic-display-1",
		required: true,
		fontOrder: direction === "rtl" ? ["synthetic-arabic"] : ["synthetic-latin"],
		sizeMm: 4,
		lineHeight: 1.35,
		wrap: "grapheme",
		align: "start",
		direction,
		language: direction === "rtl" ? "ar" : "en",
		baseline: "alphabetic",
		bounds,
		color: "#134c67",
		letterSpacingMm: 0,
	});
	return {
		privateVersion: 1,
		scope,
		designRef: "synthetic-design",
		designDigest: digest(art),
		factsRef: "synthetic-facts",
		factsDigest: digest(`${name}|${detail}`),
		approvalRef: "synthetic-composition-permission",
		approvalDigest: digest("test-only external port fixture"),
		inputPolicyRevision: "synthetic-input-1",
		rendererRevision: "private-svg-v1_fontkit-2.0.4_sax-1.6.1",
		nodes: [
			{
				...common("art", "art-slot", 0),
				kind: "artwork",
				asset: binding("synthetic-art", art, "artwork"),
				box: { x: 0, y: 0, width: 101.6, height: 50.8 },
				fit: "exact",
				anchor: "center",
				crop: null,
			},
			{
				...common("name", "name-slot", 1),
				kind: "text",
				field: field(
					"name",
					name,
					{ x: 7, y: 7, width: 74, height: 16 },
					rtl ? "rtl" : "ltr",
				),
			},
			{
				...common("detail", "detail-slot", 2),
				kind: "text",
				field: field(
					"detail",
					detail,
					{ x: 7, y: 28, width: 74, height: 13 },
					"ltr",
				),
			},
			{
				...common("logo", "logo-slot", 3),
				kind: "overlay",
				asset: binding("synthetic-logo", logo, "overlay"),
				box: { x: 85, y: 7, width: 8, height: 8 },
				fit: "contain",
				anchor: "center",
				crop: null,
			},
			{
				...common("separator", "shape-slot", 4),
				kind: "shape",
				shape: "rect",
				box: { x: 7, y: 25, width: 86, height: 0.5 },
				fill: "#134c67",
				stroke: "#134c67",
				strokeWidth: 0,
			},
			{
				...common("safe-guide", "guide-slot", 5),
				kind: "guide",
				tag: "safe",
				box: { x: 5, y: 5, width: 91.6, height: 40.8 },
			},
		],
	};
}
export function syntheticPorts(art: Uint8Array, logo: Uint8Array = safeLogo) {
	const state = {
		revoked: false,
		lookupFails: false,
		denyDerived: false,
		generationCalls: 0,
		resolveCalls: 0,
		permissionCalls: 0,
	};
	const ports: RepairPorts & { readonly generateImage: () => never } = {
		resolve: async (requestScope, ref) => {
			state.resolveCalls++;
			if (
				requestScope.tenant !== scope.tenant ||
				requestScope.project !== scope.project
			)
				return null;
			return ref === "synthetic-art"
				? Buffer.from(art)
				: ref === "synthetic-logo"
					? Buffer.from(logo)
					: null;
		},
		permission: async (request) => {
			state.permissionCalls++;
			if (state.lookupFails)
				throw new Error("synthetic private lookup failure");
			const { ref, version, digest, permissionRef, scope, purpose } =
				request.binding;
			return {
				ref,
				version,
				digest,
				permissionRef,
				scope,
				purpose,
				state: state.revoked ? "revoked" : "allowed",
				validUntil: 2000,
				appliesTo: request.composition ?? "source",
			};
		},
		compositionPermission: async (request) => ({
			state:
				state.revoked || (state.denyDerived && request.stage === "repair")
					? "denied"
					: "allowed",
			compositionHash: request.compositionHash,
			approvalRef: request.model.input.approvalRef,
			approvalDigest: request.model.input.approvalDigest,
			validUntil: 2000,
		}),
		repairPermission: async (request) => ({
			state: state.revoked || state.denyDerived ? "denied" : "allowed",
			planHash: request.plan.id,
			policyHash: request.plan.policyHash,
			precondition: request.plan.precondition,
			result: request.result.revision,
			permissionRef: request.plan.permissionRef,
			validUntil: 2000,
		}),
		generateImage: () => {
			state.generationCalls++;
			throw new Error("Generation forbidden");
		},
	};
	return { ports, state };
}
export async function fixtureArtifact(
	name = "Café O’Connor",
	detail = "Seat 0007 • Serial 000123",
	rtl = false,
) {
	const art = artworkPng(),
		fonts = await fixtureFonts(),
		{ ports, state } = syntheticPorts(art),
		layout = fixtureLayout(),
		constraints = fixtureConstraints(layout),
		input = fixtureInput(art, safeLogo, name, detail, rtl);
	return {
		artifact: await composeArtifact(input, layout, fonts, ports, 1000),
		art,
		fonts,
		ports,
		state,
		layout,
		constraints,
		input,
	};
}
export const privateRef = (value: string) => refSchema.parse(value);
