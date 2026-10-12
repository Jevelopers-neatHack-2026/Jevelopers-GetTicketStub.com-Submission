"""Check local links in Markdown and HTML files.

Default mode is offline and deterministic: local file and Markdown-anchor targets are
resolved against the checkout; http(s) links are only listed as UNCHECKED, never
reported as verified. `--external` additionally sends one HEAD/GET request per external
URL (network, non-deterministic; reachability only, not that the content is correct).
Reference-style definitions and uses are checked too. Only tracked files are scanned
unless `--include-untracked`. Exit 0 only when required inputs exist and no local link is broken (and, with --external, none failed).

    python3 tools/check_links.py [--root DIR] [--external]
"""
from __future__ import annotations

import argparse
import re
import sys
import urllib.request
from pathlib import Path
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from inventory_lib import ROOT, list_files  # noqa: E402

MD_LINK = re.compile(r"!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
REF_DEF = re.compile(r"^(?: {0,3}>)* {0,3}\[([^\]]+)\]:[ \t]*(<[^>\n]*>|\S*)", re.M)
REF_USE = re.compile(r"!?\[((?:[^\[\]\\]|\\.)*)\]\[([^\]]*)\]")
HTML_ATTR = re.compile(r"""\b(?:src|href|srcset)\s*=\s*["']([^"']+)["']""", re.I)
CSS_URL = re.compile(r"""url\(\s*["']?([^"')]+)["']?\s*\)""", re.I)
FENCE = re.compile(r"^(```|~~~).*?^\1", re.S | re.M)
INLINE_CODE = re.compile(r"`[^`\n]*`")
HEADING = re.compile(r"^#{1,6}\s+(.*?)\s*#*\s*$", re.M)


def slug(heading: str) -> str:
    h = re.sub(r"<[^>]+>|[`*_]", "", heading).strip().lower()
    h = re.sub(r"[^\w\- ]", "", h)
    return h.replace(" ", "-")


def anchors(path: Path) -> set[str]:
    text = FENCE.sub("", path.read_text(encoding="utf-8"))
    seen: dict[str, int] = {}
    out = set()
    for m in HEADING.finditer(text):
        s = slug(m.group(1))
        n = seen.get(s, 0)
        seen[s] = n + 1
        out.add(s if n == 0 else f"{s}-{n}")
    return out


def norm_label(label: str) -> str:
    return re.sub(r"\s+", " ", label.strip()).lower()


def extract(path: Path) -> tuple[list[str], list[str]]:
    """Return (link targets, problems found while parsing, e.g. undefined or empty reference definitions)."""
    text = path.read_text(encoding="utf-8")
    problems: list[str] = []
    if path.suffix == ".md":
        text = INLINE_CODE.sub("", FENCE.sub("", text))
        links = MD_LINK.findall(text) + HTML_ATTR.findall(text)
        defs: dict[str, str] = {}
        for m in REF_DEF.finditer(text):
            label, target = norm_label(m.group(1)), m.group(2)
            if label.startswith("^"):
                continue
            target = target[1:-1].strip() if target.startswith("<") else target
            if not target:
                problems.append(f"reference definition '[{m.group(1)}]' has an empty target")
                continue
            defs.setdefault(label, target)
            links.append(target)
        body = REF_DEF.sub("", text)
        for m in REF_USE.finditer(body):
            label = norm_label(m.group(2) or m.group(1))
            if not label.startswith("^") and label not in defs:
                problems.append(f"reference '[{m.group(2) or m.group(1)}]' has no definition")
        # Shortcut uses `[label]` / `![label]` need no separate pass: every definition target is checked
        # above whether or not it is used, so a shortcut to a broken destination, anchor or external URL is
        # covered, and an unmatched `[text]` is ordinary text, never an error.
    else:
        links = HTML_ATTR.findall(text) + CSS_URL.findall(text)
    return [u for part in links for u in (part.split(",") if "," in part and " " in part.strip() else [part])], problems


REQUIRED_INPUTS = ("README.md", "docs/source-of-truth.md")


def check(root: Path, include_untracked: bool = False) -> tuple[list[str], set[str], int]:
    errors: list[str] = []
    external: set[str] = set()
    local_ok = 0
    scanned = 0
    for req in REQUIRED_INPUTS:
        if not (root / req).is_file():
            errors.append(f"missing required input: {req}")
    for rel in list_files(root, include_untracked):
        if not rel.endswith((".md", ".html")):
            continue
        src = root / rel
        if not src.is_file():
            continue  # tracked but deleted: check-inventory reports it
        scanned += 1
        urls, problems = extract(src)
        errors.extend(f"{rel}: {p}" for p in problems)
        for raw in urls:
            url = raw.strip().split(" ")[0]
            if not url or url.startswith(("mailto:", "data:", "javascript:")):
                continue
            if url.startswith(("http://", "https://", "//")):
                external.add(url)
                continue
            parts = urlsplit(url)
            target = src if not parts.path else (src.parent / unquote(parts.path)).resolve()
            try:
                target.relative_to(root.resolve())
            except ValueError:
                errors.append(f"{rel}: link '{url}' escapes the repository")
                continue
            if not target.exists():
                errors.append(f"{rel}: broken local link '{url}'")
                continue
            if parts.fragment and target.suffix == ".md" and target.is_file():
                if parts.fragment.lower() not in anchors(target):
                    errors.append(f"{rel}: missing anchor '#{parts.fragment}' in {target.relative_to(root.resolve())}")
                    continue
            local_ok += 1
    if scanned == 0:
        errors.append("missing required input: no tracked .md or .html files to check")
    return errors, external, local_ok


def probe(url: str) -> str | None:
    if url.startswith("//"):
        url = "https:" + url
    for method in ("HEAD", "GET"):
        try:
            req = urllib.request.Request(url, method=method, headers={"User-Agent": "brand-kit-link-check"})
            with urllib.request.urlopen(req, timeout=15):
                return None
        except Exception as exc:  # noqa: BLE001 - report whatever failed
            last = f"{type(exc).__name__}: {exc}"
    return last


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", type=Path, default=ROOT)
    ap.add_argument("--external", action="store_true", help="also probe external URLs over the network")
    ap.add_argument("--include-untracked", action="store_true",
                    help="authoring aid: also scan untracked-unignored files (default: tracked files only)")
    args = ap.parse_args(argv)
    errors, external, ok = check(args.root.resolve(), args.include_untracked)
    for e in errors:
        print(f"FAIL {e}")
    print(f"local links resolved: {ok}; broken: {len(errors)}")
    if args.external:
        failed = 0
        for url in sorted(external):
            err = probe(url)
            print(("OK   " if err is None else "FAIL ") + url + ("" if err is None else f"  ({err})"))
            failed += err is not None
        print(f"external reachable-at-run-time: {len(external) - failed}; failed: {failed} (reachability only)")
        return 1 if errors or failed else 0
    print(f"external links UNCHECKED (offline mode, not verified): {len(external)}")
    for url in sorted(external):
        print(f"UNCHECKED {url}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
