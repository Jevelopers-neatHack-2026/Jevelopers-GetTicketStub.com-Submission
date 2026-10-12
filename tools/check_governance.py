#!/usr/bin/env python3
"""Check the shape of the brand governance documents (stdlib only).

Verifies required sections, the template's headings and bullet labels (read
from the template itself), that every simulated decision record carries all of
them and an explicit "Release eligible: no", relative links and anchors, that
the simulation is labelled fictional, and that no unlabelled approval claim
appears. It cannot verify that anyone approved
anything. Exit 0 when all checks pass, 1 otherwise. Reads files only.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GOV = ROOT / "docs" / "brand-governance.md"
TPL = ROOT / "docs" / "governance" / "decision-template.md"
SIM = ROOT / "docs" / "governance" / "simulated-walkthrough.md"

GOV_HEADINGS = ["Responsibility table (BK-07.1)", "Decision lifecycle (BK-07.2)",
                "Change classes (BK-07.3)",
                "Deprecation, replacement, rollback and revocation (BK-07.4)",
                "Release eligibility check", "Closure blockers"]
MARKER = "FICTIONAL SIMULATION"


def slug(h):
    s = re.sub(r"[^\w\- ]", "", h.lower()).strip().replace(" ", "-")
    return s


def template_fields(tpl):
    """Headings and bullet labels inside the template's fenced block."""
    m = re.search(r"```markdown\n(.*?)\n```", tpl, re.S)
    if not m:
        return None
    block = m.group(1)
    heads = re.findall(r"^## (.+?)\s*$", block, re.M)
    labels = re.findall(r"^- \*\*(.+?):\*\*", block, re.M)
    return heads, labels


def check_sim_records(sim, heads, labels, errors):
    parts = re.split(r"^# Decision:", sim, flags=re.M)[1:]
    if not parts:
        errors.append("simulation has no '# Decision:' records")
    for i, rec in enumerate(parts, 1):
        for h in heads:
            if not re.search(rf"^## {re.escape(h)}\s*$", rec, re.M):
                errors.append(f"simulation record {i} missing heading: {h}")
        for lab in labels:
            if not re.search(rf"^- \*\*{re.escape(lab)}:\*\*[ \t]*\S", rec, re.M):
                errors.append(f"simulation record {i} missing or empty field: {lab}")
        rel = re.findall(r"^- \*\*Release eligible:\*\*\s*(.*)$", rec, re.M)
        if len(rel) != 1 or not re.fullmatch(r"no\b.*", rel[0].strip(), re.I):
            errors.append(f"simulation record {i} must state exactly one 'Release eligible: no'")
        for row in re.findall(r"^\| .*\| ([0-9a-fA-F]{8,}) \|$", rec, re.M):
            if not re.fullmatch(r"[0-9a-f]{64}", row):
                errors.append(f"simulation record {i} has a non-64-hex SHA-256: {row}")
        if "SHA-256" in rec and not re.search(r"\| [0-9a-f]{64} \|", rec):
            errors.append(f"simulation record {i} lists no SHA-256 value")


def check_links(path, errors):
    text = path.read_text()
    for m in re.finditer(r"\[[^\]]*\]\(([^)\s]+)\)", text):
        t = m.group(1)
        if re.match(r"[a-z]+://", t):
            continue
        f, _, frag = t.partition("#")
        target = (path.parent / f).resolve() if f else path
        if not target.exists():
            errors.append(f"{path.name}: broken link {t}")
        elif frag and target.suffix == ".md":
            slugs = {slug(h) for h in re.findall(r"^#+\s+(.*)$", target.read_text(), re.M)}
            if frag not in slugs:
                errors.append(f"{path.name}: missing anchor {t}")


def main():
    errors = []
    for p in (GOV, TPL, SIM):
        if not p.exists():
            errors.append(f"missing required file {p.relative_to(ROOT)}")
    if errors:
        print("\n".join(errors)); return 1
    gov, tpl, sim = GOV.read_text(), TPL.read_text(), SIM.read_text()
    for h in GOV_HEADINGS:
        if not re.search(rf"^## {re.escape(h)}\s*$", gov, re.M):
            errors.append(f"governance doc missing heading: {h}")
    fields = template_fields(tpl)
    if fields is None:
        errors.append("template has no fenced markdown block")
    else:
        heads, labels = fields
        for need in ("Change and exact diff", "Files and hashes", "Scope of approval",
                     "Rights and provenance", "Affected consumers",
                     "Evidence and validation", "Reviewers", "Disposition"):
            if need not in heads:
                errors.append(f"template missing heading: {need}")
        for need in ("Decision ID", "Status", "Change class", "Proposed by / date",
                     "Base revision", "Proposed revision", "Diff", "Covers",
                     "Does not cover", "Decision date", "Release eligible", "Reinstates"):
            if need not in labels:
                errors.append(f"template missing field: {need}")
        check_sim_records(sim, heads, labels, errors)
    for ref in ("Unknown", "@CompleteDotTech", "LaJefa", "Lars", "issuecomment-6113526793",
                "issuecomment-6116787775", "No self-hosted fonts", "Refs #8"):
        if ref not in gov and ref != "Refs #8":
            errors.append(f"governance doc missing required statement: {ref}")
    if MARKER not in sim:
        errors.append("simulation missing FICTIONAL SIMULATION marker")
    if re.search(r"Release eligible\W*\**\s*\|?\s*\**yes", sim, re.I):
        errors.append("simulation claims release eligible: yes")
    if re.search(r"^- \*\*Status:\*\* approved\s*$", sim, re.M):
        errors.append("simulation has approved status without (fictional)")
    for p in (GOV, TPL, SIM):
        check_links(p, errors)
    for e in errors:
        print("FAIL:", e)
    if not errors:
        print("governance docs OK")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
