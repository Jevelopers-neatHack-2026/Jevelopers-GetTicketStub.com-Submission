"""Run the repository-local BK-10 gate and preserve each required outcome.

This command neither publishes a release nor updates foreign acceptance. Missing
tools, required skipped browser/provider evidence and unknown approvals block it.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
import platform
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_distribution as dist
import check_consumers as consumers

ROOT = Path(__file__).resolve().parents[1]
CHECKS = (
    "check-inventory", "check-links", "check-governance", "check-provenance",
    "build-tokens", "check-tokens", "check-tokens-tailwind", "build-assets", "check-assets",
    "check-accessibility", "check-accessibility-browser", "check-guidelines",
    "test", "check-package", "package-brand", "check-consumers", "check-consumers-browser",
)
LEAVES = {"BK-01": 6, "BK-02": 9, "BK-03A": 10, "BK-03B": 14, "BK-04": 11,
          "BK-05": 13, "BK-06": 7, "BK-07": 8, "BK-08": 12, "BK-09": 15}
MANUAL = (
    "identity_ratification", "rights_review", "visual_assets", "browser_accessibility",
    "external_font_available_and_unavailable", "claims_review", "sanitization_and_history",
    "upgrade_and_approved_rollback",
)


def sanitize_output(data: bytes) -> bytes:
    """Withhold entire suspicious lines; no unsanitized logs are persisted."""
    lines = data.decode("utf-8", errors="replace").splitlines()
    return ("\n".join("[line withheld: sensitive-looking content]" if dist.provenance.secret_kind(line)
                      else line for line in lines) + "\n").encode()


def collect_check(root: Path, target: str, output: Path, number: int, timeout: int) -> dict:
    command = ["make", target]
    if target == "package-brand":
        command.append("BRAND_OUTPUT=" + str(output / "approved-brand.zip"))
    elif target == "build-assets":
        command.append("ASSET_OUTPUT=" + str(output / "asset-review"))
    started = datetime.now(timezone.utc).isoformat()
    begin = time.monotonic()
    environment = dict(os.environ)
    # Do not inherit Make selection flags that turn a recipe into a no-op success.
    for key in ("MAKEFLAGS", "MFLAGS", "MAKEOVERRIDES", "MAKEFILES"):
        environment.pop(key, None)
    process = None
    try:
        process = subprocess.Popen(command, cwd=root, env=environment, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=os.name == "posix")
        stdout, stderr = process.communicate(timeout=timeout)
        code = process.returncode
        status = "pass" if code == 0 else "fail"
        reason = None
    except subprocess.TimeoutExpired as exc:
        if process is not None:
            if os.name == "posix":
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            else:
                process.kill()
            stdout, stderr = process.communicate()
        else:
            stdout, stderr = exc.stdout or b"", exc.stderr or b""
        code = None
        status, reason = "error", "required command timed out"
    except OSError:
        code, stdout, stderr = None, b"", b""
        status, reason = "error", "required command could not start"
    streams = {}
    for name, data in (("stdout", stdout), ("stderr", stderr)):
        safe = sanitize_output(data)
        filename = f"{number:02d}-{target}.{name}.txt"
        dist.write_new(output / filename, safe)
        streams[name] = {"path": filename, "sha256": dist.digest(safe),
                         "original_stream_sha256": dist.digest(data), "sanitized": True}
    return {"target": target, "command": command, "required": True, "started_at": started,
            "elapsed_seconds": round(time.monotonic() - begin, 3), "exit_code": code,
            "result": status, "reason": reason, "streams": streams,
            "mode": "local_repository_check", "provider_execution_authorized": False}


def manual_problems(record, files_digest: str) -> list[str]:
    problems = []
    if not isinstance(record, dict):
        return ["required named acceptance record is unavailable"]
    leaves = record.get("leaf_evidence")
    if not isinstance(leaves, dict) or set(leaves) != set(LEAVES):
        problems.append("required leaf closure/decision evidence inventory is incomplete")
    else:
        for leaf in LEAVES:
            problems += dist.review_problems(leaves[leaf], leaf)
            if isinstance(leaves[leaf], dict) and leaves[leaf].get("status") == "approved" \
                    and leaves[leaf].get("files_digest") != files_digest:
                problems.append(leaf + ": acceptance evidence is stale for the exact candidate")
    problems += consumers.acknowledgment_problems(record.get("consumer_acknowledgments"), files_digest)
    fields = record.get("manual_evidence")
    if not isinstance(fields, dict) or set(fields) != set(MANUAL):
        problems.append("required manual evidence inventory is missing or incomplete")
    else:
        for name in MANUAL:
            problems += dist.review_problems(fields[name], name)
            if isinstance(fields[name], dict) and fields[name].get("status") == "approved" \
                    and fields[name].get("files_digest") != files_digest:
                problems.append(name + ": evidence is stale for the exact exported files")
    problems += dist.review_problems(record.get("release_review"), "release_review")
    if isinstance(record.get("release_review"), dict) and record["release_review"].get("status") == "approved" \
            and record["release_review"].get("files_digest") != files_digest:
        problems.append("release review is stale for the exact exported files")
    return problems


def gate(root: Path, output: Path, timeout: int = 180) -> dict:
    source, tree = dist.source_identity(root)
    if output.resolve().is_relative_to(root.resolve()):
        raise dist.DistributionError("release reports must be outside the source checkout")
    for path in (output, *output.parents):
        if path.is_symlink():
            raise dist.DistributionError("release output may not traverse a symlink")
    if output.exists():
        raise dist.DistributionError("gate output must be a fresh path so earlier failures remain intact")
    output.mkdir(parents=True, exist_ok=False)
    # Record every command, including later checks after an earlier failure.
    outcomes = [collect_check(root, target, output, n, timeout) for n, target in enumerate(CHECKS, 1)]
    blockers, archive_info = [], None
    archive_problem = "exact candidate archive or required approval inputs are unavailable"
    try:
        try:
            data, manifest = dist.build_bytes(root, "approved")
        except dist.DistributionError:
            # Missing decisions must still leave a reviewable diagnostic, but the
            # full proposal is not the file set of a future approved subset.
            data, manifest = dist.build_bytes(root, "review")
            archive_name, from_package = "review-brand.zip", False
            dist.write_new(output / archive_name, data)
            blockers.append("approved artifact unavailable; review archive is diagnostic only")
        else:
            # Bind acceptance to the actual package-brand result, including its
            # manifest. A successful exit without the exact archive is insufficient.
            archive_name, from_package = "approved-brand.zip", True
            packaged = output / archive_name
            if packaged.is_symlink() or not packaged.is_file():
                archive_problem = "package-brand did not create a regular approved archive"
                raise dist.DistributionError(archive_problem)
            if dist.read_archive(packaged) != data:
                archive_problem = "package-brand archive differs from the reproducible approved candidate"
                raise dist.DistributionError(archive_problem)
        archive_info = {"source_sha": manifest["source_sha"], "archive_sha256": dist.digest(data),
                        "files_digest": manifest["files_digest"], "kind": manifest["kind"],
                        "brand_version": manifest["brand_version"], "token_profile": manifest["token_profile"],
                        "path": archive_name, "from_package_brand": from_package}
        record, missing = dist.accepted_record(root, source)
        blockers += missing + manual_problems(record, manifest["files_digest"])
    except (dist.DistributionError, OSError, TypeError, KeyError, ValueError, AttributeError):
        # Only locally selected fixed messages enter reports; nested exceptions
        # may include input-derived or sensitive details.
        blockers.append(archive_problem)
    for result in outcomes:
        if result["result"] != "pass":
            blockers.append(result["target"] + ": required command did not pass")
    try:
        if dist.source_identity(root) != (source, tree):
            blockers.append("candidate source changed during the gate")
    except dist.DistributionError:
        blockers.append("candidate checkout became dirty during the gate")
    report = {"schema_version": 1, "scope": "BK-10 repository-local evidence only", "source_sha": source,
              "source_tree": tree, "recorded_at": datetime.now(timezone.utc).isoformat(),
              "toolchain": {"python": sys.version.split()[0], "platform": platform.platform()},
              "artifact": archive_info, "commands": outcomes,
              "required_leaves": {key: "https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/" + str(number)
                                  for key, number in LEAVES.items()},
              "blockers": blockers, "result": "blocked" if blockers else "recorded_checks_pass",
              "release_approved": False, "foreign_acceptance_changed": False,
              "next_owner_action": "Product/frontend approver and named technical, provenance, consumer and release reviewers must authenticate exact evidence.",
              "limitations": ["Unsigned local report: data integrity and field checks do not authenticate reviewer authority.",
                              "Required missing, failed and skipped checks remain blocking; no prior failure is overwritten.",
                              "No artifact is published, provider invoked intentionally, gate/epic closed or global criterion verified."]}
    dist.write_new(output / "report.json", dist.canonical(report))
    return report


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--timeout", type=int, default=180)
    args = parser.parse_args(argv)
    if args.timeout < 1 or args.timeout > 600:
        parser.error("timeout must be between 1 and 600 seconds")
    path = args.out
    if path is None:
        path = Path(tempfile.mkdtemp(prefix="brand-gate-parent-")) / "run"
    try:
        report = gate(args.root.resolve(), path.absolute(), args.timeout)
    except dist.DistributionError as exc:
        print("BLOCKED " + str(exc))
        return 1
    except (OSError, TypeError, KeyError, ValueError, AttributeError):
        print("BLOCKED release gate could not establish a clean candidate and fresh output path")
        return 1
    print(json.dumps({"source_sha": report["source_sha"], "result": report["result"],
                      "checks": len(report["commands"]), "blockers": len(report["blockers"]),
                      "report": str(path / "report.json"), "release_approved": False}, sort_keys=True))
    return 0 if report["result"] == "recorded_checks_pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
