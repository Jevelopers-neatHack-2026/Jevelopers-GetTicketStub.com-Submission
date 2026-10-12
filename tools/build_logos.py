"""Generate the TicketStub logo system as outlined SVGs.

Glyphs are shaped with HarfBuzz (so kerning is real) and converted to paths, so the
SVGs do not depend on any installed font.

    python -m pip install --require-hashes -r tools/assets/requirements.txt
    python tools/build_logos.py

See docs/asset-exports.md for the pinned toolchain and local review-only PNGs.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from importlib.metadata import version
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
FRAUNCES = ROOT / "fonts" / "Fraunces[SOFT,WONK,opsz,wght].ttf"
OUT = ROOT / "logo"

# Brand colours (see tokens/tokens.json)
ORANGE = "#E4572E"
COPPER = "#B4693E"
CYAN = "#7CC6D2"
CREAM = "#F4ECDD"
INK = "#17140F"


def verify_inputs(tokens_path: Path = ROOT / "tokens" / "tokens.json") -> None:
    """Fail before writing if a pinned source or palette literal has drifted.

    The parity check preserves existing SVG bytes. It is not identity approval.
    """
    config = json.loads((ROOT / "tools" / "assets" / "toolchain.json").read_text())
    for package in ("fonttools", "uharfbuzz"):
        expected = config["python_packages"][package]
        if version(package) != expected:
            raise ValueError(f"{package} must be {expected}; use tools/assets/requirements.txt")
    if hashlib.sha256(FRAUNCES.read_bytes()).hexdigest() != config["font"]["sha256"]:
        raise ValueError("Fraunces source hash changed; a reviewed source update is required")
    tokens = json.loads(tokens_path.read_text(encoding="utf-8"))
    for name, literal in {"orange": ORANGE, "copper": COPPER, "cyan": CYAN, "cream": CREAM, "ink": INK}.items():
        if tokens["color"][name]["$value"].upper() != literal:
            raise ValueError(f"Logo palette differs from color.{name}; review before regeneration")


class Face:
    """A static instance of a variable font, plus a HarfBuzz font at the same location."""

    def __init__(self, path: Path, loc: dict[str, float]):
        tt = instantiateVariableFont(TTFont(path), loc)
        buf = io.BytesIO()
        tt.save(buf)
        self.tt = TTFont(io.BytesIO(buf.getvalue()))
        self.glyphs = self.tt.getGlyphSet()
        self.order = self.tt.getGlyphOrder()
        self.upm = self.tt["head"].unitsPerEm
        self.cap = self.tt["OS/2"].sCapHeight
        self.xh = self.tt["OS/2"].sxHeight
        self.hb = hb.Font(hb.Face(buf.getvalue()))

    def shape(self, text: str):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hb, buf, {"kern": True, "liga": True})
        return list(zip(buf.glyph_infos, buf.glyph_positions))

    def width(self, text: str, size: float, tracking: float = 0) -> float:
        s = size / self.upm
        run = self.shape(text)
        return sum(p.x_advance for _, p in run) * s + tracking * size * (len(run) - 1)

    def path(self, text: str, size: float, x: float, baseline: float, tracking: float = 0) -> str:
        """SVG path data for `text`, `size` = em size in user units, baseline at y."""
        s = size / self.upm
        pen = SVGPathPen(self.glyphs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
        cx = x
        for info, pos in self.shape(text):
            name = self.order[info.codepoint]
            t = TransformPen(pen, (s, 0, 0, -s, cx + pos.x_offset * s, baseline - pos.y_offset * s))
            self.glyphs[name].draw(t)
            cx += pos.x_advance * s + tracking * size
        return pen.getCommands()


def stamp_path(x: float, y: float, w: float, h: float, nx: int, ny: int, r: float) -> str:
    """Rectangle with semicircular perforation bites (postage-stamp edge).

    Walks the outline clockwise; every bite uses sweep-flag 0 so it curves inward.
    """
    px, py = w / nx, h / ny
    xs = [x + (i + 0.5) * px for i in range(nx)]
    ys = [y + (i + 0.5) * py for i in range(ny)]
    f = lambda v: f"{v:.2f}".rstrip("0").rstrip(".")
    d = [f"M{f(x)} {f(y)}"]
    for cx in xs:  # top, left -> right
        d.append(f"L{f(cx - r)} {f(y)}A{f(r)} {f(r)} 0 0 0 {f(cx + r)} {f(y)}")
    d.append(f"L{f(x + w)} {f(y)}")
    for cy in ys:  # right, top -> bottom
        d.append(f"L{f(x + w)} {f(cy - r)}A{f(r)} {f(r)} 0 0 0 {f(x + w)} {f(cy + r)}")
    d.append(f"L{f(x + w)} {f(y + h)}")
    for cx in reversed(xs):  # bottom, right -> left
        d.append(f"L{f(cx + r)} {f(y + h)}A{f(r)} {f(r)} 0 0 0 {f(cx - r)} {f(y + h)}")
    d.append(f"L{f(x)} {f(y + h)}")
    for cy in reversed(ys):  # left, bottom -> top
        d.append(f"L{f(x)} {f(cy + r)}A{f(r)} {f(r)} 0 0 0 {f(x)} {f(cy - r)}")
    d.append("Z")
    return "".join(d)


FOIL_DEFS = f"""<defs><linearGradient id="foil" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="{COPPER}"/><stop offset=".45" stop-color="{ORANGE}"/><stop offset="1" stop-color="{CYAN}"/>
</linearGradient></defs>"""


def svg(w: float, h: float, body: str, title: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" '
        f'width="{w:g}" height="{h:g}" role="img" aria-label="{title}">'
        f"<title>{title}</title>{body}</svg>\n"
    )


def build(output_dir: Path = OUT):
    verify_inputs()
    output_dir.mkdir(parents=True, exist_ok=True)
    mark = Face(FRAUNCES, {"opsz": 144, "wght": 600, "SOFT": 0, "WONK": 0})
    bold = Face(FRAUNCES, {"opsz": 144, "wght": 800, "SOFT": 0, "WONK": 0})
    word = Face(FRAUNCES, {"opsz": 144, "wght": 560, "SOFT": 30, "WONK": 0})

    # ---- Symbol: the "Ts" stamp (portrait, 4:5) ----------------------------------
    SW, SH = 80, 100
    stamp = stamp_path(0, 0, SW, SH, 7, 9, 3.5)

    def ts_glyphs(face: Face, box_w: float, box_h: float, cap_ratio: float, ox=0.0, oy=0.0) -> str:
        size = box_h * cap_ratio / (face.cap / face.upm)
        tw = face.width("Ts", size)
        base = oy + box_h / 2 + (face.cap / face.upm * size) / 2
        return face.path("Ts", size, ox + (box_w - tw) / 2, base)

    ts = ts_glyphs(mark, SW, SH, 0.36)

    files = {
        # full colour: foil stamp, ink letters
        "ts-stamp.svg": svg(SW, SH, FOIL_DEFS + f'<path fill="url(#foil)" d="{stamp}"/><path fill="{INK}" d="{ts}"/>',
                            "TicketStub"),
        # single colour: letters knocked out, so it works on any background
        "ts-stamp-mono-orange.svg": svg(SW, SH, f'<path fill="{ORANGE}" fill-rule="evenodd" d="{stamp}{ts}"/>', "TicketStub"),
        "ts-stamp-mono-ink.svg": svg(SW, SH, f'<path fill="{INK}" fill-rule="evenodd" d="{stamp}{ts}"/>', "TicketStub"),
        "ts-stamp-mono-cream.svg": svg(SW, SH, f'<path fill="{CREAM}" fill-rule="evenodd" d="{stamp}{ts}"/>', "TicketStub"),
        "ts-stamp-currentcolor.svg": svg(SW, SH, f'<path fill="currentColor" fill-rule="evenodd" d="{stamp}{ts}"/>', "TicketStub"),
    }

    # ---- Favicon / 24px: square stamp, fewer & bigger bites, heavier letters ------
    fav_stamp = stamp_path(0.5, 0.5, 23, 23, 4, 4, 1.15)
    fav_ts = ts_glyphs(bold, 23, 23, 0.5, 0.5, 0.5)
    files["favicon.svg"] = svg(24, 24, f'<path fill="{ORANGE}" fill-rule="evenodd" d="{fav_stamp}{fav_ts}"/>', "TicketStub")

    # ---- App icon 1024: ink field, foil stamp centred ----------------------------
    A = 1024
    iw, ih = 600, 750
    ix, iy = (A - iw) / 2, (A - ih) / 2
    icon_stamp = stamp_path(ix, iy, iw, ih, 7, 9, 26)
    icon_ts = ts_glyphs(mark, iw, ih, 0.36, ix, iy)
    files["app-icon.svg"] = svg(A, A, FOIL_DEFS + f'<rect width="{A}" height="{A}" fill="{INK}"/>'
                                f'<path fill="url(#foil)" d="{icon_stamp}"/><path fill="{INK}" d="{icon_ts}"/>', "TicketStub")

    # ---- Wordmark: Ticket ┊ Stub  (the tear line is the product's signature move) -
    size = 100
    cap = word.cap / word.upm * size
    w1 = word.width("Ticket", size)
    w2 = word.width("Stub", size)
    gap = 0.30 * size  # room for the perforation
    base = cap + 6
    dots_n, dot_r = 5, 3.1
    perf_x = w1 + gap / 2
    dots = "".join(
        f'<circle cx="{perf_x:.2f}" cy="{base - cap + i * cap / (dots_n - 1):.2f}" r="{dot_r}"/>' for i in range(dots_n)
    )
    t1 = word.path("Ticket", size, 0, base)
    t2 = word.path("Stub", size, w1 + gap, base)
    desc = 0.24 * size
    WW, WH = w1 + gap + w2, base + desc
    for name, color in {"wordmark.svg": INK, "wordmark-cream.svg": CREAM, "wordmark-orange.svg": ORANGE}.items():
        files[name] = svg(WW, WH, f'<g fill="{color}"><path d="{t1}"/>{dots}<path d="{t2}"/></g>', "TicketStub")
    # compact: no perforation, for sizes under ~120px wide
    tc = word.path("TicketStub", size, 0, base)
    WC = word.width("TicketStub", size)
    files["wordmark-compact.svg"] = svg(WC, WH, f'<path fill="{INK}" d="{tc}"/>', "TicketStub")

    # ---- Lockups ------------------------------------------------------------------
    # horizontal: stamp height = 1.9 x cap height, wordmark baseline aligned to stamp centre
    k = (cap * 1.9) / SH
    sw, sh = SW * k, SH * k
    pad = 0.42 * size
    lx = sw + pad
    lbase = sh / 2 + cap / 2
    def placed(path: str, dx: float, dy: float) -> str:
        return f'<path transform="translate({dx:.2f} {dy:.2f})" d="{path}"/>'
    word_g = (f'<g transform="translate({lx:.2f} {lbase - base:.2f})">'
              f'<path d="{t1}"/>{dots}<path d="{t2}"/></g>')
    stamp_g = f'<g transform="scale({k:.4f})">'
    files["lockup-horizontal.svg"] = svg(lx + WW, sh, FOIL_DEFS + stamp_g + f'<path fill="url(#foil)" d="{stamp}"/>'
                                         f'<path fill="{INK}" d="{ts}"/></g><g fill="{INK}">{word_g}</g>', "TicketStub")
    files["lockup-horizontal-mono.svg"] = svg(lx + WW, sh, f'<g fill="currentColor">{stamp_g}<path fill-rule="evenodd" d="{stamp}{ts}"/></g>{word_g}</g>', "TicketStub")
    # stacked
    k2 = (cap * 2.6) / SH
    sw2, sh2 = SW * k2, SH * k2
    gapv = 0.36 * size
    SWW = max(WW, sw2)
    files["lockup-stacked.svg"] = svg(SWW, sh2 + gapv + WH, FOIL_DEFS +
        f'<g transform="translate({(SWW - sw2) / 2:.2f} 0) scale({k2:.4f})"><path fill="url(#foil)" d="{stamp}"/><path fill="{INK}" d="{ts}"/></g>'
        f'<g fill="{INK}" transform="translate({(SWW - WW) / 2:.2f} {sh2 + gapv:.2f})"><path d="{t1}"/>{dots}<path d="{t2}"/></g>', "TicketStub")

    for name, body in files.items():
        (output_dir / name).write_text(body, encoding="utf-8")
        print(f"{name}  {len(body) / 1024:.1f} KB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=OUT)
    build(parser.parse_args().output_dir)
