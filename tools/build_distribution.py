"""Build and verify a local brand review archive. Nothing is published.

`build --mode approved` is deliberately blocked by missing provenance/decisions.
Review archives are unsigned source snapshots, never approvals or releases.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_provenance as provenance

ROOT = Path(__file__).resolve().parents[1]
PROPOSAL = "distribution/proposal.json"
REVIEW = "distribution/acceptance.json"
PREFIX = "brand-kit/"
MANIFEST = PREFIX + "MANIFEST.json"
SHA = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\Z")
MAX_BYTES = 20 * 1024 * 1024
MAX_FILES = 128
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_SOURCE_FILES = 4096
TOKEN_PATHS = frozenset({"tokens/tokens.json", "tokens/tokens.css", "tokens/profile.json",
    "tokens/mapping.json", "tokens/tailwind.preset.js", "tokens/token-matrix.md",
    "tokens/external-fonts-google.css"})
GUIDE_PATHS = frozenset({"docs/logo.md", "docs/token-profile.md", "docs/distribution.md",
    "docs/consumers.md", "docs/voice.md", "docs/imagery.md", "docs/motion-sound-haptics.md"})
NOTICE_PATHS = frozenset({"fonts/Fraunces-OFL.txt", "fonts/InterTight-OFL.txt"})


class DistributionError(ValueError):
    """Safe, fixed diagnostics only; never echo untrusted input values."""


def canonical(value) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=True) + "\n").encode()


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def read_archive(path: Path) -> bytes:
    with path.open("rb") as handle:
        data = handle.read(MAX_BYTES * 2 + 1)
    if len(data) > MAX_BYTES * 2:
        raise DistributionError("archive exceeds the size bound")
    return data


def parse_json(data: bytes):
    def unique(pairs):
        out = {}
        for key, value in pairs:
            if key in out:
                raise DistributionError("duplicate JSON key")
            out[key] = value
        return out
    try:
        return json.loads(data, object_pairs_hook=unique,
                          parse_constant=lambda _: (_ for _ in ()).throw(DistributionError("nonfinite JSON")))
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise DistributionError("invalid or ambiguous JSON") from exc


def git(root: Path, *args: str) -> bytes:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    try:
        return subprocess.run(["git", "--no-replace-objects", "-C", str(root), *args],
                              capture_output=True, check=True, env=env, timeout=30).stdout
    except (OSError, subprocess.SubprocessError) as exc:
        raise DistributionError("cannot read the selected Git source") from exc


def source_identity(root: Path) -> tuple[str, str]:
    source = git(root, "rev-parse", "HEAD").decode().strip()
    tree = git(root, "rev-parse", "HEAD^{tree}").decode().strip()
    if not SHA.fullmatch(source) or not SHA.fullmatch(tree):
        raise DistributionError("a full immutable source and tree SHA are required")
    if git(root, "status", "--porcelain", "--untracked-files=normal"):
        raise DistributionError("a clean committed checkout is required")
    flags = git(root, "ls-files", "-v", "-z").decode().split("\0")
    if any(line and (line[0].islower() or line[0] == "S") for line in flags):
        raise DistributionError("index flags may not conceal changed source")
    return source, tree


def safe_path(path) -> bool:
    return (isinstance(path, str) and len(path) <= 200 and path.isascii()
            and re.fullmatch(r"[A-Za-z0-9_.\-/]+", path) is not None
            and all(p not in {"", ".", ".."} for p in path.split("/"))
            and not path.startswith("/"))


def supported_path(path) -> bool:
    return safe_path(path) and (path in TOKEN_PATHS | GUIDE_PATHS | NOTICE_PATHS
        or (path.startswith("logo/") and path.count("/") == 1 and path.endswith(".svg")))


def source_blob(root: Path, source: str, path: str) -> bytes:
    if not SHA.fullmatch(source) or not safe_path(path):
        raise DistributionError("unsafe source reference or path")
    entry = git(root, "ls-tree", "-z", source, "--", path).split(b"\0")
    if len(entry) != 2 or not entry[0].startswith(b"100644 blob "):
        raise DistributionError("export input must be one committed regular nonexecutable file")
    content = git(root, "show", source + ":" + path)
    if len(content) > MAX_BYTES:
        raise DistributionError("export input exceeds the size bound")
    return content


def load_proposal(root: Path, source: str) -> dict:
    proposal = parse_json(source_blob(root, source, PROPOSAL))
    expected = {"schema_version", "status", "brand_version", "archive_format", "paths", "font_policy", "compatibility"}
    if not isinstance(proposal, dict) or set(proposal) != expected or type(proposal["schema_version"]) is not int or proposal["schema_version"] != 1:
        raise DistributionError("unsupported distribution proposal")
    if proposal["status"] != "proposal" or proposal["brand_version"] is not None \
            or proposal["archive_format"] != "zip-stored-v1":
        raise DistributionError("the proposal must not assert a selected release version")
    paths = proposal["paths"]
    if not isinstance(paths, list) or not 0 < len(paths) <= MAX_FILES \
            or any(not supported_path(p) for p in paths) or len(set(paths)) != len(paths):
        raise DistributionError("proposal export paths are invalid or forbidden")
    policy = proposal["font_policy"]
    if not isinstance(policy, dict) or policy.get("self_hosted") is not False \
            or policy.get("status") != "pending_owner_review" \
            or policy.get("default") != "platform_fallbacks_no_network":
        raise DistributionError("font proposal must retain no self-hosting and pending provider review")
    return proposal


def accepted_record(root: Path, source: str) -> tuple[dict | None, list[str]]:
    """Validate local evidence shape; a person must authenticate the linked decisions."""
    value = parse_json(source_blob(root, source, REVIEW))
    required = {"schema_version", "source_sha", "brand_version", "distribution", "font_delivery",
                "consumer_acknowledgments", "release_review", "manual_evidence", "leaf_evidence"}
    if not isinstance(value, dict) or set(value) != required or type(value["schema_version"]) is not int or value["schema_version"] != 1:
        return None, ["distribution acceptance record has an unsupported shape"]
    problems = []
    # Approval cannot recursively pin its own commit. Bind the exact selected file set
    # through its digest, and cite the actual prior reviewed source revision.
    bound = value["source_sha"]
    if not isinstance(bound, str) or not SHA.fullmatch(bound):
        problems.append("no exact reviewed distribution source SHA is recorded")
    version = value["brand_version"]
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        problems.append("brand version has not been selected by the owner")
    for field in ("distribution", "font_delivery"):
        problems += review_problems(value[field], field)
    return value, problems


def review_problems(record, name: str) -> list[str]:
    expected = {"status", "reviewer", "reviewed_on", "evidence_url", "evidence_sha256", "files_digest"}
    if not isinstance(record, dict) or set(record) != expected:
        return [name + ": missing exact decision fields"]
    if record["status"] != "approved":
        return [name + ": approval is pending"]
    reviewer = record["reviewer"]
    if not isinstance(reviewer, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}", reviewer) \
            or reviewer.lower() in {"unknown", "pending", "reviewer", "owner", "test", "synthetic"}:
        return [name + ": named reviewer is missing"]
    if not provenance.real_date(record["reviewed_on"]):
        return [name + ": decision date is missing or invalid"]
    url = record["evidence_url"]
    if not isinstance(url, str) or not re.fullmatch(
            r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/(?:issues|pull)/[0-9]+#(?:issuecomment|pullrequestreview)-[0-9]+", url):
        return [name + ": a specific review/comment permalink is required"]
    if not all(isinstance(record[k], str) and DIGEST.fullmatch(record[k]) for k in ("evidence_sha256", "files_digest")):
        return [name + ": exact evidence and file-set digests are missing"]
    return []


def file_set_digest(entries: list[dict]) -> str:
    return digest(canonical([{k: e[k] for k in ("path", "sha256", "size_bytes")} for e in entries]))


def source_provenance(root: Path, source: str, production: bool) -> tuple[dict, dict]:
    """Validate pinned source in a bounded, inert view, independent of checkout HEAD.

    No Git archive extraction, symlinks, executable modes or source code execution
    are used. Existing provenance validators see exactly the selected tree bytes,
    including source-only font files whose names are not distribution paths.
    """
    register = parse_json(source_blob(root, source, "provenance/register.json"))
    allowlist = parse_json(source_blob(root, source, "provenance/allowlist.json"))
    entries = git(root, "ls-tree", "-r", "-l", "-z", source).split(b"\0")
    if not entries or entries[-1] or len(entries) - 1 > MAX_SOURCE_FILES:
        raise DistributionError("selected source file inventory is invalid or exceeds the bound")
    with tempfile.TemporaryDirectory(prefix="brand-source-validation-") as directory:
        view = Path(directory)
        tracked, folded, total = set(), set(), 0
        for entry in entries[:-1]:
            try:
                metadata, raw_path = entry.split(b"\t", 1)
                mode, kind, object_id, raw_size = metadata.split()
                path = raw_path.decode("utf-8")
                size = int(raw_size)
            except (ValueError, UnicodeError) as exc:
                raise DistributionError("selected source inventory is malformed") from exc
            if mode not in {b"100644", b"100755"} or kind != b"blob" \
                    or not re.fullmatch(rb"[0-9a-f]{40}", object_id) or not 0 <= size <= MAX_BYTES \
                    or len(path) > 512 or provenance.path_problem(view, path) \
                    or any(part.casefold() == ".git" for part in path.split("/")) \
                    or path.casefold() in folded:
                raise DistributionError("selected source must contain safe regular files only")
            total += size
            if total > MAX_SOURCE_BYTES:
                raise DistributionError("selected source bytes exceed the validation bound")
            content = git(root, "cat-file", "blob", object_id.decode("ascii"))
            if len(content) != size:
                raise DistributionError("selected source blob size is inconsistent")
            target = view / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            tracked.add(path)
            folded.add(path.casefold())
        problems = provenance.validate_register(view, register, tracked)
        records = register.get("records", []) if isinstance(register, dict) else []
        registered = {record["path"] for record in records
                      if isinstance(record, dict) and isinstance(record.get("path"), str)} \
            if isinstance(records, list) else set()
        problems += provenance.validate_allowlist_shape(view, allowlist, registered, tracked)
        if not problems and production:
            problems = provenance.production_problems(view, register, allowlist)
        if problems:
            raise DistributionError("selected source provenance/allowlist blocks approved packaging"
                                    if production else "selected source provenance register is invalid")
    return register, allowlist


def source_package(root: Path, source: str, mode: str) -> tuple[dict[str, bytes], dict]:
    """Derive every package claim and member from the pinned source, not its manifest."""
    if mode not in {"review", "approved"}:
        raise DistributionError("unknown packaging mode")
    if not isinstance(source, str) or not SHA.fullmatch(source):
        raise DistributionError("a full immutable source SHA is required")
    tree = git(root, "rev-parse", source + "^{tree}").decode().strip()
    proposal = load_proposal(root, source)
    register, allowlist = source_provenance(root, source, mode == "approved")
    records = {r["path"]: r for r in register["records"]}
    version, approval = None, None
    paths = proposal["paths"]
    if mode == "approved":
        approval, problems = accepted_record(root, source)
        if problems:
            raise DistributionError("distribution/version/font decisions remain unapproved")
        version = approval["brand_version"]
        paths = [e["path"] for e in allowlist["entries"]]
    if not TOKEN_PATHS | {"logo/wordmark.svg"} <= set(paths):
        raise DistributionError("the selected subset omits a required documented import")
    blobs, entries = {}, []
    for path in sorted(paths):
        if not supported_path(path):
            raise DistributionError("export path is unsupported; fonts and references cannot be packaged")
        content = source_blob(root, source, path)
        record = records.get(path)
        blobs[PREFIX + path] = content
        entries.append({"path": path, "sha256": digest(content), "size_bytes": len(content),
                        "provenance": None if record is None else {
                            "classification": record["classification"], "rights_status": record["rights_status"],
                            "approval": record["approval"], "reviewer": record["reviewer"],
                            "notice_files": record["notice_files"]}})
    files_digest = file_set_digest(entries)
    if approval:
        if any(approval[k]["files_digest"] != files_digest for k in ("distribution", "font_delivery")):
            raise DistributionError("distribution/font approval is stale for this exact file set")
        # The referenced review revision must contain exactly the same exported bytes.
        for entry in entries:
            if digest(source_blob(root, approval["source_sha"], entry["path"])) != entry["sha256"]:
                raise DistributionError("reviewed source bytes do not match the selected export")
    profile = parse_json(source_blob(root, source, "tokens/profile.json"))
    manifest = {"schema_version": 1, "kind": "review_candidate" if mode == "review" else "approved_subset",
                "source_sha": source, "source_tree": tree, "brand_version": version,
                "token_profile": {"name": profile["profile"], "version": profile["version"]},
                "proposal_sha256": digest(source_blob(root, source, PROPOSAL)),
                "distribution_decision": None if approval is None else {
                    "source_sha": approval["source_sha"], "distribution": approval["distribution"],
                    "font_delivery": approval["font_delivery"]},
                "files_digest": files_digest, "font_policy": proposal["font_policy"],
                "files": entries, "release_approved": False,
                "limitations": ["Unsigned local source archive; hashes establish integrity, not rights or authority.",
                    "No publication, customer capability, consumer adoption or global acceptance is asserted.",
                    "Review candidates are unapproved and cannot be used as a released distribution."]}
    if sum(len(v) for v in blobs.values()) > MAX_BYTES:
        raise DistributionError("archive exceeds the size bound")
    return blobs, manifest


def build_bytes(root: Path, mode: str = "review") -> tuple[bytes, dict]:
    source, tree = source_identity(root)
    blobs, manifest = source_package(root, source, mode)
    blobs[MANIFEST] = canonical(manifest)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for path, content in sorted(blobs.items()):
            info = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_STORED
            archive.writestr(info, content)
    if source_identity(root) != (source, tree):
        raise DistributionError("candidate source changed during packaging")
    verify_bytes(output.getvalue(), digest(output.getvalue()), source)
    return output.getvalue(), manifest


def verify_bytes(data: bytes, expected_sha256: str, source: str) -> tuple[dict, dict[str, bytes]]:
    if not isinstance(source, str) or not SHA.fullmatch(source):
        raise DistributionError("consumer must pin a full immutable source SHA")
    if len(data) > MAX_BYTES * 2:
        raise DistributionError("archive exceeds the size bound")
    if not isinstance(expected_sha256, str) or not DIGEST.fullmatch(expected_sha256) or digest(data) != expected_sha256:
        raise DistributionError("archive does not match the separately supplied SHA-256 pin")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            if not 1 < len(infos) <= MAX_FILES + 1 or sum(i.file_size for i in infos) > MAX_BYTES:
                raise DistributionError("archive member count or expanded size exceeds the bound")
            seen, blobs = set(), {}
            for info in infos:
                name = info.filename
                relative = name[len(PREFIX):] if name.startswith(PREFIX) else None
                if name.casefold() in seen or not safe_path(relative) or (name != MANIFEST and not supported_path(relative)):
                    raise DistributionError("archive contains duplicate, unsafe or unauthorized paths")
                seen.add(name.casefold())
                if info.compress_type != zipfile.ZIP_STORED or info.flag_bits & 1 \
                        or info.is_dir() or info.external_attr >> 16 != 0o100644:
                    raise DistributionError("archive must contain regular stored files only")
                blobs[name] = archive.read(info)
    except (zipfile.BadZipFile, KeyError, RuntimeError) as exc:
        raise DistributionError("archive cannot be verified") from exc
    if MANIFEST not in blobs:
        raise DistributionError("archive manifest is missing")
    manifest = parse_json(blobs[MANIFEST])
    keys = {"schema_version", "kind", "source_sha", "source_tree", "brand_version", "token_profile",
            "proposal_sha256", "distribution_decision", "files_digest", "font_policy", "files", "release_approved", "limitations"}
    if not isinstance(manifest, dict) or set(manifest) != keys or type(manifest["schema_version"]) is not int or manifest["schema_version"] != 1 \
            or manifest["source_sha"] != source or not isinstance(manifest["source_tree"], str) \
            or not SHA.fullmatch(manifest["source_tree"]) or manifest["release_approved"] is not False:
        raise DistributionError("manifest identity or release claims are invalid")
    if not isinstance(manifest["kind"], str) or manifest["kind"] not in {"review_candidate", "approved_subset"} \
            or not isinstance(manifest["font_policy"], dict) or manifest["font_policy"].get("self_hosted") is not False:
        raise DistributionError("manifest mode or font policy is invalid")
    if not isinstance(manifest["proposal_sha256"], str) or not DIGEST.fullmatch(manifest["proposal_sha256"]) \
            or not isinstance(manifest["token_profile"], dict) or set(manifest["token_profile"]) != {"name", "version"} \
            or not all(isinstance(v, str) and v for v in manifest["token_profile"].values()) \
            or not isinstance(manifest["limitations"], list) or not manifest["limitations"] \
            or not all(isinstance(v, str) and v for v in manifest["limitations"]):
        raise DistributionError("manifest proposal/profile/limitations metadata is invalid")
    entries = manifest["files"]
    if not isinstance(entries, list) or not entries:
        raise DistributionError("manifest has no file inventory")
    paths = []
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"path", "sha256", "size_bytes", "provenance"} \
                or not supported_path(entry["path"]) or not isinstance(entry["sha256"], str) \
                or not DIGEST.fullmatch(entry["sha256"]):
            raise DistributionError("manifest file descriptor is invalid")
        path = PREFIX + entry["path"]
        if path not in blobs or type(entry["size_bytes"]) is not int \
                or entry["size_bytes"] != len(blobs[path]) or digest(blobs[path]) != entry["sha256"]:
            raise DistributionError("manifest file bytes are missing or mismatched")
        paths.append(path)
    if len(set(paths)) != len(paths) or set(paths) | {MANIFEST} != set(blobs) \
            or paths != sorted(paths) or manifest["files_digest"] != file_set_digest(entries):
        raise DistributionError("manifest file set is incomplete, duplicated or stale")
    if manifest["kind"] == "review_candidate":
        if manifest["brand_version"] is not None or manifest["distribution_decision"] is not None:
            raise DistributionError("review archive cannot claim a release version or decision")
    else:
        decision = manifest["distribution_decision"]
        version = manifest["brand_version"]
        if not isinstance(version, str) or not VERSION.fullmatch(version) \
                or not isinstance(decision, dict) or set(decision) != {"source_sha", "distribution", "font_delivery"} \
                or not isinstance(decision["source_sha"], str) or not SHA.fullmatch(decision["source_sha"]):
            raise DistributionError("approved subset is missing its exact decision records")
        for field in ("distribution", "font_delivery"):
            if review_problems(decision[field], field) or decision[field]["files_digest"] != manifest["files_digest"]:
                raise DistributionError("approved subset decision is absent or stale")
        for entry in entries:
            record = entry["provenance"]
            if not isinstance(record, dict) or record.get("rights_status") != "cleared" \
                    or not isinstance(record.get("approval"), dict) or record["approval"].get("status") != "approved":
                raise DistributionError("approved subset contains unapproved provenance")
    return manifest, blobs


def verify_source(root: Path, source: str, manifest: dict, blobs: dict[str, bytes]) -> None:
    """Recompute eligibility and all metadata before executing any extracted preset.

    Integrity alone cannot establish mode, rights, approval, policy or path selection.
    An approved-mode request must pass the pinned source's real production checks;
    unknown rights cannot be promoted by changing and resealing a manifest.
    """
    modes = {"review_candidate": "review", "approved_subset": "approved"}
    if not isinstance(manifest.get("kind"), str) or manifest["kind"] not in modes:
        raise DistributionError("archive mode is unsupported")
    expected_blobs, expected_manifest = source_package(root, source, modes[manifest["kind"]])
    if manifest != expected_manifest:
        raise DistributionError("archive metadata differs from its selected committed source")
    if {path: content for path, content in blobs.items() if path != MANIFEST} != expected_blobs:
        raise DistributionError("consumer archive bytes differ from the selected committed source")


def write_new(path: Path, content: bytes) -> None:
    """Never overwrite source/evidence or follow an output symlink."""
    path = path.absolute()
    for parent in (path, *path.parents):
        if parent.is_symlink():
            raise DistributionError("output path may not traverse a symlink")
    if path.exists():
        raise DistributionError("output already exists; choose a fresh evidence path")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as handle:
        handle.write(content)


def check(root: Path) -> dict:
    first, manifest = build_bytes(root)
    second, _ = build_bytes(root)
    if first != second:
        raise DistributionError("two review builds differ")
    verified, _ = verify_bytes(first, digest(first), manifest["source_sha"])
    return {"mode": "offline_review_candidate", "source_sha": manifest["source_sha"],
            "archive_sha256": digest(first), "files_digest": verified["files_digest"],
            "file_count": len(verified["files"]), "deterministic": True,
            "release_approved": False, "toolchain": {"python": sys.version.split()[0], "zip": "ZIP_STORED"}}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("build")
    build.add_argument("--mode", choices=("review", "approved"), default="approved")
    build.add_argument("--out", type=Path, required=True)
    commands.add_parser("check")
    verify = commands.add_parser("verify")
    verify.add_argument("archive", type=Path)
    verify.add_argument("--sha256", required=True)
    verify.add_argument("--source", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "build":
            data, manifest = build_bytes(args.root.resolve(), args.mode)
            write_new(args.out, data)
            print(json.dumps({"source_sha": manifest["source_sha"], "archive_sha256": digest(data),
                              "files_digest": manifest["files_digest"], "kind": manifest["kind"],
                              "release_approved": False}, sort_keys=True))
        elif args.command == "check":
            print(json.dumps(check(args.root.resolve()), sort_keys=True))
        else:
            data = read_archive(args.archive)
            manifest, _ = verify_bytes(data, args.sha256, args.source)
            print(json.dumps({"integrity": "pass", "kind": manifest["kind"], "release_approved": False}))
    except DistributionError as exc:
        print("BLOCKED " + str(exc))
        return 1
    except (OSError, ValueError, TypeError, KeyError, AttributeError, RecursionError):
        print("BLOCKED package validation/build failed; inspect approved inputs, clean source, pins and output path (input values withheld)")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
