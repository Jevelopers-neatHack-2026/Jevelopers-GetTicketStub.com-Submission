"""Validate tokens/tokens.json and generate the CSS and Tailwind adapters.

    python3 -I tools/build_tokens.py validate|build|check [--root DIR]

validate  schema, type, unit, alias and mapping checks only
build     validate, then write the generated files under <root>/tokens (nothing is written if invalid)
check     validate, rebuild twice into temp dirs (same file set and bytes), compare with the committed
          files, check for stray files, enforce the output policy and CSS/JSON parity; never writes

Exit 0 only when every check passes, 1 otherwise. Offline, standard library only (Python 3.9+).
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import token_lib as T  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_IN_TOKENS_DIR = set(T.INPUTS) | set(T.OUTPUTS)


def load(root: Path):
    try:
        m = T.load_model(root)
    except T.TokenError as exc:
        return None, [str(exc)]
    return m, list(m.errors)


def write_outputs(m: T.Model, outdir: Path) -> dict:
    files = T.render_all(m)
    for rel, text in files.items():
        dest = outdir / Path(rel).name
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
    return files


def digest(files: dict) -> dict:
    return {rel: hashlib.sha256(t.encode("utf-8")).hexdigest() for rel, t in sorted(files.items())}


def policy_problems(files: dict) -> list:
    errs = []
    css, tw, fonts = files[T.OUT_CSS], files[T.OUT_TAILWIND], files[T.OUT_FONTS]
    for rel, text in files.items():
        if "GENERATED FILE - DO NOT EDIT" not in text[:400]:
            errs.append(f"{rel}: generated-file header missing")
    if re.search(r"^\s*@import|@font-face|url\(", re.sub(r"/\*.*?\*/", "", css, flags=re.S), re.M):
        errs.append("tokens/tokens.css must not load fonts or any URL (@import/@font-face/url() found)")
    if re.search(r"@font-face", fonts) or len(re.findall(r"^@import ", fonts, re.M)) != 1:
        errs.append("tokens/external-fonts-google.css must contain exactly one @import and no @font-face")
    body = re.sub(r"/\*.*?\*/", "", tw, flags=re.S)
    hard = re.findall(r"\b\d+(?:\.\d+)?m?s\b", body)
    if hard:
        errs.append(f"tokens/tailwind.preset.js hardcodes durations {hard}; they must be var(--ts-dur-*)")
    return errs


def diff_problem(rel: str, want: str, have: str) -> str:
    diff = list(difflib.unified_diff(have.splitlines(), want.splitlines(), f"{rel} (committed)", f"{rel} (generated)", lineterm="", n=0))
    return f"drift: {rel} differs from generated output (hand-edited or stale; run `make build-tokens`):\n    " + "\n    ".join(diff[:12])


def check(root: Path) -> list:
    m, errors = load(root)
    if errors:
        return errors
    with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
        fa, fb = write_outputs(m, Path(a)), write_outputs(m, Path(b))
        disk_a = {p.name: p.read_bytes() for p in sorted(Path(a).iterdir())}
        disk_b = {p.name: p.read_bytes() for p in sorted(Path(b).iterdir())}
        if disk_a != disk_b or digest(fa) != digest(fb):
            errors.append("non-deterministic: two builds of the same inputs differ")
    files = T.render_all(m)
    errors += policy_problems(files)
    committed = {rel: (root / rel).read_bytes().decode("utf-8", "replace").replace("\r\n", "\n")
                 for rel in files if (root / rel).is_file()}
    if len(committed) == len(files):
        errors += [e for e in policy_problems(committed) if e not in errors]
    errors += T.parity_problems(m, files[T.OUT_CSS])
    for rel, want in files.items():
        p = root / rel
        if not p.is_file():
            errors.append(f"missing generated file {rel}; run `make build-tokens`")
            continue
        have = p.read_bytes().decode("utf-8", "replace").replace("\r\n", "\n")
        if have != want:
            errors.append(diff_problem(rel, want, have))
    tdir = root / "tokens"
    for p in sorted(tdir.iterdir()):
        rel = f"tokens/{p.name}"
        if rel not in ALLOWED_IN_TOKENS_DIR:
            errors.append(f"unexpected file {rel}: not a token input or a generated output")
    return errors


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["validate", "build", "check"])
    ap.add_argument("--root", type=Path, default=ROOT)
    ap.add_argument("--print-hashes", action="store_true", help="with build/check: print sha256 of every generated file")
    args = ap.parse_args(argv)
    root = args.root.resolve()
    if args.command == "check":
        errors = check(root)
    else:
        m, errors = load(root)
        if not errors and args.command == "build":
            files = write_outputs(m, root / "tokens")
    if errors:
        for e in errors:
            print(f"FAIL {e}")
        print(f"{args.command}-tokens: {len(errors)} problem(s)")
        return 1
    m, _ = load(root)
    if args.command == "validate":
        print(f"validate-tokens: OK ({len(m.leaves)} tokens, profile {m.profile['profile']} {m.profile['version']})")
    elif args.command == "build":
        print(f"build-tokens: wrote {len(T.OUTPUTS)} files under tokens/ from {len(m.leaves)} tokens")
        if args.print_hashes:
            for rel, h in digest(files).items():
                print(f"  {h}  {rel}")
    else:
        print(f"check-tokens: OK ({len(m.leaves)} tokens; 2 builds identical; outputs match committed files; CSS/JSON parity in 5 contexts)")
        if args.print_hashes:
            for rel, h in digest(T.render_all(m)).items():
                print(f"  {h}  {rel}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
