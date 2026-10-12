"""Generate the org-profile SVGs (banner, flow strip, palette, divider) with outlined brand type.

Reuses Face/stamp_path from brand-kit/tools/build_logos.py so the type matches the logo system.
    python profile/build_assets.py ../brand-kit profile/assets   (needs fonttools, uharfbuzz)
"""
from __future__ import annotations

import sys
from pathlib import Path

KIT = Path(sys.argv[1]).resolve()
OUT = Path(sys.argv[2]).resolve()
sys.path.insert(0, str(KIT / "tools"))
import build_logos as bl  # noqa: E402

ORANGE, COPPER, CYAN, CREAM, INK, MOSS = bl.ORANGE, bl.COPPER, bl.CYAN, bl.CREAM, bl.INK, "#26302A"
FRAUNCES = KIT / "fonts" / "Fraunces[SOFT,WONK,opsz,wght].ttf"
INTER = KIT / "fonts" / "InterTight[wght].ttf"

mark = bl.Face(FRAUNCES, {"opsz": 144, "wght": 600, "SOFT": 0, "WONK": 0})
word = bl.Face(FRAUNCES, {"opsz": 144, "wght": 560, "SOFT": 30, "WONK": 0})
head = bl.Face(FRAUNCES, {"opsz": 72, "wght": 560, "SOFT": 30, "WONK": 0})
ui = bl.Face(INTER, {"wght": 400})
label = bl.Face(INTER, {"wght": 500})
bold = bl.Face(INTER, {"wght": 600})

SW, SH = 80, 100
STAMP = bl.stamp_path(0, 0, SW, SH, 7, 9, 3.5)
TS = None


def ts_letters() -> str:
    size = SH * 0.36 / (mark.cap / mark.upm)
    tw = mark.width("Ts", size)
    base = SH / 2 + (mark.cap / mark.upm * size) / 2
    return mark.path("Ts", size, (SW - tw) / 2, base)


TS = ts_letters()
FOIL = bl.FOIL_DEFS


def stamp(x: float, y: float, h: float) -> str:
    k = h / SH
    return (f'<g transform="translate({x:.2f} {y:.2f}) scale({k:.4f})">'
            f'<path fill="url(#foil)" d="{STAMP}"/><path fill="{INK}" d="{TS}"/></g>')


def text(face, s, size, x, base, fill, tracking=0.0, anchor="start", opacity=1.0):
    w = face.width(s, size, tracking)
    if anchor == "middle":
        x -= w / 2
    elif anchor == "end":
        x -= w
    op = f' fill-opacity="{opacity}"' if opacity < 1 else ""
    return f'<path fill="{fill}"{op} d="{face.path(s, size, x, base, tracking)}"/>', w


def wordmark(x, base, cap_px, fill):
    size = cap_px / (word.cap / word.upm)
    w1 = word.width("Ticket", size)
    gap = 0.30 * size
    cap = word.cap / word.upm * size
    dots = "".join(
        f'<circle cx="{x + w1 + gap / 2:.2f}" cy="{base - cap + i * cap / 4:.2f}" r="{3.1 * size / 100:.2f}"/>'
        for i in range(5))
    return (f'<g fill="{fill}"><path d="{word.path("Ticket", size, x, base)}"/>{dots}'
            f'<path d="{word.path("Stub", size, x + w1 + gap, base)}"/></g>')


def svg(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" width="{w:g}" height="{h:g}" '
            f'role="img" aria-label="{title}"><title>{title}</title>{body}</svg>\n')


def ticket_outline(x, y, w, h, perf_x, notch_r, radius):
    """Rounded ticket with semicircular notches top and bottom at the perforation."""
    r = radius
    return (f"M{x + r} {y}H{perf_x - notch_r}A{notch_r} {notch_r} 0 0 0 {perf_x + notch_r} {y}H{x + w - r}"
            f"A{r} {r} 0 0 1 {x + w} {y + r}V{y + h - r}A{r} {r} 0 0 1 {x + w - r} {y + h}"
            f"H{perf_x + notch_r}A{notch_r} {notch_r} 0 0 0 {perf_x - notch_r} {y + h}H{x + r}"
            f"A{r} {r} 0 0 1 {x} {y + h - r}V{y + r}A{r} {r} 0 0 1 {x + r} {y}Z")


def banner(theme: str) -> str:
    W, H = 1280, 420
    day = theme == "day"
    paper = CREAM if day else INK
    fg = INK if day else CREAM
    edge = "rgba(23,20,15,.10)" if day else "rgba(244,236,221,.14)"
    perf_x, nr = 930, 20
    tx, ty, tw, th = 10, 18, W - 20, H - 36
    body = [FOIL, '<defs><filter id="sh" x="-5%" y="-5%" width="110%" height="125%">'
            '<feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#17140F" flood-opacity="'
            f'{".28" if day else ".55"}"/></filter></defs>',
            f'<path filter="url(#sh)" fill="{paper}" stroke="{edge}" stroke-width="1.5" '
            f'd="{ticket_outline(tx, ty, tw, th, perf_x, nr, 14)}"/>']
    # perforation
    holes = 15
    for i in range(holes):
        cy = ty + nr + 10 + i * (th - 2 * nr - 20) / (holes - 1)
        body.append(f'<circle cx="{perf_x}" cy="{cy:.1f}" r="3.2" fill="{fg}" fill-opacity=".28"/>')
    x0 = 76
    p, _ = text(label, "JEVELOPERS  ·  NEATHACK 2026", 15, x0, 86, fg, tracking=0.16, opacity=.66)
    body.append(p)
    body.append(wordmark(x0 - 4, 196, 78, fg))
    p, _ = text(head, "Keep the night.", 44, x0, 272, ORANGE)
    body.append(p)
    p, _ = text(ui, "The keepsake studio that turns any ticket into a stub worth framing.", 22, x0, 318, fg,
                opacity=.72)
    body.append(p)
    # data row, like a ticket's fine print
    cx = x0
    for i, s in enumerate(["ADMIT ONE", "NO FORMS", "DROP YOUR TICKET → IT’S DONE"]):
        if i:
            body.append(f'<circle cx="{cx + 12:.1f}" cy="{363:.1f}" r="2.4" fill="{ORANGE}"/>')
            cx += 26
        pth, w = text(label, s, 13, cx, 368, fg, tracking=0.14, opacity=.55)
        body.append(pth)
        cx += w + 2
    # stub side
    sx = (perf_x + tx + tw) / 2
    sh_ = 196
    body.append(stamp(sx - sh_ * SW / SH / 2, 92, sh_))
    p, _ = text(label, "NO. 2026", 14, sx, 344, fg, tracking=0.2, anchor="middle", opacity=.55)
    body.append(p)
    return svg(W, H, "".join(body), "TicketStub by Jevelopers: keep the night")


def flow(theme: str) -> str:
    steps = [("01", "Paste the link", "or drop a ticket"),
             ("02", "Watch it print", "facts dug up live"),
             ("03", "Swipe styles", "five editions"),
             ("04", "Tilt the foil", "gyro or hover"),
             ("05", "Tear to finish", "past 60%, it rips"),
             ("06", "Pin to the wall", "share, print, wallet")]
    day = theme == "day"
    fg = INK if day else CREAM
    card = "#FFFDF8" if day else MOSS
    W, H = 1280, 196
    cw, gap = 188, 30
    x = (W - (len(steps) * cw + (len(steps) - 1) * gap)) / 2
    body = []
    for i, (n, t, sub) in enumerate(steps):
        body.append(f'<rect x="{x:.1f}" y="18" width="{cw}" height="160" rx="12" fill="{card}" '
                    f'stroke="{"rgba(23,20,15,.12)" if day else "rgba(244,236,221,.12)"}"/>')
        p, _ = text(head, n, 40, x + 20, 76, ORANGE if i not in (3,) else COPPER)
        body.append(p)
        p, _ = text(bold, t, 19, x + 20, 122, fg)
        body.append(p)
        p, _ = text(ui, sub, 15, x + 20, 150, fg, opacity=.66)
        body.append(p)
        if i < len(steps) - 1:
            ax = x + cw + gap / 2
            body.append(f'<path d="M{ax - 7:.1f} 92l9 6-9 6" fill="none" stroke="{ORANGE}" stroke-width="2.4" '
                        f'stroke-linecap="round" stroke-linejoin="round"/>')
        x += cw + gap
    return svg(W, H, "".join(body), "Studio flow: paste, print, swipe, tilt, tear, pin")


def palette() -> str:
    sw = [("Ticket Orange", ORANGE, INK), ("Copper", COPPER, INK), ("Stage Moss", MOSS, CREAM),
          ("Holo Cyan", CYAN, INK), ("Stub Cream", CREAM, INK), ("Night Ink", INK, CREAM)]
    W, H = 1280, 150
    w = (W - 5 * 12) / 6
    body = [FOIL]
    for i, (name, hexv, on) in enumerate(sw):
        x = i * (w + 12)
        body.append(f'<rect x="{x:.1f}" y="0" width="{w:.1f}" height="{H}" rx="12" fill="{hexv}" '
                    f'stroke="rgba(23,20,15,.15)"/>')
        p, _ = text(bold, name, 19, x + 18, H - 46, on)
        body.append(p)
        p, _ = text(label, hexv, 15, x + 18, H - 22, on, tracking=0.08, opacity=.75)
        body.append(p)
    return svg(W, H, "".join(body), "TicketStub palette: orange, copper, moss, cyan, cream, ink")


def foil_bar() -> str:
    W, H = 1280, 14
    return svg(W, H, FOIL.replace('x2="1" y2="1"', 'x2="1" y2="0"') +
               f'<rect width="{W}" height="{H}" rx="7" fill="url(#foil)"/>', "Brand foil: copper to orange to cyan")


def divider() -> str:
    W, H = 1280, 24
    n = 64
    dots = "".join(f'<circle cx="{10 + i * (W - 20) / (n - 1):.1f}" cy="12" r="3" fill="{COPPER}" fill-opacity=".6"/>'
                   for i in range(n))
    return svg(W, H, dots, "Perforation")


OUT.mkdir(parents=True, exist_ok=True)
files = {
    "banner-day.svg": banner("day"), "banner-night.svg": banner("night"),
    "flow-day.svg": flow("day"), "flow-night.svg": flow("night"),
    "palette.svg": palette(), "foil.svg": foil_bar(), "perforation.svg": divider(),
}
for name, body in files.items():
    (OUT / name).write_text(body, encoding="utf-8", newline="\n")
    print(f"{name}  {len(body) / 1024:.1f} KB")
