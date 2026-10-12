"""Check an extracted, hash-pinned brand archive in local consumer fixtures.

The default also requires actual named contract acknowledgments. --local checks
only offline fixture mechanics and never claims font availability, browser QA or
consumer adoption. No external font/network request is made by this command.
"""
from __future__ import annotations

import argparse
from html.parser import HTMLParser
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_distribution as dist
import token_lib as tokens

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = "distribution/fixtures"
CONSUMERS = ("getticketstub.com", "landing-page-repo", "marketing-material")


def run_process(command: list[str], cwd: Path) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=90)
    except (OSError, subprocess.SubprocessError) as exc:
        raise dist.DistributionError("local consumer tool is unavailable or failed to terminate") from exc


def acknowledgment_problems(record, files_digest: str) -> list[str]:
    if not isinstance(record, dict) or set(record) != set(CONSUMERS):
        return ["exact product, landing and marketing acknowledgment rows are required"]
    problems = []
    for consumer in CONSUMERS:
        problems += dist.review_problems(record[consumer], consumer)
        if isinstance(record[consumer], dict) and record[consumer].get("status") == "approved" \
                and record[consumer].get("files_digest") != files_digest:
            problems.append(consumer + ": acknowledgment does not bind this exact export")
    return problems


def font_evidence_report(record, files_digest: str) -> dict:
    """Report external receipts separately from checks performed by this offline tool."""
    manual = record.get("manual_evidence") if isinstance(record, dict) else None
    evidence = manual.get("external_font_available_and_unavailable") if isinstance(manual, dict) else None
    problems = dist.review_problems(evidence, "external_font_available_and_unavailable")
    if isinstance(evidence, dict) and evidence.get("status") == "approved" \
            and evidence.get("files_digest") != files_digest:
        problems.append("external font evidence is stale for this exact export")
    return {"status": "blocked" if problems else "recorded_unverified", "required_for_release": True,
            "performed_this_run": False, "record": None if problems else evidence,
            "problems": problems,
            "scope": "receipt shape and exact file-set binding; authenticate actual provider/browser outcomes independently"}


def validate_links(fixture: Path, name: str) -> int:
    class Links(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.links = []

        def handle_starttag(self, tag, attrs):
            self.links.extend(value for key, value in attrs if key in {"href", "src"})

    parser = Links()
    parser.feed((fixture / name).read_text())
    parser.close()
    for link in parser.links:
        if isinstance(link, str) and link.startswith("#"):
            continue
        if not dist.safe_path(link) or not (fixture / link).is_file():
            raise dist.DistributionError("consumer fixture references a missing or external file")
    return len(parser.links)


def validate_plain(root: Path, fixture: Path) -> int:
    css = (root / "tokens/tokens.css").read_text()
    actual = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    if re.search(r"@import|@font-face|url\s*\(", actual, flags=re.I):
        raise dist.DistributionError("default token import may not cause font/network requests")
    model = tokens.load_model(root)
    if model.errors:
        raise dist.DistributionError("extracted token profile is invalid")
    example = (fixture / "plain.css").read_text()
    if tokens.undefined_var_problems(model, css, example, "extracted plain CSS"):
        raise dist.DistributionError("consumer fixture references an absent CSS variable")
    if tokens.parity_problems(model, css):
        raise dist.DistributionError("extracted CSS does not match its token source")
    count = validate_links(fixture, "plain.html")
    if '.ts-night' not in actual or 'prefers-reduced-motion: reduce' not in actual \
            or '--ts-dur-print-sweep: 0ms' not in actual:
        raise dist.DistributionError("theme or reduced-motion contract is missing")
    if not all(name in actual for name in ("Georgia", "system-ui")):
        raise dist.DistributionError("platform font fallback families are missing")
    return count


def validate_tailwind(root: Path, fixture: Path, package_root: Path) -> dict:
    installed = root / "tools/tokens-dev/node_modules/tailwindcss"
    if not installed.is_dir():
        return {"status": "skipped", "required": True, "reason": "pinned Tailwind dependency is not installed"}
    pinned = json.loads((root / "tools/tokens-dev/package.json").read_text())["devDependencies"]["tailwindcss"]
    actual = json.loads((installed / "package.json").read_text())["version"]
    if actual != pinned:
        raise dist.DistributionError("installed Tailwind version does not match the lockfile contract")
    # Execute only the exact local source preset after its archive bytes matched Git.
    config = fixture / "tailwind.config.cjs"
    config.write_text("module.exports={presets:[require('./brand-kit/tokens/tailwind.preset.js')],"
                      "content:['./tailwind.html'],corePlugins:{preflight:false}};\n")
    command = ["node", str(installed / "lib/cli.js"), "-c", str(config),
               "-i", str(fixture / "tailwind.css"), "-o", str(fixture / "compiled.css")]
    result = run_process(command, fixture)
    if result.returncode:
        raise dist.DistributionError("extracted Tailwind build failed")
    compiled = (fixture / "compiled.css").read_text()
    expected = {".bg-orange": ("background-color", "var(--ts-orange)"),
                ".text-fg": ("color", "var(--ts-text)"),
                ".rounded-control": ("border-radius", "var(--ts-radius-control)"),
                ".duration-base": ("transition-duration", "var(--ts-dur-base)")}
    for selector, (prop, value) in expected.items():
        block = re.search(re.escape(selector) + r"\s*\{([^}]+)\}", compiled)
        if not block or not re.search(re.escape(prop) + r"\s*:\s*" + re.escape(value), block[1]):
            raise dist.DistributionError("Tailwind utility import does not preserve the expected token")
    model = tokens.load_model(package_root)
    if tokens.undefined_var_problems(model, (package_root / "tokens/tokens.css").read_text(), compiled, "compiled consumer"):
        raise dist.DistributionError("Tailwind consumer contains an undefined brand variable")
    links = {name: validate_links(fixture, name) for name in ("plain.html", "tailwind.html")}
    node = run_process(["node", "--version"], fixture).stdout.strip()
    return {"status": "pass", "required": True, "tailwind": actual, "node": node,
            "utilities_checked": len(expected), "local_links_after_compile": links,
            "command": "node <pinned-tailwind>/lib/cli.js -c tailwind.config.cjs -i tailwind.css -o compiled.css"}


def compare_public(old: dict[str, bytes], new: dict[str, bytes]) -> dict:
    """Classify removals; no version or approval policy is silently assigned."""
    removed_paths = sorted(set(old) - set(new) - {dist.MANIFEST})
    def names(blobs):
        css = blobs.get(dist.PREFIX + "tokens/tokens.css", b"").decode()
        return set(re.findall(r"(--ts-[a-z0-9-]+)\s*:", css))
    removed_tokens = sorted(names(old) - names(new))
    return {"classification": "breaking" if removed_paths or removed_tokens else "no_removal",
            "removed_paths": removed_paths, "removed_tokens": removed_tokens,
            "value_change_review": "required_separately", "policy_approved": False}


def check(root: Path, local: bool = False, archive: Path | None = None,
          expected_sha256: str | None = None, source: str | None = None) -> dict:
    current, _ = dist.source_identity(root)
    package_problems = []
    if archive is None:
        try:
            data, initial = dist.build_bytes(root, "review" if local else "approved")
        except dist.DistributionError:
            if local:
                raise
            data, initial = dist.build_bytes(root, "review")
            package_problems.append("approved artifact unavailable; executed fixtures use an unapproved review candidate")
        source, expected_sha256 = initial["source_sha"], dist.digest(data)
    else:
        data = dist.read_archive(archive)
        if source is None or expected_sha256 is None:
            raise dist.DistributionError("an external archive requires both immutable source and digest pins")
    manifest, blobs = dist.verify_bytes(data, expected_sha256, source)
    if manifest["kind"] != "approved_subset" and not local:
        package_problems.append("an unapproved review archive cannot satisfy the approved consumer contract")
    # Do not execute a JavaScript preset authenticated only by its own manifest.
    dist.verify_source(root, source, manifest, blobs)
    if archive is not None and not local:
        # Historical source integrity does not preserve today's permission to use
        # an export. Recompute the current approved subset and its receipt binding;
        # this also catches removals from an otherwise nonempty valid allowlist.
        try:
            _, current_manifest = dist.source_package(root, current, "approved")
        except dist.DistributionError:
            package_problems.append("current candidate provenance/allowlist or distribution decisions block this contract; historical approval cannot restore eligibility")
        else:
            if current_manifest["files_digest"] != manifest["files_digest"]:
                package_problems.append("archive files differ from the current approved export subset")
            if any(current_manifest[field] != manifest[field] for field in
                   ("brand_version", "proposal_sha256", "font_policy", "distribution_decision")):
                package_problems.append("archive contract differs from current version, distribution or font decision records")
    with tempfile.TemporaryDirectory(prefix="brand-consumer-") as directory:
        fixture = Path(directory)
        for name, content in blobs.items():
            target = fixture / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        for name in ("plain.html", "plain.css", "tailwind.html", "tailwind.css"):
            source_name = name + ".in" if name.endswith(".html") else name
            (fixture / name).write_bytes(dist.source_blob(root, current, FIXTURES + "/" + source_name))
        count = validate_plain(fixture / "brand-kit", fixture)
        tailwind = validate_tailwind(root, fixture, fixture / "brand-kit")
        # A real failed import followed by re-extraction exercises local rollback
        # mechanics. This is not a claim that a prior approved release exists.
        css_path = fixture / "brand-kit/tokens/tokens.css"
        original = css_path.read_bytes()
        css_path.unlink()
        try:
            validate_plain(fixture / "brand-kit", fixture)
        except (OSError, dist.DistributionError):
            missing_rejected = True
        else:
            raise dist.DistributionError("missing CSS import unexpectedly passed")
        css_path.write_bytes(original)
        validate_plain(fixture / "brand-kit", fixture)
    record, approval_problems = dist.accepted_record(root, current)
    approval_problems += package_problems
    if record:
        approval_problems += acknowledgment_problems(record["consumer_acknowledgments"], manifest["files_digest"])
        for field in ("distribution", "font_delivery"):
            if isinstance(record[field], dict) and record[field].get("status") == "approved" \
                    and record[field].get("files_digest") != manifest["files_digest"]:
                approval_problems.append(field + ": decision is stale for this exact export")
    font_evidence = font_evidence_report(record, manifest["files_digest"])
    approval_problems += font_evidence["problems"]
    local_ok = tailwind["status"] == "pass"
    return {"schema_version": 1, "source_sha": source, "checker_sha": current,
            "archive_sha256": expected_sha256, "files_digest": manifest["files_digest"],
            "mode": "offline_review_fixture", "plain_css": {"status": "pass", "local_links": count},
            "tailwind": tailwind,
            "recovery": {"missing_import_rejected": missing_rejected, "exact_bytes_restored": True,
                         "scope": "local re-extraction only; no approved historical rollback target exists"},
            "font_provider_checks": {"status": "not_run", "performed_this_run": False,
                                     "reason": "this offline command never performs provider requests or browser font checks"},
            "external_font_evidence": font_evidence,
            "consumer_acknowledgments": {"status": "blocked" if approval_problems else "recorded_unverified",
                                          "problems": approval_problems},
            "result": "pass" if local_ok and (local or not approval_problems) else "blocked",
            "scope": "local_fixture_mechanics" if local else "consumer_contract_checks",
            "release_approved": False, "consumer_adoption": False,
            "limitations": ["CSS inspection is structural; it is not browser font, visual, accessibility or owner review.",
                            "Review acknowledgments are local records; their authenticity requires independent human verification."]}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--local", action="store_true", help="only local mechanics; no acceptance claim")
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--sha256")
    parser.add_argument("--source")
    args = parser.parse_args(argv)
    try:
        report = check(args.root.resolve(), args.local, args.archive, args.sha256, args.source)
    except dist.DistributionError as exc:
        print("BLOCKED " + str(exc))
        return 1
    except (OSError, ValueError, KeyError, TypeError, AttributeError, RecursionError):
        print("BLOCKED consumer check failed; no input values are printed")
        return 1
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["result"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
