"""Build/check local review assets; this command never creates a release package."""
from __future__ import annotations

import argparse
import contextlib
import html
import io
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

# `python -I tools/build_assets.py` deliberately trusts only this checkout's tools.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from asset_lib import AssetError, rasterize, save_png, sha256, toolchain, validate_png, validate_svg
import build_logos
from PIL import Image, ImageDraw, ImageFont

CONFIG = ROOT / "tools" / "assets"
OUTPUT = ROOT / "build" / "asset-review"
# These are the current canonical filenames and required review roles. The data
# matrix may describe the recipe, but cannot remove a required case by relabeling
# a stamp as a wordmark or replacing an allowed contrasting background.
VECTOR_KINDS = {
    **{name: "stamp" for name in ("ts-stamp.svg", "ts-stamp-mono-orange.svg",
       "ts-stamp-mono-ink.svg", "ts-stamp-mono-cream.svg", "ts-stamp-currentcolor.svg")},
    **{name: "wordmark" for name in ("wordmark.svg", "wordmark-cream.svg", "wordmark-orange.svg")},
    "favicon.svg": "favicon", "app-icon.svg": "app-icon",
    "wordmark-compact.svg": "compact-wordmark",
    "lockup-horizontal.svg": "horizontal-lockup",
    "lockup-horizontal-mono.svg": "horizontal-lockup", "lockup-stacked.svg": "stacked-lockup",
}


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def matrix() -> dict:
    result = read_json(CONFIG / "export-matrix.json")
    if result.get("schema_version") != 1 or result.get("status") != "local-review-only" or result.get("release_eligible") is not False or result.get("approval_reference") is not None:
        raise AssetError("This builder accepts only the explicitly unapproved review matrix")
    vectors = result["vectors"]
    names = [row["file"] for row in vectors]
    if len(names) != len(set(names)) or any(not re.fullmatch(r"[a-z0-9-]+\.svg", name) for name in names):
        raise AssetError("Vector matrix filenames must be unique canonical basenames")
    if set(names) != set(VECTOR_KINDS) or set(names) != {path.name for path in (ROOT / "logo").glob("*.svg")}:
        raise AssetError("Vector matrix does not cover the canonical logo files exactly")
    for row in vectors:
        name = row["file"]
        if row["kind"] != VECTOR_KINDS[name]:
            raise AssetError("Canonical vector role changed; required minimum-size QA must be preserved")
        backgrounds = {"cream", "ink"}
        if name in {"ts-stamp-mono-ink.svg", "wordmark.svg", "wordmark-compact.svg",
                    "lockup-horizontal.svg", "lockup-stacked.svg"}:
            backgrounds = {"cream"}
        elif name in {"ts-stamp-mono-cream.svg", "wordmark-cream.svg"}:
            backgrounds = {"ink"}
        if not isinstance(row["backgrounds"], list) or len(row["backgrounds"]) != len(backgrounds) or set(row["backgrounds"]) != backgrounds:
            raise AssetError("Canonical vector requires its documented contrasting background contexts")
        if not isinstance(row["current_color"], bool) or not isinstance(row["knockout"], bool):
            raise AssetError("Matrix context flags must be booleans")
        if row["current_color"] != (name in {"ts-stamp-currentcolor.svg", "lockup-horizontal-mono.svg"}) \
                or row["knockout"] != (name.startswith("ts-stamp-mono-") or name in {"ts-stamp-currentcolor.svg", "favicon.svg"}):
            raise AssetError("Canonical currentColor/knockout review requirements changed")
    rasters = result["rasters"]
    output_names = [row["file"] for row in rasters]
    if len(output_names) != len(set(output_names)):
        raise AssetError("Duplicate raster output")
    for row in rasters:
        if row["source"] not in names or not re.fullmatch(r"[a-z0-9-]+\.png", row["file"]):
            raise AssetError("Raster must derive from a listed canonical vector")
        if any(type(row[axis]) is not int or not 1 <= row[axis] <= 4096 for axis in ("width", "height")):
            raise AssetError("Raster dimensions must be bounded integers")
        if row["dpi"] != 96 or row["alpha"] not in {"opaque", "transparent"}:
            raise AssetError("Unsupported raster encoding")
    required_rasters = {("favicon.svg", f"favicon-{size}.png", size, size, "transparent") for size in (16, 24, 32)}
    required_rasters.add(("app-icon.svg", "app-icon-1024.png", 1024, 1024, "opaque"))
    actual_rasters = {(row["source"], row["file"], row["width"], row["height"], row["alpha"]) for row in rasters}
    if not required_rasters <= actual_rasters:
        raise AssetError("Required 16/24/32px favicons or opaque 1024px app icon are absent or changed")
    return result


def source_record(paths: list[Path]) -> dict:
    revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
    inputs = []
    for path in sorted(set(paths)):
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT) or not path.is_file():
            raise AssetError("Source input is missing or follows a symlink outside this checkout")
        inputs.append({"path": path.relative_to(ROOT).as_posix(), "sha256": sha256(path)})
    status = subprocess.run(["git", "status", "--porcelain", "--untracked-files=all", "--", *[row["path"] for row in inputs]],
                            cwd=ROOT, check=True, capture_output=True, text=True).stdout.splitlines()
    return {"repository": "Jevelopers-neatHack-2026/brand-kit", "revision": revision,
            "input_worktree_changes": status, "inputs": inputs}


def qa_sizes(kind: str, ratio: float) -> list[dict]:
    if kind == "favicon":
        return [{"label": f"{n}px", "width": n, "height": n, "dpi": 96} for n in (16, 24, 32)]
    if kind == "stamp":
        return [{"label": "24px-tall", "width": round(24 * ratio), "height": 24, "dpi": 96},
                {"label": "8mm-print-sample", "width": round(math.ceil(8 / 25.4 * 300) * ratio), "height": math.ceil(8 / 25.4 * 300), "dpi": 300}]
    widths = {"wordmark": [120], "compact-wordmark": [119, 120], "horizontal-lockup": [240],
              "stacked-lockup": [180], "app-icon": [256]}[kind]
    return [{"label": f"{width}px-wide", "width": width, "height": round(width / ratio), "dpi": 96} for width in widths]


def review_panels(output: Path, recipe: dict, sources: dict, palette: dict) -> list[dict]:
    """Render synthetic review panels; their existence never records human approval."""
    entries, contact_sheets = [], {}
    labels = ImageFont.load_default(size=12)
    for row in recipe["vectors"]:
        info = validate_svg(sources[row["file"]], expected_current_color=row["current_color"])
        ratio = info["viewBox"][2] / info["viewBox"][3]
        for size in qa_sizes(row["kind"], ratio):
            for density in (1, 2):
                for background in row["backgrounds"]:
                    name = f"{Path(row['file']).stem}-{size['label']}-{background}-{density}x"
                    w, h = size["width"] * density, size["height"] * density
                    raw = output / "qa" / "renders" / f"{name}.png"
                    foreground = palette["ink" if background == "cream" else "cream"] if row["current_color"] else None
                    rasterize(sources[row["file"]], raw, w, h, color=foreground, dpi=size["dpi"] * density)
                    details = validate_png(raw, w, h, alpha="opaque" if row["kind"] == "app-icon" else "transparent",
                                           dpi=size["dpi"] * density, knockout=row["knockout"])
                    with Image.open(raw) as rendered:
                        # The individual PNG stays at native device pixels; panel
                        # preview shows its CSS size, like the HTML 1x/2x fixture.
                        css_w, css_h = size["width"], size["height"]
                        if size["dpi"] == 300:
                            css_w, css_h = round(css_w / 300 * 96), round(css_h / 300 * 96)
                        sample = rendered.resize((css_w, css_h), Image.Resampling.LANCZOS)
                        panel = Image.new("RGBA", (320, max(120, css_h + 58)), palette[background])
                        panel.alpha_composite(sample, ((320 - css_w) // 2, 38))
                    draw = ImageDraw.Draw(panel)
                    label_color = palette["ink" if background == "cream" else "cream"]
                    draw.text((10, 8), row["file"], fill=label_color, font=labels)
                    draw.text((10, panel.height - 18), f"{size['label']} | {background} | {density}x", fill=label_color, font=labels)
                    panel_path = output / "qa" / "panels" / f"{name}.png"
                    save_png(panel, panel_path)
                    entry = {"source": f"logo/{row['file']}", "render": raw.relative_to(output).as_posix(),
                             "panel": panel_path.relative_to(output).as_posix(), "size": size["label"], "density": density,
                             "background": background, "current_color": foreground, "css_width": css_w, "css_height": css_h,
                             "origin": "local vector render; synthetic QA context", "manual_review": "pending", **details}
                    entries.append(entry)
                    category = f"{row['kind']}-{density}x"
                    contact_sheets.setdefault(category, []).append(panel)
                    if row["kind"] == "stamp" and row["knockout"] and size["dpi"] == 96:
                        # Synthetic busy backdrop, always behind an opaque plate.
                        # No reference imagery or uncleared photo enters this build.
                        plated = Image.new("RGBA", (320, 120), palette["cyan"])
                        stripe = ImageDraw.Draw(plated)
                        for x in range(-120, 440, 24):
                            stripe.polygon([(x, 0), (x + 14, 0), (x + 134, 120), (x + 120, 120)], fill=palette["orange"])
                        plate = Image.new("RGBA", (css_w + 32, css_h + 32), palette[background])
                        plate.alpha_composite(sample, (16, 16))
                        plated.alpha_composite(plate, ((320 - plate.width) // 2, 26))
                        stripe.rectangle((0, 0, 320, 22), fill=palette[background])
                        stripe.text((8, 5), f"SYNTHETIC imagery / opaque {background} plate", fill=label_color, font=labels)
                        image_path = output / "qa" / "plates" / f"{name}.png"
                        save_png(plated, image_path)
                        entries.append({"source": f"logo/{row['file']}", "panel": image_path.relative_to(output).as_posix(),
                                        "density": density, "background": f"synthetic imagery + {background} plate",
                                        "origin": "synthetic checker/stripe drawing with local vector render", "manual_review": "pending"})
                        contact_sheets.setdefault(f"imagery-plates-{density}x", []).append(plated)
    for category, panels in contact_sheets.items():
        columns = 3
        cell_h = max(panel.height for panel in panels)
        sheet = Image.new("RGBA", (columns * 320, 42 + math.ceil(len(panels) / columns) * cell_h), "#DDDDDD")
        ImageDraw.Draw(sheet).text((10, 12), f"LOCAL REVIEW ONLY / {category} / no approval recorded", fill="#17140F", font=labels)
        for index, panel in enumerate(panels):
            sheet.alpha_composite(panel, (index % columns * 320, 42 + index // columns * cell_h))
        save_png(sheet, output / "qa" / f"contact-{category}.png")
    return entries


def write_fixture(output: Path, qa: list[dict]) -> None:
    cards = []
    for row in qa:
        if "render" in row:
            cards.append(f'<section><h2>{html.escape(row["source"])}</h2><p>{html.escape(row["size"])}; {row["density"]}x; '
                         f'{html.escape(row["background"])}; currentColor={html.escape(str(row["current_color"]))}</p>'
                         f'<div class="{row["background"]}"><img src="{row["render"]}" width="{row["css_width"]}" '
                         f'height="{row["css_height"]}" alt="TicketStub review sample"></div></section>')
        else:
            cards.append(f'<section><h2>{html.escape(row["source"])}</h2><img src="{row["panel"]}" '
                         'width="320" height="120" alt="Synthetic busy backdrop with opaque brand plate"></section>')
    fixture = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">' \
              '<title>TicketStub asset review — unapproved</title><style>body{font:16px system-ui;margin:24px;background:#eee;color:#17140f}' \
              'main{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px}section{background:white;padding:12px}' \
              'h2{font-size:16px}section div{min-height:70px;padding:24px;display:grid;place-items:center}.cream{background:#f4ecdd}' \
              '.ink{background:#17140f}img{max-width:100%;object-fit:contain}</style><h1>Local review only — approval pending</h1>' \
              '<p>Canonical vector render samples. Screenshots and this fixture are QA evidence, never canonical assets or approval. ' \
              '1x and 2x files render directly from vectors; the displayed size is CSS pixels. Print samples need physical proof. ' \
              'Inspect <a href="png/app-icon-1024.png">the required app icon at its native 1024px</a>.</p><main>' \
              + "".join(cards) + '</main></html>\n'
    (output / "review.html").write_text(fixture, encoding="utf-8")


def build(output: Path) -> dict:
    recipe, config = matrix(), read_json(CONFIG / "toolchain.json")
    inputs = [ROOT / "tools" / name for name in ("build_logos.py", "asset_lib.py", "build_assets.py", "check_asset.py", "tests/test_assets.py")]
    inputs += [CONFIG / name for name in ("export-matrix.json", "toolchain.json", "requirements.txt")]
    inputs += [ROOT / config["font"]["path"], ROOT / config["font"]["license_path"], ROOT / "tokens" / "tokens.json"]
    inputs += [ROOT / "logo" / row["file"] for row in recipe["vectors"]]
    source = source_record(inputs)
    runtime = toolchain(config)
    if output.exists():
        raise AssetError("Internal build output must start empty")
    output.mkdir(parents=True)
    with contextlib.redirect_stdout(io.StringIO()):
        build_logos.build(output / "svg")
    sources, vectors = {}, []
    for row in recipe["vectors"]:
        original = ROOT / "logo" / row["file"]
        regenerated = output / "svg" / row["file"]
        if regenerated.read_bytes() != original.read_bytes():
            raise AssetError(f"Regenerated {row['file']} differs from canonical bytes; review the baseline before updating")
        sources[row["file"]] = regenerated.read_bytes()
        vectors.append({"path": f"svg/{row['file']}", "source": f"logo/{row['file']}", "sha256": sha256(regenerated),
                        "approval_reference": None, "release_eligible": False,
                        **validate_svg(sources[row["file"]], expected_current_color=row["current_color"])})
    rasters = []
    for row in recipe["rasters"]:
        path = output / "png" / row["file"]
        source_row = next(item for item in recipe["vectors"] if item["file"] == row["source"])
        if source_row["current_color"]:
            raise AssetError("A generic currentColor PNG is unsupported; QA contexts must resolve the foreground explicitly")
        rasterize(sources[row["source"]], path, row["width"], row["height"], dpi=row["dpi"])
        rasters.append({"path": f"png/{row['file']}", "source": f"logo/{row['source']}", "purpose": row["purpose"],
                        "approval_reference": None, "release_eligible": False,
                        **validate_png(path, row["width"], row["height"], alpha=row["alpha"], dpi=row["dpi"], knockout=source_row["knockout"])})
    palette = {name: value["$value"] for name, value in read_json(ROOT / "tokens" / "tokens.json")["color"].items() if not name.startswith("$")}
    qa = review_panels(output, recipe, sources, palette)
    write_fixture(output, qa)
    (output / "LOCAL-REVIEW-ONLY.txt").write_text(
        "UNAPPROVED LOCAL REVIEW ARTIFACTS. Do not distribute, publish, upload to an app store, or include in a release.\n"
        "Identity, rights and accountable visual review remain pending (#9, #7, #8, #11). No font files are included.\n"
        "Rendered panels are synthetic QA evidence, never canonical marks or approval evidence.\n", encoding="utf-8")
    if source != source_record(inputs):
        raise AssetError("Source inputs or revision changed during the build; keep the checkout stable and retry")
    manifest = {"schema_version": 1, "status": "local-review-only", "release_eligible": False,
                "approval_reference": None, "provider_mode": "N/A — offline local tooling; no provider calls",
                "source": source, "toolchain": runtime, "vectors": vectors, "rasters": rasters, "qa": qa,
                "visual_review": "pending accountable technical/brand/consumer review; physical print proof not performed",
                "excluded_backgrounds": [{"source": f"logo/{row['file']}", "background": bg,
                    "reason": "Not a documented supported contrast context; use the corresponding mono variant"}
                    for row in recipe["vectors"] for bg in ("cream", "ink") if bg not in row["backgrounds"]],
                "unsupported_formats": recipe["unsupported_formats"],
                "files": [{"path": path.relative_to(output).as_posix(), "sha256": sha256(path)} for path in sorted(output.rglob("*")) if path.is_file()]}
    write_json(output / "manifest.json", manifest)
    return manifest


def file_hashes(folder: Path) -> dict[str, str]:
    if folder.is_symlink():
        raise AssetError("Output directory must not be a symlink")
    result = {}
    for path in sorted(folder.rglob("*")):
        if path.is_symlink():
            raise AssetError("Output must not contain symlinks")
        if path.is_file():
            result[path.relative_to(folder).as_posix()] = sha256(path)
    return result


def run(command: str, destination: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="ticketstub-assets-") as temporary:
        first = Path(temporary) / "first"
        manifest = build(first)
        hashes = file_hashes(first)
        if command == "check":
            second = Path(temporary) / "second"
            build(second)
            if hashes != file_hashes(second):
                raise AssetError("Repeated build file lists or hashes differ")
            print(f"PASS: {len(manifest['vectors'])} canonical SVGs unchanged; {len(manifest['rasters'])} PNG exports; {len(manifest['qa'])} QA cases; two builds match ({len(hashes)} files).")
        else:
            # An existing output is reusable only if every byte is identical. Never
            # overwrite someone's edits, a failed snapshot, or a stale candidate.
            if destination.exists():
                if not destination.is_dir() or hashes != file_hashes(destination):
                    raise AssetError("Output exists and differs; preserve it and choose a fresh --output-dir")
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(first, destination)
            print(f"Built local review artifacts: {destination}")
        print(f"Source revision: {manifest['source']['revision']}; input changes: {len(manifest['source']['input_worktree_changes'])}")
        print(f"Manifest SHA-256: {sha256(first / 'manifest.json')}")
        print("Release/identity/rights/consumer approval: PENDING. No font distribution or provider call.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("build", "check"))
    parser.add_argument("--output-dir", type=Path, default=OUTPUT, help="Local build destination; an existing different candidate is preserved")
    args = parser.parse_args()
    try:
        run(args.command, args.output_dir)
    except (AssetError, OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        print(f"ASSET CHECK FAILED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
