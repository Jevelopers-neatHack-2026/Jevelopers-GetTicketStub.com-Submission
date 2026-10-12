"""Synthetic rejection cases and canonical outline/raster contract checks (offline)."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import subprocess
import struct
import sys
import tempfile
import unittest
import zlib
from unittest.mock import patch

from PIL import Image
from tools.asset_lib import AssetError, rasterize, save_png, validate_png, validate_svg
from tools import build_logos

ROOT = Path(__file__).resolve().parents[2]
VALID = b'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" role="img" aria-label="Synthetic fixture"><title>Synthetic fixture</title><path fill="#17140F" d="M1 1L19 1L19 19L1 19Z"/></svg>'


class SvgValidationTests(unittest.TestCase):
    def test_all_canonical_vectors_fit_profile_and_bounds(self):
        recipe = json.loads((ROOT / "tools/assets/export-matrix.json").read_text())
        for row in recipe["vectors"]:
            with self.subTest(file=row["file"]):
                info = validate_svg((ROOT / "logo" / row["file"]).read_bytes(), expected_current_color=row["current_color"])
                self.assertGreater(info["path_count"], 0)

    def test_valid_outlined_fixture(self):
        self.assertEqual(validate_svg(VALID)["outline_bounds"], [1, 1, 19, 19])

    def test_active_external_and_font_content_rejected_before_render(self):
        additions = [
            b'<script>alert(1)</script>',
            b'<image href="https://invalid.example/asset.png"/>',
            b'<image href="file:///etc/hosts"/>',
            b'<image href="data:image/png;base64,AA=="/>',
            b'<use href="#mark"/>',
            b'<foreignObject><div>html</div></foreignObject>',
            b'<style>@import url(https://invalid.example/font.css);</style>',
            b'<text font-family="Example">Ts</text>',
            b'<animate attributeName="fill" values="#000000;#ffffff"/>',
            b'<a href="https://invalid.example"><path d="M1 1L2 2Z"/></a>',
            b'<script xmlns="urn:other">data</script>',
        ]
        with tempfile.TemporaryDirectory() as temporary:
            for addition in additions:
                with self.subTest(addition=addition), patch("tools.asset_lib.subprocess.run") as renderer:
                    with self.assertRaises(AssetError):
                        rasterize(VALID.replace(b"</svg>", addition + b"</svg>"), Path(temporary) / "bad.png", 20, 20)
                    renderer.assert_not_called()

    def test_event_style_and_external_reference_attributes_rejected(self):
        mutations = [
            VALID.replace(b'role="img"', b'role="img" onload="alert(1)"'),
            VALID.replace(b'fill="#17140F"', b'fill="#17140F" style="fill:url(https://invalid.example)"'),
            VALID.replace(b'fill="#17140F"', b'fill="url(https://invalid.example/asset.svg#p)"'),
            VALID.replace(b'fill="#17140F"', b'fill="url(#missing)"'),
            VALID.replace(b'role="img"', b'role="img" xml:base="https://invalid.example/"'),
        ]
        for value in mutations:
            with self.subTest(value=value), self.assertRaises(AssetError):
                validate_svg(value)

    def test_xml_declarations_entities_and_processing_instructions_rejected(self):
        prefixes = [b'<!DOCTYPE svg [<!ENTITY x "boom">]>', b'<?xml-stylesheet href="https://invalid.example/style.css"?>',
                    b'<!DOCTYPE svg SYSTEM "file:///etc/hosts">']
        for prefix in prefixes:
            with self.subTest(prefix=prefix), self.assertRaises(AssetError):
                validate_svg(prefix + VALID)

    def test_malformed_viewbox_dimensions_and_aspect_ratio_rejected(self):
        mutations = [
            VALID.replace(b'viewBox="0 0 20 20"', b'viewBox="0 0 20"'),
            VALID.replace(b'viewBox="0 0 20 20"', b'viewBox="0,,0,20,20"'),
            VALID.replace(b'viewBox="0 0 20 20"', b'viewBox="0 0 0 20"'),
            VALID.replace(b'viewBox="0 0 20 20"', b'viewBox="0 0 -20 20"'),
            VALID.replace(b'viewBox="0 0 20 20"', b'viewBox="0 0 NaN 20"'),
            VALID.replace(b'viewBox="0 0 20 20"', b'viewBox="0 0 1e999 20"'),
            VALID.replace(b'width="20"', b'width="40"'),
            VALID.replace(b'width="20"', b'width="20%"'),
            VALID.replace(b'height="20"', b'height="0"'),
            VALID.replace(b'viewBox="0 0 20 20"', b''),
        ]
        for value in mutations:
            with self.subTest(value=value), self.assertRaises(AssetError):
                validate_svg(value)

    def test_outline_clipping_empty_and_bad_transforms_rejected(self):
        mutations = [
            VALID.replace(b'M1 1L19 1L19 19L1 19Z', b'M1 1L29 1L29 19L1 19Z'),
            VALID.replace(b'M1 1L19 1L19 19L1 19Z', b'M1 1Z'),
            VALID.replace(b'M1 1L19 1L19 19L1 19Z', b'M1 1L19 1'),
            VALID.replace(b'M1 1L19 1L19 19L1 19Z', b'M1 1NOPEZ'),
            VALID.replace(b'<path ', b'<path transform="translate(20 0)" '),
            VALID.replace(b'<path ', b'<path transform="scale(-1)" '),
            VALID.replace(b'<path ', b'<path transform="rotate(10)" '),
        ]
        for value in mutations:
            with self.subTest(value=value), self.assertRaises(AssetError):
                validate_svg(value)

    def test_local_gradient_and_knockout_supported(self):
        source = (ROOT / "logo/ts-stamp.svg").read_bytes()
        self.assertFalse(validate_svg(source)["current_color"])
        mono = (ROOT / "logo/ts-stamp-mono-ink.svg").read_bytes()
        self.assertIn(b'fill-rule="evenodd"', mono)
        validate_svg(mono)

    def test_currentcolor_requires_explicit_raster_context(self):
        source = (ROOT / "logo/ts-stamp-currentcolor.svg").read_bytes()
        with tempfile.TemporaryDirectory() as temporary, patch("tools.asset_lib.subprocess.run") as renderer:
            with self.assertRaisesRegex(AssetError, "explicit foreground"):
                rasterize(source, Path(temporary) / "missing-context.png", 80, 100)
            renderer.assert_not_called()
        with self.assertRaisesRegex(AssetError, "differs from the output matrix"):
            validate_svg(source, expected_current_color=False)


class PngValidationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "fixture.png"
        self.image = Image.new("RGBA", (20, 20), (23, 20, 15, 255))
        self.image.putpixel((10, 10), (0, 0, 0, 0))
        save_png(self.image, self.path)

    def test_canonical_png_metadata_and_knockout(self):
        result = validate_png(self.path, 20, 20, alpha="transparent", knockout=True)
        self.assertEqual(result["alpha_extrema"], [0, 255])
        self.assertEqual(result["color_space"], "sRGB")

    def test_wrong_dimensions_fail(self):
        with self.assertRaisesRegex(AssetError, "dimensions"):
            validate_png(self.path, 1024, 1024, alpha="transparent")

    def test_antialiased_edge_transparency_is_not_required_to_reach_zero(self):
        self.image.putpixel((10, 10), (23, 20, 15, 34))
        save_png(self.image, self.path)
        self.assertEqual(validate_png(self.path, 20, 20, alpha="transparent")["alpha_extrema"], [34, 255])

    def test_alpha_and_missing_knockout_fail(self):
        with self.assertRaisesRegex(AssetError, "contains transparency"):
            validate_png(self.path, 20, 20, alpha="opaque")
        image = Image.new("RGBA", (20, 20), (23, 20, 15, 255))
        image.putpixel((0, 0), (0, 0, 0, 0))
        save_png(image, self.path)
        with self.assertRaisesRegex(AssetError, "knockout"):
            validate_png(self.path, 20, 20, alpha="transparent", knockout=True)

    def test_unlabeled_rgb_and_wrong_dpi_fail(self):
        self.image.convert("RGB").save(self.path)
        with self.assertRaises(AssetError):
            validate_png(self.path, 20, 20, alpha="opaque")
        save_png(self.image, self.path, dpi=300)
        with self.assertRaisesRegex(AssetError, "resolution"):
            validate_png(self.path, 20, 20, alpha="transparent")

    def test_corrupt_chunks_fail(self):
        data = bytearray(self.path.read_bytes())
        data[30] ^= 1
        self.path.write_bytes(data)
        with self.assertRaisesRegex(AssetError, "checksum"):
            validate_png(self.path, 20, 20, alpha="transparent")

    def test_repeated_encoding_is_byte_stable(self):
        initial = self.path.read_bytes()
        save_png(self.image, self.path)
        self.assertEqual(initial, self.path.read_bytes())

    def test_resealed_malformed_metadata_and_order_rejected(self):
        original = self.path.read_bytes()
        chunks, offset = [], 8
        while offset < len(original):
            size = struct.unpack(">I", original[offset:offset + 4])[0]
            chunks.append((original[offset + 4:offset + 8], original[offset + 8:offset + 8 + size]))
            offset += 12 + size
        def write(parts):
            encoded = b"\x89PNG\r\n\x1a\n"
            for tag, payload in parts:
                encoded += struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
            self.path.write_bytes(encoded)
        cases = []
        for kind in (b"sRGB", b"pHYs", b"IEND"):
            cases.append([(tag, payload + b"x" if tag == kind else payload) for tag, payload in chunks])
        cases.append([(tag, b"\x01" if tag == b"sRGB" else payload) for tag, payload in chunks])
        cases.append([(tag, payload[:-1] + b"\x00" if tag == b"pHYs" else payload) for tag, payload in chunks])
        # Move an otherwise valid metadata chunk between two checksum-correct
        # image data chunks; Pillow may tolerate it, but this profile must not.
        late = [part for part in chunks if part[0] != b"sRGB"]
        slot = next(i for i, (tag, _) in enumerate(late) if tag == b"IDAT") + 1
        late[slot:slot] = [(b"sRGB", b"\x00"), (b"IDAT", b"")]
        cases.append(late)
        cases.append(chunks + [(b"IDAT", b"")])
        cases.append([part for part in chunks if part[0] != b"IDAT"])
        for index, parts in enumerate(cases):
            with self.subTest(case=index), self.assertRaises(AssetError):
                write(parts)
                validate_png(self.path, 20, 20, alpha="transparent")


class SourceParityTests(unittest.TestCase):
    def test_matrix_cannot_omit_required_review_coverage(self):
        # Import the actual CLI module so a changed data recipe cannot silently
        # waive sizes/backgrounds while the renderer still produces valid PNGs.
        from tools import build_assets
        recipe = json.loads((ROOT / "tools/assets/export-matrix.json").read_text())
        mutations = []
        bad = copy.deepcopy(recipe); bad["vectors"][0]["kind"] = "wordmark"; mutations.append(bad)
        bad = copy.deepcopy(recipe); bad["rasters"] = [r for r in bad["rasters"] if r["source"] != "favicon.svg"]; mutations.append(bad)
        bad = copy.deepcopy(recipe); next(r for r in bad["vectors"] if r["file"] == "ts-stamp-mono-cream.svg")["backgrounds"] = ["cream"]; mutations.append(bad)
        bad = copy.deepcopy(recipe); next(r for r in bad["vectors"] if r["file"] == "ts-stamp-mono-ink.svg")["knockout"] = False; mutations.append(bad)
        bad = copy.deepcopy(recipe); bad["rasters"][0]["width"] = 17; mutations.append(bad)
        for index, bad in enumerate(mutations):
            with self.subTest(case=index), patch.object(build_assets, "read_json", return_value=bad), self.assertRaises(ValueError):
                build_assets.matrix()

    def test_validator_cli_positive_and_negative_exit_codes(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "fixture.svg"
            for content, expected in ((VALID, 0), (VALID.replace(b"</svg>", b"<script>invalid</script></svg>"), 1)):
                path.write_bytes(content)
                result = subprocess.run([sys.executable, "-I", str(ROOT / "tools/check_asset.py"), "svg", str(path)], capture_output=True, text=True)
                self.assertEqual(result.returncode, expected, result.stderr)

    def test_current_palette_and_source_font_pins_pass(self):
        build_logos.verify_inputs()

    def test_palette_drift_fails_before_rebuild(self):
        tokens = copy.deepcopy(json.loads((ROOT / "tokens/tokens.json").read_text()))
        tokens["color"]["orange"]["$value"] = "#000000"
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "tokens.json"
            path.write_text(json.dumps(tokens))
            with self.assertRaisesRegex(ValueError, "color.orange"):
                build_logos.verify_inputs(path)

    def test_pinned_generator_preserves_every_canonical_svg(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = subprocess.run([sys.executable, str(ROOT / "tools/build_logos.py"), "--output-dir", temporary],
                                    cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            generated = Path(temporary)
            names = {path.name for path in (ROOT / "logo").glob("*.svg")}
            self.assertEqual(names, {path.name for path in generated.iterdir()})
            for name in names:
                with self.subTest(file=name):
                    self.assertEqual((ROOT / "logo" / name).read_bytes(), (generated / name).read_bytes())


if __name__ == "__main__":
    unittest.main()
