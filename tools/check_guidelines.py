#!/usr/bin/env python3
"""Offline source-snapshot and usage-structure check; no approvals are granted.

The four public source hashes force a deliberate review when wording or its
presentation changes. Labels, claim rows and positive/negative source fixtures
are checked separately so merely updating a hash cannot remove a required
warning. This is not a semantic claim verifier, browser check, rights check,
consumer ACK or release gate. It reads local files only and never refreshes its
own snapshot. Run with Python's isolated mode; no third-party dependency needed.
"""
import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = "docs/guidelines-source-snapshot.json"
PUBLIC_SOURCES = ("README.md", "SPEC.md", "index.html", "docs/voice.md")
ORIGINAL_REVISION = "3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4"
CLAIMS = {f"BK-CLAIM-{n:02}" for n in range(1, 15)}
VARIANTS = {
    "app-icon.svg", "favicon.svg", "lockup-horizontal-mono.svg",
    "lockup-horizontal.svg", "lockup-stacked.svg", "ts-stamp-currentcolor.svg",
    "ts-stamp-mono-cream.svg", "ts-stamp-mono-ink.svg", "ts-stamp-mono-orange.svg",
    "ts-stamp.svg", "wordmark-compact.svg", "wordmark-cream.svg",
    "wordmark-orange.svg", "wordmark.svg",
}
PUBLIC_MARKERS = {
    "README.md": ("Illustrative positioning for review", "describes a planned experience"),
    "SPEC.md": ("Illustrative copy for review; no product capability is verified",
                "illustrative price anchor", "pending approved pricing and fulfillment evidence"),
    "docs/voice.md": ("All product wording on this page is illustrative and pending review",
                      "Illustrative examples only", "no approved public wording"),
    "index.html": ("Draft identity and illustrative product examples",
                   "describes planned experiences", "No release or public claim is approved here"),
}
PAIRS = (
    ("ratio-valid", "ratio-invalid"), ("space-valid", "space-invalid"),
    ("size-valid", "size-invalid"), ("wordmark-valid", "wordmark-invalid"),
    ("plate-valid", "plate-invalid"), ("text-valid", "text-invalid"),
    ("mono-valid", "material-invalid"), ("lockup-valid", "lockup-invalid"),
)
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


def normalized(text):
    return " ".join(text.split()).casefold()


@dataclass
class Node:
    tag: str
    attrs: dict = field(default_factory=dict)
    visible: bool = True
    children: list = field(default_factory=list)

    def text(self):
        if not self.visible:
            return ""
        return " ".join(c.text() if isinstance(c, Node) else c for c in self.children)


class SourceHTML(HTMLParser):
    """Read text nodes; comments, metadata and explicitly hidden labels do not count.

    Stylesheets/layout are intentionally not evaluated. Browser review remains
    necessary; the public-source hashes also detect changes to embedded CSS.
    """

    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.root = Node("root")
        self.stack = [self.root]
        self.nodes = []
        self.feed(source)
        self.close()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        style = attrs.get("style", "") or ""
        hidden = (tag in {"head", "script", "style", "template", "noscript"}
                  or "hidden" in attrs or (attrs.get("aria-hidden") or "").lower() == "true"
                  or re.search(r"(?:display\s*:\s*none|visibility\s*:\s*hidden)", style, re.I))
        node = Node(tag, attrs, self.stack[-1].visible and not hidden)
        self.nodes.append(node)
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)

    def by_id(self, identifier):
        return [n for n in self.nodes if n.attrs.get("id") == identifier]


def visible_text(source, markdown=False):
    if markdown:
        # A marker quoted only in a code sample or comment is not a page warning.
        source = re.sub(r"(?ms)^\s*(`{3,}|~{3,})[^\n]*\n.*?^\s*\1\s*$", "", source)
        source = re.sub(r"`[^`\n]*`", "", source)
    return normalized(SourceHTML(source).root.text())


def read(root, relative, errors):
    path = root / relative
    if not path.resolve().is_relative_to(root.resolve()):
        errors.append(f"{relative}: path escapes the local repository")
        return None
    try:
        return path.read_bytes()
    except OSError as exc:
        errors.append(f"{relative}: cannot read required file ({exc.strerror})")
        return None


def read_text(root, relative, errors):
    data = read(root, relative, errors)
    if data is None:
        return ""
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        errors.append(f"{relative}: expected UTF-8 text")
        return ""


def check_snapshot(root, sources, errors):
    try:
        snapshot = json.loads(read_text(root, SNAPSHOT, errors))
    except json.JSONDecodeError:
        errors.append(f"{SNAPSHOT}: invalid JSON")
        return
    if not isinstance(snapshot, dict):
        errors.append(f"{SNAPSHOT}: expected an object")
        return
    if (type(snapshot.get("schema_version")) is not int or snapshot.get("schema_version") != 1
            or snapshot.get("scope") != "local source snapshot and structure only"
            or snapshot.get("public_claim_approval") != "pending"
            or snapshot.get("release_eligible") is not False):
        errors.append(f"{SNAPSHOT}: must retain local-only scope, pending claim approval and release_eligible=false")
    if not re.fullmatch(r"[0-9a-f]{40}", str(snapshot.get("review_base_revision", ""))):
        errors.append(f"{SNAPSHOT}: review_base_revision must name an immutable 40-hex Git revision")
    recorded = snapshot.get("sources")
    if not isinstance(recorded, dict) or set(recorded) != set(PUBLIC_SOURCES):
        errors.append(f"{SNAPSHOT}: sources must contain exactly the four public source paths")
        return
    for path in PUBLIC_SOURCES:
        expected = recorded[path]
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
            errors.append(f"{SNAPSHOT}: {path} needs a lowercase SHA-256")
        elif sources[path] is not None:
            actual = hashlib.sha256(sources[path]).hexdigest()
            if actual != expected:
                errors.append(f"{path}: public-source drift; review wording/rendering and deliberately update the snapshot (expected {expected}, actual {actual})")


def check_public_sources(root, errors):
    sources = {path: read(root, path, errors) for path in PUBLIC_SOURCES}
    check_snapshot(root, sources, errors)
    for path, data in sources.items():
        if data is None:
            continue
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            errors.append(f"{path}: expected UTF-8 text")
            continue
        if path == "index.html":
            notices = SourceHTML(text).by_id("review-status")
            if len(notices) != 1:
                errors.append("index.html: exactly one visible #review-status notice is required")
                visible = ""
            else:
                visible = normalized(notices[0].text())
        else:
            visible = visible_text(text, markdown=True)
        for marker in PUBLIC_MARKERS[path]:
            if normalized(marker) not in visible:
                errors.append(f"{path}: missing visible review marker: {marker}")


def check_claims(root, errors):
    path = "docs/claims-register.md"
    text = read_text(root, path, errors)
    visible = visible_text(text, markdown=True)
    for marker in ("no product claim is approved here",
                   "Approved public wording and named approving reviewer are pending for every product claim",
                   "Required result: reject"):
        if normalized(marker) not in visible:
            errors.append(f"{path}: missing review boundary: {marker}")
    rows = re.findall(r"^\| (BK-CLAIM-\d+)\b[^\n]*", text, re.M)
    if set(rows) != CLAIMS or len(rows) != len(CLAIMS):
        errors.append(f"{path}: exactly one row for each BK-CLAIM-01 through BK-CLAIM-14 is required")
    used_paths = set()
    for line in text.splitlines():
        if not re.match(r"^\| BK-CLAIM-\d+\b", line):
            continue
        columns = [column.strip() for column in line.split("|")[1:-1]]
        identifier = line.split(" —", 1)[0].lstrip("| ")
        if len(columns) != 4 or any(not column for column in columns):
            errors.append(f"{path}: {identifier} needs category, source, disposition and owner/evidence")
            continue
        refs = re.findall(r"https://github\.com/Jevelopers-neatHack-2026/brand-kit/blob/([^/]+)/([^#)\s]+)#L\d+(?:-L\d+)?", columns[1])
        if not refs:
            errors.append(f"{path}: {identifier} needs an immutable original-source line link")
        for revision, source_path in refs:
            if revision != ORIGINAL_REVISION or source_path not in PUBLIC_SOURCES:
                errors.append(f"{path}: {identifier} original source must use the recorded baseline and public source paths")
            else:
                used_paths.add(source_path)
    if used_paths != set(PUBLIC_SOURCES):
        errors.append(f"{path}: claim rows must cover all four public sources")


def check_usage(root, errors):
    path = "docs/usage.md"
    text = read_text(root, path, errors)
    visible = visible_text(text, markdown=True)
    for marker in ("No approved identity version or distributable subset exists yet",
                   "approved identity version: pending", "Public wording and mock labels"):
        if normalized(marker) not in visible:
            errors.append(f"{path}: missing scope statement: {marker}")
    for channel in ("Product app", "Landing page", "Marketing collateral", "Social / demo material",
                    "Internal financial UI", "Print / packaging"):
        if not re.search(rf"^\| {re.escape(channel)}\b", text, re.M):
            errors.append(f"{path}: missing channel row: {channel}")

    path = "docs/usage-examples.html"
    text = read_text(root, path, errors)
    html = SourceHTML(text)
    if "identity and export approval pending" not in normalized(html.root.text()):
        errors.append(f"{path}: visible approval-pending notice is required")
    for positive, negative in PAIRS:
        for identifier, marker in ((positive, "approval pending" if positive == "lockup-valid" else "follows rule:"),
                                   (negative, "invalid:")):
            nodes = html.by_id(identifier)
            if len(nodes) != 1 or nodes[0].tag != "figure":
                errors.append(f"{path}: exactly one figure #{identifier} is required")
                continue
            captions = [c for c in nodes[0].children if isinstance(c, Node) and c.tag == "figcaption"]
            if len(captions) != 1 or marker not in normalized(captions[0].text()):
                errors.append(f"{path}: #{identifier} needs a visible {marker!r} caption")
    for node in html.nodes:
        if node.tag == "img":
            if node.attrs.get("src") not in {f"../logo/{name}" for name in VARIANTS} or "srcset" in node.attrs:
                errors.append(f"{path}: fixture images must use only relative canonical logo SVG sources")
        if node.tag in {"script", "link", "iframe", "object", "embed", "audio", "video", "source", "track", "base"}:
            errors.append(f"{path}: resource/behavior tag <{node.tag}> is outside this local fixture's scope")
    if re.search(r"@import\b|url\s*\(", text, re.I):
        errors.append(f"{path}: CSS resource loads are outside this local fixture's scope")


def check_variants(root, errors):
    actual = {p.name for p in (root / "logo").glob("*.svg")}
    if actual != VARIANTS:
        errors.append(f"logo/: canonical variant set drift (missing={sorted(VARIANTS - actual)}, unexpected={sorted(actual - VARIANTS)})")
    packet = read_text(root, "docs/identity-decision-packet.md", errors)
    for name in sorted(VARIANTS):
        data = read(root, f"logo/{name}", errors)
        if data is not None:
            try:
                element = ElementTree.fromstring(data)
                if element.tag != "{http://www.w3.org/2000/svg}svg":
                    raise ValueError("not an SVG root")
            except (ElementTree.ParseError, ValueError):
                errors.append(f"logo/{name}: invalid canonical SVG document")
        if f"(../logo/{name})" not in packet:
            errors.append(f"docs/identity-decision-packet.md: missing candidate disposition link for logo/{name}")


def check(root=ROOT):
    errors = []
    root = Path(root)
    check_public_sources(root, errors)
    check_claims(root, errors)
    check_usage(root, errors)
    check_variants(root, errors)
    return errors


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT, help="local repository or isolated test fixture")
    args = parser.parse_args(argv)
    errors = check(args.root)
    for error in errors:
        print("FAIL:", error)
    if not errors:
        print("guidelines: PASS — 4 public source hashes, 14 claim rows, 8 usage pairs, 14 canonical SVG variants")
    print("Scope: local source snapshot and structure only. Public claim approvals remain PENDING; release eligibility is NOT established.")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
