"""Run a real Tailwind build against the generated preset and check it against the token source.

    python3 -I tools/check_tokens_tailwind.py [--root DIR]

Needs the pinned dev dependency installed: `make check-tokens-tailwind` runs `npm ci` first.
Checks: Tailwind and Node versions match the pin; every Tailwind-mapped token has its utility in the
built CSS with the expected declaration; no hardcoded duration; the plain-CSS fixture and the built CSS
only use variables tokens.css defines; the preset still contains every key and value of the pre-BK-03A
preset (durations now resolve through the variables to the same values). This does not drive a browser.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import token_lib as T  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DEV = "tools/tokens-dev"
FIXTURES = "tools/tests/fixtures"

UTILITY = {  # section -> (class prefix, css property)
    "colors": ("bg", "background-color"), "backgroundImage": ("bg", "background-image"),
    "fontFamily": ("font", "font-family"), "fontSize": ("text", "font-size"),
    "borderRadius": ("rounded", "border-radius"), "boxShadow": ("shadow", "--tw-shadow"),
    "transitionTimingFunction": ("ease", "transition-timing-function"),
    "transitionDuration": ("duration", "transition-duration"),
}


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def rules_of(css: str) -> dict:
    out = {}
    for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", re.sub(r"/\*.*?\*/", "", css, flags=re.S)):
        decls = {}
        for d in body.split(";"):
            if ":" in d:
                k, _, v = d.partition(":")
                decls[k.strip()] = " ".join(v.split())
        out[sel.strip()] = decls
    return out


def check(root: Path):
    problems, info = [], []
    dev = root / DEV
    pkg = json.loads((dev / "package.json").read_text())
    pin = pkg["devDependencies"]["tailwindcss"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", pin):
        problems.append(f"tailwindcss must be pinned to an exact version, found {pin!r}")
    bin_ = dev / "node_modules/.bin/tailwindcss"
    if not bin_.exists():
        return [f"missing {DEV}/node_modules: run `make check-tokens-tailwind` (npm ci) first"], info
    installed = json.loads((dev / "node_modules/tailwindcss/package.json").read_text())["version"]
    if installed != pin:
        problems.append(f"installed tailwindcss {installed} != pinned {pin}")
    node = run(["node", "--version"], dev).stdout.strip()
    info.append(f"tailwindcss {installed} (pin {pin}), node {node}")

    m = T.load_model(root)
    problems += m.errors
    files = T.render_all(m)
    css_text = (root / T.OUT_CSS).read_text()
    if css_text != files[T.OUT_CSS] or (root / T.OUT_TAILWIND).read_text() != files[T.OUT_TAILWIND]:
        problems.append("generated files are stale; run `make build-tokens` before the Tailwind check")

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "tailwind-out.css"
        r = run([str(bin_), "-c", "tailwind.config.js", "-i", "input.css", "-o", str(out)], dev)
        if r.returncode != 0:
            return problems + [f"tailwind build failed: {r.stderr.strip()[:400]}"], info
        built = out.read_text()
    rules = rules_of(built)
    html = (dev / "fixture.html").read_text()
    sections = m.profile["tailwind"]["sections"]
    checked = 0
    for p, e in m.mapping["tokens"].items():
        if "tailwind" not in e:
            continue
        sec, _, key = e["tailwind"].partition(".")
        prefix, prop = UTILITY[sec]
        cls = f"{prefix}-{key}"
        if not re.search(r"(?<![\w-])" + re.escape(cls) + r"(?![\w-])", html):
            problems.append(f"fixture.html does not use .{cls} for {p}")
            continue
        sel = "." + re.sub(r"([^\w-])", r"\\\1", cls)
        decls = rules.get(sel)
        if decls is None:
            problems.append(f"{p}: Tailwind built no rule for {sel}")
            continue
        if sections[sec]["form"] == "family-list":
            want = ", ".join(T.family_list(T.final_family(m, p)))
        else:
            want = f"var({e['css']})"
        if decls.get(prop) != want:
            problems.append(f"{p}: {sel} {{ {prop} }} is {decls.get(prop)!r}, expected {want!r}")
        checked += 1
    info.append(f"{checked} Tailwind-mapped tokens produced the expected utility declarations")
    if re.search(r"transition-duration:\s*[\d.]+m?s", built):
        problems.append("built Tailwind CSS contains a hardcoded transition-duration")
    problems += T.undefined_var_problems(m, css_text, built, "tailwind build")
    consumer = (root / FIXTURES / "consumer.css").read_text()
    problems += T.undefined_var_problems(m, css_text, consumer, "plain-CSS fixture")
    problems += T.parity_problems(m, css_text)

    # compatibility with the pre-BK-03A preset
    script = ("const o=require(process.argv[1]),n=require(process.argv[2]);"
              "console.log(JSON.stringify([o.theme.extend,n.theme.extend]))")
    r = run(["node", "-e", script, str(root / FIXTURES / "baseline/tailwind.preset.js"), str(root / T.OUT_TAILWIND)], dev)
    if r.returncode != 0:
        problems.append(f"node could not load a preset: {r.stderr.strip()[:300]}")
    else:
        old, new = json.loads(r.stdout)
        env = T.css_context(m, css_text, "day")
        added = []
        for sec, items in old.items():
            for k, ov in items.items():
                nv = new.get(sec, {}).get(k)
                if nv is None:
                    problems.append(f"preset lost {sec}.{k}")
                elif nv != ov:
                    if sec == "transitionDuration" and re.fullmatch(r"var\((--[a-z-]+)\)", nv) and T.resolve_var(env, nv[4:-1]) == ov:
                        continue
                    problems.append(f"preset {sec}.{k} changed from {ov!r} to {nv!r}")
        for sec, items in new.items():
            added += [f"{sec}.{k}" for k in items if k not in old.get(sec, {})]
        info.append("additions over the pre-BK-03A preset: " + ", ".join(added))
        if sorted(added) != sorted(["borderRadius.pill", "transitionDuration.shutter", "transitionDuration.print-sweep"]):
            problems.append(f"unexpected preset additions: {added}")
    return problems, info


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", type=Path, default=ROOT)
    args = ap.parse_args(argv)
    problems, info = check(args.root.resolve())
    for line in info:
        print("INFO", line)
    for pr in problems:
        print("FAIL", pr)
    if problems:
        print(f"check-tokens-tailwind: {len(problems)} problem(s)")
        return 1
    print("check-tokens-tailwind: OK (real Tailwind build; no browser rendering was performed)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
