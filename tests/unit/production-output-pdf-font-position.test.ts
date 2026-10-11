import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { readResource } from "../../src/runtime/resources.js";
import { point } from "../../src/exporters/private-pdf-geometry.js";
import { pdfGlyphAdvance } from "../../src/exporters/private-pdf-font-position.js";

const number = z.number().finite();
const fixtures = z
	.object({
		checkpoint: z.string().regex(/^[a-f0-9]{40}$/),
		linuxRun: z.number().int().positive(),
		linuxArtifact: z.number().int().positive(),
		cases: z.array(
			z.object({
				fixture: z.string(),
				freetype: z.boolean(),
				lines: z.array(
					z.object({
						sizeMm: number.positive(),
						unitsPerEm: number.positive(),
						anchor: z.tuple([number, number]),
						world: z.tuple([number, number, number, number, number, number]),
						glyphs: z.array(
							z.tuple([
								number,
								number,
								number,
								number,
								number,
								number,
								number,
								number,
							]),
						),
					}),
				),
			}),
		),
	})
	.parse(
		JSON.parse(
			(
				await readResource(
					"tests/fixtures/production-output/pdf-font-position.json",
				)
			).toString(),
		),
	);

for (const fixture of fixtures.cases)
	test(`matches captured ${fixture.fixture} PDF origins with ${fixture.freetype ? "FreeType" : "CoreText"} metrics`, () => {
		let designMismatches = 0;
		for (const line of fixture.lines) {
			let x = 0,
				y = 0,
				designX = 0;
			const scale = line.sizeMm / line.unitsPerEm;
			for (const [
				width,
				advance,
				vertical,
				ox,
				oy,
				actualX,
				actualY,
				tolerance,
			] of line.glyphs) {
				const [expectedX, expectedY] = point(
					line.world,
					line.anchor[0] + x + ox * scale,
					-line.anchor[1] + y + oy * scale,
				);
				assert.ok(Math.abs(actualX - expectedX) < tolerance);
				assert.ok(Math.abs(actualY - expectedY) < tolerance);
				const [oldX] = point(
					line.world,
					line.anchor[0] + designX + ox * scale,
					-line.anchor[1] + y + oy * scale,
				);
				if (Math.abs(actualX - oldX) >= tolerance) designMismatches++;
				x += pdfGlyphAdvance({ advanceWidth: width }, advance, {
					sizeMm: line.sizeMm,
					unitsPerEm: line.unitsPerEm,
					freetype: fixture.freetype,
				});
				y += vertical * scale;
				designX += advance * scale;
			}
		}
		assert.equal(designMismatches > 0, fixture.freetype);
	});
