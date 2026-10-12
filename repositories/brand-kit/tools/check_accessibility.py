"""BK-08 token-driven contrast evidence. Offline, standard library, no approvals.

build writes deterministic reports; check verifies reports and required sample pairs.
pair checks one token pair and exits nonzero when the unrounded threshold is not met.
Browser and accountable accessibility review are separate required evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from token_lib import HEX_RE, RGB_RE, TokenError, input_hashes, load_model, undefined_var_problems

ROOT = Path(__file__).resolve().parents[1]
REPORT_JSON = "docs/accessibility/contrast-report.json"
REPORT_MD = "docs/accessibility/contrast-report.md"
THRESHOLDS = {"normal-text": 4.5, "large-text": 3.0, "ui": 3.0}
REFERENCES = {
    "text": "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",
    "ui": "https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html",
    "resize": "https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html",
    "motion": "https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html",
}


def parse_color(value: str) -> tuple[float, float, float, float]:
    """Parse the existing token profile's sRGB forms without quantizing alpha."""
    if not isinstance(value, str):
        raise TokenError("contrast needs a color string")
    if HEX_RE.fullmatch(value):
        h = value[1:]
        if len(h) in (3, 4):
            h = "".join(c * 2 for c in h)
        if len(h) == 6:
            h += "ff"
        return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4, 6))
    match = RGB_RE.fullmatch(value)
    if match:
        r, g, b, a = match.groups()
        channels = tuple(int(c) / 255 for c in (r, g, b))
        alpha = float(a) if a is not None else 1.0
        if all(0 <= c <= 1 for c in channels) and 0 <= alpha <= 1:
            return (*channels, alpha)
    raise TokenError("contrast needs a supported sRGB color, not a gradient or unknown canvas")


def composite(foreground, background):
    """Source-over composition in encoded sRGB, before luminance linearization."""
    if background[3] != 1.0:
        raise TokenError("the final canvas must be opaque")
    alpha = foreground[3]
    return tuple(alpha * f + (1 - alpha) * b for f, b in zip(foreground[:3], background[:3])) + (1.0,)


def luminance(color):
    if color[3] != 1.0:
        raise TokenError("composite translucent colors over an opaque canvas first")
    channels = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in color[:3]]
    return sum(weight * c for weight, c in zip((0.2126, 0.7152, 0.0722), channels))


def contrast(foreground, background):
    light, dark = sorted((luminance(foreground), luminance(background)), reverse=True)
    return (light + 0.05) / (dark + 0.05)


def meets(ratio, usage):
    return ratio >= THRESHOLDS[usage]


def color_token(model, path):
    leaf = model.final(path)
    if leaf is None or leaf.type != "color":
        raise TokenError("contrast path must identify a color token")
    return parse_color(leaf.value)


def pair(model, foreground, background, canvas=None):
    fg, bg = color_token(model, foreground), color_token(model, background)
    if bg[3] != 1.0:
        if canvas is None:
            raise TokenError("translucent background requires --canvas")
        bg = composite(bg, color_token(model, canvas))
    fg = composite(fg, bg)
    ratio = contrast(fg, bg)
    return {
        "foreground": foreground, "background": background, "canvas": canvas,
        "foreground_srgb_0_to_255": [v * 255 for v in fg[:3]],
        "background_srgb_0_to_255": [v * 255 for v in bg[:3]],
        "ratio": ratio, "display_ratio": f"{ratio:.2f}:1",
        "normal_text": meets(ratio, "normal-text"),
        "large_text": meets(ratio, "large-text"), "ui_contrast": meets(ratio, "ui"),
    }


def make_report(root):
    model = load_model(root)
    if model.errors:
        raise TokenError("invalid token model: " + "; ".join(model.errors))
    palette = [p for p in model.leaves if p.startswith("color.")]
    rows = [pair(model, f, b) for f, b in itertools.product(palette, repeat=2)]
    semantic = []

    def add(theme, name, fg, bg, usage=None, restriction=""):
        prefix = "semantic." + theme + "."
        row = pair(model, prefix + fg, prefix + bg, prefix + "bg")
        row.update(id=theme + "." + name, required_use=usage, restriction=restriction)
        semantic.append(row)

    for theme in ("day", "night"):
        for surface in ("bg", "surface"):
            add(theme, "body." + surface, "text", surface, "normal-text")
            add(theme, "muted." + surface, "text-muted", surface, "normal-text")
            add(theme, "focus." + surface, "focus", surface, "ui")
            add(theme, "control-border." + surface, "text", surface, "ui")
            add(theme, "cta-fill." + surface, "cta-bg", surface, restriction="Use the text-color border when the fill alone is below 3:1.")
        add(theme, "cta-label", "cta-label", "cta-bg", "normal-text")
        add(theme, "focus.direct-cta", "focus", "cta-bg", restriction="The fixture separates the focus outline from the CTA with a background-colored gap; direct cyan/orange adjacency is prohibited.")
        add(theme, "surface-boundary", "surface", "bg", restriction="Tint/moss alone is not a meaningful control boundary. Use text-color borders or another measured cue.")
    return {
        "schema": "ticketstub-local-contrast-report@1",
        "status": "computed source evidence; identity and accessibility approval pending",
        "mode": "offline computation; no browser, provider or consumer acceptance",
        "method": "WCAG 2.2 sRGB, breakpoint 0.04045; source-over alpha in encoded sRGB; no rounding before comparison",
        "thresholds": THRESHOLDS,
        "large_text_definition": "At least 24 CSS px (18pt), or 14pt bold (56/3 CSS px). Delivered size, not user zoom; 600 weight is not automatically treated as bold.",
        "inputs_sha256": input_hashes(root),
        "generator_sha256": hashlib.sha256((root / "tools/check_accessibility.py").read_bytes()).hexdigest(),
        "references": REFERENCES, "palette": rows, "semantic": semantic,
        "limits": [
            "No whole-product WCAG certification or owner approval.",
            "Gradients and images need worst-location evaluation or an opaque measured plate.",
            "Logotypes and decoration have narrow exceptions; functional labels and focus indicators do not inherit those exceptions.",
            "The browser fixture, external-font availability and named accessibility review remain separate evidence.",
        ],
    }


def report_markdown(report):
    lines = [
        "<!-- GENERATED by tools/check_accessibility.py build; do not edit. -->",
        "# Contrast evidence from the current tokens", "", report["status"] + ".", "",
        report["method"] + ".", "",
        "Thresholds: normal text 4.5:1; large text and meaningful UI contrast 3:1. " + report["large_text_definition"], "",
        "The JSON report retains computed ratios and composited channels. Display values are rounded to two decimals only; a displayed 4.50 does not establish a pass.", "",
        "## Palette matrix", "",
        "Allowed here means the numerical threshold is met; it is not a brand or distribution approval.", "",
        "| Foreground | Background | Ratio | Normal text | Large text | UI contrast |",
        "|---|---|---:|---|---|---|",
    ]
    def allowed(value):
        return "meets" if value else "prohibited"
    for row in report["palette"]:
        lines.append(f"| `{row['foreground']}` | `{row['background']}` | {row['display_ratio']} | {allowed(row['normal_text'])} | {allowed(row['large_text'])} | {allowed(row['ui_contrast'])} |")
    lines += ["", "## Actual semantic surfaces", "",
              "Surface alpha is first composited over that theme's background. Muted text is then composited over the resulting surface, without rounding intermediate channels.", "",
              "| Pair | Ratio | Normal text | UI contrast | Required use / restriction |", "|---|---:|---|---|---|"]
    for row in report["semantic"]:
        lines.append(f"| `{row['id']}` | {row['display_ratio']} | {allowed(row['normal_text'])} | {allowed(row['ui_contrast'])} | {row['required_use'] or row['restriction']} |")
    lines += ["", "## Sources and limitations", ""]
    lines += [f"- [{name}]({url})" for name, url in report["references"].items()]
    lines += ["- " + limit for limit in report["limits"]]
    lines += ["", "Input hashes and generator identity are in [contrast-report.json](contrast-report.json). "
              "Run instructions, theme/focus restrictions and the browser checklist are in [accessibility guidance](../accessibility.md).", ""]
    return "\n".join(lines)


def outputs(report):
    return {REPORT_JSON: json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n", REPORT_MD: report_markdown(report)}


def check_report(root, report):
    problems = []
    for row in report["semantic"]:
        if row["required_use"] and not meets(row["ratio"], row["required_use"]):
            problems.append(f"{row['id']} fails required {row['required_use']} contrast")
    for path, expected in outputs(report).items():
        if not (root / path).is_file() or (root / path).read_bytes() != expected.encode("utf-8"):
            problems.append(f"generated report missing or stale: {path}; run build-accessibility")
    for path in ("tools/accessibility-fixture/index.html", "tools/accessibility-fixture/fixture.css", "tools/accessibility-fixture/fixture.js", "tools/check_accessibility_browser.cjs"):
        if not (root / path).is_file():
            problems.append(f"missing local fixture input: {path}")
    css_path = root / "tools/accessibility-fixture/fixture.css"
    if css_path.is_file():
        model = load_model(root)
        problems += undefined_var_problems(model, "", css_path.read_text(encoding="utf-8"), "accessibility fixture")
    return problems


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("build", "check", "pair"), nargs="?", default="check")
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--foreground")
    parser.add_argument("--background")
    parser.add_argument("--canvas")
    parser.add_argument("--use", choices=tuple(THRESHOLDS), default="normal-text")
    args = parser.parse_args(argv)
    try:
        root = args.root.resolve()
        report = make_report(root)
        if args.command == "pair":
            model = load_model(root)
            row = pair(model, args.foreground, args.background, args.canvas)
            passed = meets(row["ratio"], args.use)
            print(json.dumps({**row, "use": args.use, "passed": passed}, allow_nan=False))
            return 0 if passed else 1
        if args.command == "build":
            for path, content in outputs(report).items():
                dest = root / path
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(content, encoding="utf-8")
            print("contrast reports built; no approval or browser result implied")
            return 0
        problems = check_report(root, report)
        for problem in problems:
            print("FAIL " + problem)
        if problems:
            return 1
        print(f"contrast: OK ({len(report['palette'])} palette pairs, {len(report['semantic'])} semantic pairs; unrounded thresholds). Browser/approval evidence separate.")
        return 0
    except (TokenError, OSError, ValueError, TypeError, KeyError) as exc:
        print(f"contrast: FAIL ({type(exc).__name__}); missing or invalid source/report input", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
