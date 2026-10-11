#!/usr/bin/env python3
"""Build and validate a truthful, versioned collateral handoff.

This tool uses only local tracked files and the Python standard library. A
BLOCKED manifest is useful review evidence; it is never promoted automatically.
It does not post, upload, call a paid provider, or grant rights.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import mimetypes
import os
import posixpath
import platform
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VERSION = "v0.1.0-rehearsal"
HEX40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
TIMESTAMP = re.compile(
    r"(?P<start>(?:\d{2}:)?\d{2}:\d{2}[,.]\d{3})\s+-->\s+"
    r"(?P<end>(?:\d{2}:)?\d{2}:\d{2}[,.]\d{3})"
)
TEXT_FORMATS = {".md", ".txt", ".json", ".html", ".srt", ".vtt"}
POLICY_HASH_ALGORITHM = "sha256-canonical-json-self-reference-projection-v2"
POLICY_JSON_BINDINGS = {
    "docs/collateral-inventory.json": {
        "kind": "canonical_json_semantic_field_binding",
        "algorithm": POLICY_HASH_ALGORITHM,
        "selectors": [
            "trackedFiles[path=release/v0.1.0-rehearsal/manifest.json].sha256",
            "trackedFiles[path=release/v0.1.0-rehearsal/manifest.json].trackedAtRevision",
        ],
    },
    "review/provenance.json": {
        "kind": "canonical_json_semantic_field_binding",
        "algorithm": POLICY_HASH_ALGORITHM,
        "selectors": [
            "records[assetId=HANDOFF-MANIFEST-001].source.revision",
            "records[assetId=HANDOFF-MANIFEST-001].source.url",
            "records[assetId=HANDOFF-MANIFEST-001].checksum.value",
            "records[assetId=PROV-FILE-E018FDB8D981].source.revision",
            "records[assetId=PROV-FILE-E018FDB8D981].checksum.value",
        ],
    },
}
EXPECTED_POLICY_SELECTABLE_ASSET_IDS = {
    "DEMO-WORKFLOW-DIAGRAM-001",
    "DEMO-SCREENSHOT-SET-001",
    "DEMO-DECK-SUPPORT-001",
    "LAUNCH-X-KEY-VISUAL-001",
    "LAUNCH-X-ALT-TEXT-001",
}


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> Dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("top-level JSON value must be an object")
    return value


def safe_path(root: Path, relative: str) -> Path:
    """Resolve a repository-relative path without accepting escapes/symlinks."""
    candidate = PurePosixPath(relative)
    if candidate.is_absolute() or ".." in candidate.parts or not candidate.parts:
        raise ValueError("path must be a non-empty repository-relative path")
    path = root.joinpath(*candidate.parts)
    if path.is_symlink():
        raise ValueError("symlink inputs are not accepted")
    resolved_root = root.resolve()
    resolved_path = path.resolve(strict=False)
    try:
        resolved_path.relative_to(resolved_root)
    except ValueError as exc:
        raise ValueError("path resolves outside the repository") from exc
    return path


def git(root: Path, *args: str) -> Optional[str]:
    try:
        completed = subprocess.run(
            ["git", "-C", str(root), *args],
            check=True,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None
    return completed.stdout.strip()


def repo_head(root: Path) -> Optional[str]:
    value = git(root, "rev-parse", "HEAD")
    return value if value and HEX40.fullmatch(value) else None


def committed_source(root: Path, relative: str, current_hash: Optional[str]) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "commitId": None,
        "blobObjectId": None,
        "tracked": False,
        "workingTreeClean": False,
        "status": "untracked_or_missing",
    }
    if not current_hash:
        return result
    tracked = git(root, "ls-files", "--error-unmatch", "--", relative)
    if tracked is None:
        return result
    result["tracked"] = True
    status = git(root, "status", "--porcelain", "--", relative)
    result["workingTreeClean"] = status == ""
    commit = git(root, "log", "-1", "--format=%H", "--", relative)
    if not commit or not HEX40.fullmatch(commit) or status:
        result["status"] = "tracked_but_modified_or_uncommitted"
        return result
    blob = git(root, "rev-parse", f"{commit}:{relative}")
    committed_bytes = git_bytes(root, "show", f"{commit}:{relative}")
    if not blob or committed_bytes is None or sha256_bytes(committed_bytes) != current_hash:
        result["status"] = "commit_bytes_do_not_match_worktree"
        return result
    result.update(
        {
            "commitId": commit,
            "blobObjectId": blob,
            "status": "pinned",
        }
    )
    return result


def git_bytes(root: Path, *args: str) -> Optional[bytes]:
    try:
        completed = subprocess.run(
            ["git", "-C", str(root), *args],
            check=True,
            capture_output=True,
            timeout=15,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None
    return completed.stdout


def _parse_svg_length(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)(?:px)?\s*", value)
    return round(float(match.group(1))) if match else None


def media_dimensions(path: Path, relative: str) -> Dict[str, Any]:
    suffix = path.suffix.lower()
    result: Dict[str, Any] = {
        "width": None,
        "height": None,
        "aspectRatio": None,
        "status": "not_applicable",
    }
    if not path.is_file():
        result["status"] = "missing_file"
        return result
    if suffix == ".png":
        data = path.read_bytes()
        if len(data) >= 24 and data[:8] == b"\x89PNG\r\n\x1a\n" and data[12:16] == b"IHDR":
            result.update(width=int.from_bytes(data[16:20], "big"), height=int.from_bytes(data[20:24], "big"), status="read_from_png_ihdr")
    elif suffix == ".svg":
        try:
            element = ET.parse(str(path)).getroot()
            width = _parse_svg_length(element.attrib.get("width"))
            height = _parse_svg_length(element.attrib.get("height"))
            if width is None or height is None:
                viewbox = re.split(r"[\s,]+", element.attrib.get("viewBox", "").strip())
                if len(viewbox) == 4:
                    width = width or round(float(viewbox[2]))
                    height = height or round(float(viewbox[3]))
            if width and height:
                result.update(width=width, height=height, status="read_from_svg_dimensions")
        except (ET.ParseError, OSError, ValueError):
            result["status"] = "invalid_svg_dimensions"
    elif suffix in {".jpg", ".jpeg"}:
        dimensions = _jpeg_dimensions(path.read_bytes())
        if dimensions:
            result.update(width=dimensions[0], height=dimensions[1], status="read_from_jpeg_frame")
    elif suffix == ".gif":
        data = path.read_bytes()
        if len(data) >= 10 and data[:6] in {b"GIF87a", b"GIF89a"}:
            result.update(width=int.from_bytes(data[6:8], "little"), height=int.from_bytes(data[8:10], "little"), status="read_from_gif_header")
    elif suffix == ".mp4":
        probe = probe_video(path)
        if probe:
            result.update(
                {
                    "width": probe.get("width"),
                    "height": probe.get("height"),
                    "aspectRatio": None,
                    "status": "read_with_ffprobe",
                    "durationSeconds": probe.get("durationSeconds"),
                    "videoCodec": probe.get("videoCodec"),
                    "audioStreamCount": probe.get("audioStreamCount"),
                }
            )
        else:
            result["status"] = "ffprobe_missing_or_failed"
    elif suffix == ".html":
        result["status"] = "responsive_no_intrinsic_dimensions"
    elif suffix in TEXT_FORMATS:
        result["status"] = "not_applicable_text_or_caption"
    else:
        result["status"] = "format_dimension_probe_not_implemented"
    width = result.get("width")
    height = result.get("height")
    if width and height:
        divisor = math.gcd(int(width), int(height))
        result["aspectRatio"] = f"{int(width) // divisor}:{int(height) // divisor}"
    return result


def _jpeg_dimensions(data: bytes) -> Optional[Tuple[int, int]]:
    if not data.startswith(b"\xff\xd8"):
        return None
    index = 2
    while index + 4 <= len(data):
        if data[index] != 0xFF:
            index += 1
            continue
        marker = data[index + 1]
        index += 2
        if marker in {0xD8, 0xD9} or 0xD0 <= marker <= 0xD7:
            continue
        if index + 2 > len(data):
            break
        length = int.from_bytes(data[index : index + 2], "big")
        if length < 2 or index + length > len(data):
            break
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF} and length >= 7:
            height = int.from_bytes(data[index + 3 : index + 5], "big")
            width = int.from_bytes(data[index + 5 : index + 7], "big")
            return width, height
        index += length
    return None


def probe_video(path: Path) -> Optional[Dict[str, Any]]:
    try:
        completed = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_type,codec_name,width,height",
                "-of",
                "json",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
        payload = json.loads(completed.stdout)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return None
    streams = payload.get("streams", [])
    video = next((row for row in streams if row.get("codec_type") == "video"), {})
    audio_count = sum(row.get("codec_type") == "audio" for row in streams)
    duration = payload.get("format", {}).get("duration")
    return {
        "width": video.get("width"),
        "height": video.get("height"),
        "durationSeconds": float(duration) if duration else None,
        "videoCodec": video.get("codec_name"),
        "audioStreamCount": audio_count,
    }


def format_details(path: Path) -> Dict[str, Any]:
    suffix = path.suffix.lower()
    names = {
        ".svg": "SVG",
        ".png": "PNG",
        ".jpg": "JPEG",
        ".jpeg": "JPEG",
        ".gif": "GIF",
        ".html": "HTML",
        ".md": "Markdown",
        ".json": "JSON",
        ".mp4": "MP4",
        ".srt": "SubRip SRT",
        ".vtt": "WebVTT",
        ".txt": "Plain text",
    }
    return {
        "extension": suffix.lstrip("."),
        "name": names.get(suffix, suffix.lstrip(".").upper() or "unknown"),
        "mediaType": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
    }


def _token(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9]+", "-", value).strip("-").lower()
    return re.sub(r"-+", "-", value) or "unnamed"


def package_filename(row: Dict[str, Any], source: Path, dimensions: Dict[str, Any], spec: Dict[str, Any]) -> str:
    family = _token(row.get("familyIds", ["support"])[0].replace("FAM-", ""))
    asset_id = _token(row["assetId"])
    destination = _token(spec.get("internalDestination", "internal-review"))
    width, height = dimensions.get("width"), dimensions.get("height")
    if width and height:
        dimension_token = f"{width}x{height}"
    elif dimensions.get("status") == "responsive_no_intrinsic_dimensions":
        dimension_token = "responsive"
    else:
        dimension_token = "text"
    locale = _token(spec.get("locale", "en-US"))
    revision = spec.get("assetRevision", "r01")
    if not re.fullmatch(r"r\d{2,}", revision):
        raise ValueError("assetRevision must use rNN, such as r01")
    return "-".join(
        [family, asset_id, revision, destination, dimension_token, locale, _token(row["variant"])]
    ) + source.suffix.lower()


def _safe_package_relative(relative: str) -> str:
    path = PurePosixPath(relative)
    if path.is_absolute() or not path.parts or ".." in path.parts or "\\" in relative or path.as_posix() != relative:
        raise ValueError("package-relative path must be normalized and remain inside its version directory")
    return path.as_posix()


def _package_asset_path(row: Dict[str, Any], output_name: str, version: str) -> str:
    directory = _safe_package_relative(row.get("packageDirectory", "assets"))
    return f"release/{version}/{directory}/{output_name}"


def _package_dependency_path(relative: str, version: str) -> str:
    normalized = _safe_package_relative(relative)
    return f"release/{version}/{normalized}"


def resolve_package_reference(entrypoint_path: str, reference: str, version: str) -> Optional[str]:
    """Resolve a local HTML reference within one versioned package directory."""
    package_root = PurePosixPath("release") / version
    entrypoint = PurePosixPath(entrypoint_path)
    try:
        entry_relative = entrypoint.relative_to(package_root)
    except ValueError as exc:
        raise ValueError("package entrypoint is outside the selected release directory") from exc
    parsed = urlsplit(reference)
    if parsed.scheme or parsed.netloc:
        return None
    if not parsed.path:
        return None
    if parsed.path.startswith("/") or "\\" in parsed.path:
        raise ValueError("absolute or backslash package references are not allowed")
    decoded = unquote(parsed.path)
    if "\\" in decoded:
        raise ValueError("backslash package references are not allowed")
    target = posixpath.normpath(posixpath.join(entry_relative.parent.as_posix(), decoded))
    if target in {".", ".."} or target.startswith("../"):
        raise ValueError("package reference escapes its version directory")
    return (package_root / PurePosixPath(target)).as_posix()


class _HTMLLocalReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.references: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        for name, value in attrs:
            if name.lower() in {"src", "href"} and value:
                self.references.append(value)

    def handle_startendtag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        self.handle_starttag(tag, attrs)


def html_local_references(path: Path) -> List[str]:
    parser = _HTMLLocalReferenceParser()
    parser.feed(path.read_text(encoding="utf-8"))
    parser.close()
    return _unique(parser.references)


def package_composition_reference_errors(
    entrypoint_path: str,
    references: Sequence[str],
    dependencies: Sequence[Dict[str, Any]],
    version: str,
) -> List[str]:
    errors: List[str] = []
    dependency_by_reference: Dict[str, List[Dict[str, Any]]] = {}
    for dependency in dependencies:
        reference = dependency.get("relativeReference")
        if not isinstance(reference, str) or not reference:
            errors.append("composition dependency is missing its exact relativeReference")
            continue
        dependency_by_reference.setdefault(reference, []).append(dependency)
    for reference in references:
        try:
            resolved = resolve_package_reference(entrypoint_path, reference, version)
        except ValueError as exc:
            errors.append(f"HTML reference {reference!r} is unsafe: {exc}")
            continue
        if resolved is None:
            continue
        matches = dependency_by_reference.get(reference, [])
        if len(matches) != 1:
            errors.append(f"HTML reference {reference!r} requires exactly one declared contextual dependency")
            continue
        declared = matches[0].get("packageCopy", {}).get("path")
        if declared != resolved or matches[0].get("resolvedPackagePath") != resolved or matches[0].get("resolutionStatus") != "matches_declared_package_path":
            errors.append(f"HTML reference {reference!r} does not resolve to its exact declared package dependency")
    for reference in dependency_by_reference:
        if reference not in references:
            errors.append(f"declared contextual dependency {reference!r} is not referenced by the HTML entrypoint")
    return errors


def _load_context(root: Path, version: str) -> Dict[str, Any]:
    spec_path = safe_path(root, f"release/{version}/package-spec.json")
    spec = read_json(spec_path)
    if spec.get("packageVersion") != version:
        raise ValueError("package spec version does not match requested version")
    paths = {
        "inventory": "docs/collateral-inventory.json",
        "claims": "messaging/claims.json",
        "provenance": "review/provenance.json",
        "sceneMap": "demo/rehearsal-scenes.json",
        "assetHandoff": "review/visual/asset-handoff.json",
        "brand": "review/visual/brand-comparison.json",
        "officialFormats": "review/official-format-sources.json",
    }
    documents: Dict[str, Any] = {"spec": spec, "specPath": spec_path}
    for key, relative in paths.items():
        path = safe_path(root, relative)
        if path.is_file():
            documents[key] = read_json(path)
        else:
            documents[key] = None
    for key, relative in (
        ("brandConsumption", "review/brand-consumption.md"),
        ("renderEvidence", "review/visual/browser-render-evidence.json"),
        ("narration", "demo/narration.md"),
    ):
        path = safe_path(root, relative)
        if path.is_file() and relative.endswith(".json"):
            documents[key] = read_json(path)
        else:
            documents[key] = path.read_text(encoding="utf-8") if path.is_file() else None
    documents["gitHead"] = repo_head(root)
    documents["claimById"] = {
        row.get("id"): row
        for row in (documents.get("claims") or {}).get("claims", [])
        if isinstance(row, dict)
    }
    documents["ctaById"] = {
        row.get("id"): row
        for row in (documents.get("claims") or {}).get("ctas", [])
        if isinstance(row, dict)
    }
    documents["provenanceByAsset"] = {
        row.get("assetId"): row
        for row in (documents.get("provenance") or {}).get("records", [])
        if isinstance(row, dict)
    }
    documents["inventoryById"] = _inventory_by_id(documents.get("inventory") or {})
    documents["sceneById"] = {
        row.get("sceneId"): row
        for row in (documents.get("sceneMap") or {}).get("scenes", [])
        if isinstance(row, dict)
    }
    documents["sourcePinsById"] = {
        row.get("id"): row
        for row in (documents.get("sceneMap") or {}).get("sourcePins", [])
        if isinstance(row, dict)
    }
    documents["proposalById"] = {
        row.get("id"): row
        for row in (documents.get("sceneMap") or {}).get("ledgerJoinProposals", [])
        if isinstance(row, dict)
    }
    documents["handoffByAsset"] = {
        row.get("assetId"): row
        for row in (documents.get("assetHandoff") or {}).get("assets", [])
        if isinstance(row, dict)
    }
    return documents


def _inventory_by_id(inventory: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    for key in ("trackedDocumentation", "plannedDeliverables"):
        for row in inventory.get(key, []):
            if isinstance(row, dict) and row.get("assetId"):
                result[row["assetId"]] = row
    family_by_id = {row.get("familyId"): row for row in inventory.get("families", []) if isinstance(row, dict)}
    for family in inventory.get("families", []):
        if not isinstance(family, dict):
            continue
        for asset_id in family.get("plannedAssetIds", []):
            result.setdefault(asset_id, {"assetId": asset_id, "family": family})
    return result


def _scene_refs_for_path(context: Dict[str, Any], paths: Iterable[str]) -> List[str]:
    path_set = set(paths)
    result: List[str] = []
    for scene in (context.get("sceneMap") or {}).get("scenes", []):
        if scene.get("assetPath") in path_set:
            result.append(scene["sceneId"])
    return result


def _references_for_scenes(context: Dict[str, Any], scene_ids: Sequence[str]) -> Dict[str, List[Dict[str, Any]]]:
    claim_ids: List[str] = []
    cta_ids: List[str] = []
    proposal_ids: List[str] = []
    pins: List[str] = []
    for scene_id in scene_ids:
        scene = context["sceneById"].get(scene_id)
        if not scene:
            continue
        claim_ids.extend(scene.get("claimIDs", []))
        cta_ids.extend(scene.get("ctaIDs", []))
        proposal_ids.extend(scene.get("proposalIDs", []))
        pins.extend(scene.get("sourcePinIds", []))
    return {
        "claimIds": _unique(claim_ids),
        "ctaIds": _unique(cta_ids),
        "proposalIds": _unique(proposal_ids),
        "sourcePinIds": _unique(pins),
    }


def _unique(values: Iterable[str]) -> List[str]:
    seen = set()
    result = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def _file_fact(root: Path, relative: Optional[str]) -> Dict[str, Any]:
    if not relative:
        return {"path": None, "exists": False, "sha256": None, "sizeBytes": None, "sourceCommitId": None, "sourcePinStatus": "no_path"}
    try:
        path = safe_path(root, relative)
    except ValueError as exc:
        return {"path": relative, "exists": False, "sha256": None, "sizeBytes": None, "sourceCommitId": None, "sourcePinStatus": "invalid_path", "error": str(exc)}
    if not path.is_file():
        return {"path": relative, "exists": False, "sha256": None, "sizeBytes": None, "sourceCommitId": None, "sourcePinStatus": "missing"}
    checksum = sha256_file(path)
    commit = committed_source(root, relative, checksum)
    return {
        "path": relative,
        "exists": True,
        "sha256": checksum,
        "sizeBytes": path.stat().st_size,
        "sourceCommitId": commit["commitId"],
        "blobObjectId": commit["blobObjectId"],
        "tracked": commit["tracked"],
        "workingTreeClean": commit["workingTreeClean"],
        "sourcePinStatus": commit["status"],
        "format": format_details(path),
        "dimensions": media_dimensions(path, relative),
    }


def _render_receipt(root: Path, relative: Optional[str], output_path: str, output_hash: str, context: Dict[str, Any]) -> Dict[str, Any]:
    if not relative:
        return {"path": None, "sha256": None, "sourceCommitId": None, "status": "not_required"}
    fact = _file_fact(root, relative)
    status = "missing"
    match = False
    if fact["exists"]:
        evidence = context.get("renderEvidence") or {}
        for row in evidence.get("hashes", []):
            if row.get("path") == output_path and row.get("sha256") == output_hash:
                match = True
                break
        status = "matches_exact_output_sha256" if match else "missing_or_stale_output_hash"
    return {
        "path": relative,
        "sha256": fact.get("sha256"),
        "sourceCommitId": fact.get("sourceCommitId"),
        "status": status,
        "outputHashMatchesReceipt": match,
    }


def _inventory_join(context: Dict[str, Any], asset_id: str, current_path: str, file_exists: bool) -> Dict[str, Any]:
    row = context["inventoryById"].get(asset_id)
    if not row:
        return {"status": "missing_join", "assetId": asset_id, "inventoryPath": None, "disposition": None, "lifecycleState": None}
    if "family" in row:
        family = row["family"]
        return {
            "status": "missing_asset_record",
            "assetId": asset_id,
            "familyId": family.get("familyId"),
            "inventoryPath": None,
            "disposition": family.get("disposition"),
            "lifecycleState": None,
        }
    path_candidates = [row.get("path"), *row.get("editableSourceLocations", []), *row.get("exportLocations", [])]
    known = [value.rstrip("/") for value in path_candidates if isinstance(value, str) and not value.endswith("(proposed; format and dimensions require current destination check)")]
    exact_or_prefix = any(current_path == item or current_path.startswith(item.rstrip("/") + "/") for item in known)
    disposition = row.get("disposition")
    stale = (file_exists and disposition in {"planned", "deferred"}) or not exact_or_prefix
    return {
        "status": "stale" if stale else "current",
        "assetId": asset_id,
        "inventoryPath": row.get("path"),
        "disposition": disposition,
        "lifecycleState": row.get("lifecycleState"),
        "pathListed": exact_or_prefix,
    }


def _claim_snapshot(context: Dict[str, Any], claim_ids: Sequence[str]) -> List[Dict[str, Any]]:
    output = []
    for claim_id in claim_ids:
        row = context["claimById"].get(claim_id)
        if not row:
            output.append({"id": claim_id, "status": "missing_from_current_ledger"})
            continue
        source = row.get("source", {})
        output.append(
            {
                "id": claim_id,
                "allowedWording": row.get("allowedWording"),
                "requiredQualifier": row.get("requiredQualifier"),
                "state": row.get("state"),
                "reviewStatus": row.get("reviewStatus"),
                "destination": row.get("destination"),
                "source": {
                    "repo": source.get("repo"),
                    "path": source.get("path"),
                    "revision": source.get("revision"),
                    "revisionKind": source.get("revisionKind"),
                    "url": source.get("url"),
                },
            }
        )
    return output


def _cta_snapshot(context: Dict[str, Any], cta_ids: Sequence[str]) -> List[Dict[str, Any]]:
    result = []
    for cta_id in cta_ids:
        row = context["ctaById"].get(cta_id)
        if not row:
            result.append({"id": cta_id, "status": "missing_from_current_ledger"})
            continue
        result.append(
            {
                "id": cta_id,
                "exactText": row.get("exactText"),
                "destinationClass": row.get("destinationClass"),
                "target": row.get("target"),
                "availability": row.get("availability", {}).get("status"),
                "wordingReview": row.get("wordingReview"),
                "routeReview": row.get("routeReview"),
                "reviewer": row.get("reviewer"),
                "reviewDate": row.get("reviewDate"),
            }
        )
    return result


def _proposal_snapshot(context: Dict[str, Any], proposal_ids: Sequence[str]) -> List[Dict[str, Any]]:
    output = []
    for proposal_id in proposal_ids:
        row = context["proposalById"].get(proposal_id)
        output.append(
            {
                "id": proposal_id,
                "status": "proposed_pending_ledger_join" if row else "missing_proposal",
                "exactWording": row.get("exactWording", []) if row else [],
                "reason": row.get("reason") if row else None,
            }
        )
    return output


def _source_pin_snapshot(context: Dict[str, Any], pin_ids: Sequence[str], root: Path) -> List[Dict[str, Any]]:
    rows = []
    for pin_id in pin_ids:
        pin = context["sourcePinsById"].get(pin_id)
        if not pin:
            rows.append({"id": pin_id, "status": "missing_pin"})
            continue
        row = {key: pin.get(key) for key in ("id", "repo", "path", "revision", "revisionKind", "url", "evidenceClass", "providerMode", "checkedAt")}
        if pin.get("repo") == "Jevelopers-neatHack-2026/marketing-material":
            row["localFile"] = _file_fact(root, pin.get("path"))
            row["status"] = "local_source_pinned" if row["localFile"].get("sourcePinStatus") == "pinned" else "local_source_unpinned"
        elif pin.get("revision"):
            row["status"] = "external_revision_recorded"
        else:
            row["status"] = "external_revision_missing"
        rows.append(row)
    return rows


def _alt_snapshot(root: Path, relative: Optional[str]) -> Dict[str, Any]:
    if not relative:
        return {"path": None, "exists": False, "sha256": None, "sourceCommitId": None, "status": "not_linked"}
    fact = _file_fact(root, relative)
    return {
        "path": relative,
        "exists": fact["exists"],
        "sha256": fact["sha256"],
        "sourceCommitId": fact["sourceCommitId"],
        "sourcePinStatus": fact["sourcePinStatus"],
        "status": "present" if fact["exists"] else "missing",
        "format": fact.get("format"),
    }


def _asset_record(root: Path, row: Dict[str, Any], spec: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    relative = row["path"]
    fact = _file_fact(root, relative)
    path_obj = safe_path(root, relative)
    source_relative = row.get("sourcePath", relative)
    source = _file_fact(root, source_relative)
    scene_ids = _unique([*row.get("sceneRefs", []), *_scene_refs_for_path(context, [relative, source_relative])])
    scene_ref_data = _references_for_scenes(context, scene_ids)
    claim_ids = _unique([*row.get("claimIds", []), *scene_ref_data["claimIds"]])
    cta_ids = _unique([*row.get("ctaIds", []), *scene_ref_data["ctaIds"]])
    proposal_ids = _unique([*row.get("proposalIds", []), *scene_ref_data["proposalIds"]])
    pin_ids = _unique([*scene_ref_data["sourcePinIds"]])
    handoff = context["handoffByAsset"].get(row["assetId"], {})
    claim_ids = _unique([*claim_ids, *handoff.get("claimReferences", [])])
    provenance = context["provenanceByAsset"].get(row["assetId"])
    if provenance:
        provenance_ref = {
            "recordId": provenance.get("assetId"),
            "status": provenance.get("publishability"),
            "permissionStatus": provenance.get("permission", {}).get("status"),
            "allowedDestinations": provenance.get("allowedDestinations", []),
            "approvedDestinations": provenance.get("permission", {}).get("approvedDestinations", []),
            "expiry": provenance.get("expiry"),
            "reviewer": provenance.get("reviewer"),
            "reviewDate": provenance.get("reviewDate"),
        }
    else:
        provenance_ref = {
            "recordId": None,
            "status": "missing_record",
            "permissionStatus": "not_recorded",
            "allowedDestinations": [],
            "approvedDestinations": [],
            "expiry": None,
            "reviewer": None,
            "reviewDate": None,
        }
    inventory_join = _inventory_join(context, row["assetId"], relative, fact["exists"])
    output_name = package_filename(row, path_obj, fact.get("dimensions", {"status": "not_applicable"}), spec)
    package_path = _package_asset_path(row, output_name, spec["packageVersion"]) if row.get("package", True) else None
    package_fact = _file_fact(root, package_path) if package_path else {"exists": False, "sha256": None, "sourceCommitId": None}
    composition_dependencies = []
    for dependency in row.get("packageDependencies", []):
        dependency_source_path = dependency.get("sourcePath")
        dependency_package_path = _package_dependency_path(dependency.get("packagePath", ""), spec["packageVersion"])
        dependency_source = _file_fact(root, dependency_source_path)
        dependency_copy = _file_fact(root, dependency_package_path)
        try:
            resolved = resolve_package_reference(package_path or "", dependency.get("relativeReference", ""), spec["packageVersion"])
            resolution_status = "matches_declared_package_path" if resolved == dependency_package_path else "does_not_match_declared_package_path"
        except ValueError:
            resolved = None
            resolution_status = "unsafe_or_invalid_reference"
        composition_dependencies.append(
            {
                "relativeReference": dependency.get("relativeReference"),
                "resolutionStatus": resolution_status,
                "resolvedPackagePath": resolved,
                "source": {
                    "path": dependency_source_path,
                    "sha256": dependency_source.get("sha256"),
                    "sourceCommitId": dependency_source.get("sourceCommitId"),
                    "sourcePinStatus": dependency_source.get("sourcePinStatus"),
                },
                "packageCopy": {
                    "path": dependency_package_path,
                    "exists": dependency_copy.get("exists", False),
                    "sha256": dependency_copy.get("sha256"),
                    "sourceCommitId": dependency_copy.get("sourceCommitId"),
                    "expectedSha256": dependency_source.get("sha256"),
                    "byteIdenticalToSource": bool(dependency_copy.get("exists") and dependency_copy.get("sha256") == dependency_source.get("sha256")),
                },
                "role": dependency.get("role"),
            }
        )
    composition_reference_errors = []
    if path_obj.suffix.lower() == ".html" and fact["exists"] and package_path:
        composition_reference_errors = package_composition_reference_errors(
            package_path,
            html_local_references(path_obj),
            composition_dependencies,
            spec["packageVersion"],
        )
    render_receipt = _render_receipt(root, row.get("renderReceiptPath"), relative, fact.get("sha256"), context) if fact["exists"] else {"path": row.get("renderReceiptPath"), "status": "not_checked_missing_export"}
    destinations = {
        "candidateInternalUse": spec.get("internalDestination"),
        "permittedReuseDestinations": provenance_ref.get("allowedDestinations", []),
        "requestedExternalDestinations": spec.get("externalDestinationsPending", []),
        "permissionBasis": "No asset-specific external permission is inferred from repository visibility or this assignment.",
    }
    return {
        "recordId": row["recordId"],
        "assetId": row["assetId"],
        "familyIds": row.get("familyIds", []),
        "mediaClass": row.get("mediaClass"),
        "role": row.get("role"),
        "variant": row.get("variant"),
        "assetRevision": spec.get("assetRevision"),
        "locale": spec.get("locale"),
        "requiredForV1": bool(row.get("requiredForV1", False)),
        "releaseStatus": "draft" if fact["exists"] else "missing",
        "file": fact,
        "source": {
            "path": source_relative,
            "sha256": source.get("sha256"),
            "sourceCommitId": source.get("sourceCommitId"),
            "sourcePinStatus": source.get("sourcePinStatus"),
            "fileRole": "editable-source" if source_relative != relative else "same-file-source",
        },
        "packageCopy": {
            "path": package_path,
            "exists": package_fact.get("exists", False),
            "sha256": package_fact.get("sha256"),
            "sourceCommitId": package_fact.get("sourceCommitId"),
            "expectedSha256": fact.get("sha256"),
            "status": "present" if package_fact.get("exists") else ("not_selected" if not package_path else "not_materialized"),
            "byteIdenticalToSource": bool(package_fact.get("exists") and fact.get("sha256") == package_fact.get("sha256")),
        },
        "compositionDependencies": composition_dependencies,
        "compositionReferenceErrors": composition_reference_errors,
        "renderReceipt": render_receipt,
        "accessibleAlternative": _alt_snapshot(root, row.get("altTextPath")),
        "sceneIds": scene_ids,
        "claimReferences": _claim_snapshot(context, claim_ids),
        "ctaReferences": _cta_snapshot(context, cta_ids),
        "proposedWordingReferences": _proposal_snapshot(context, proposal_ids),
        "sourcePins": _source_pin_snapshot(context, pin_ids, root),
        "provenance": provenance_ref,
        "inventoryJoin": inventory_join,
        "destinations": destinations,
        "approval": {
            "status": "pending",
            "reviewerRole": row.get("reviewerRole", "Product and frontend — receiving reviewer"),
            "reviewerIdentity": None,
            "approvalDate": None,
            "independentReviewStatus": "pending",
            "brandAndRightsApprovalStatus": "pending",
        },
        "limitations": row.get("limitations", []),
        "evidenceClassification": handoff.get("evidenceClassification", "source documentation or rehearsal draft"),
        "providerMode": handoff.get("providerMode", "none or source-specific; no package paid calls"),
        "blockedClaimReferences": handoff.get("blockedClaimReferences", []),
    }


def _find_media(root: Path, directory: str, extensions: Sequence[str]) -> List[str]:
    base = safe_path(root, directory)
    if not base.is_dir():
        return []
    allowed = {extension.lower() for extension in extensions}
    return sorted(
        path.relative_to(root).as_posix()
        for path in base.rglob("*")
        if path.is_file() and path.suffix.lower() in allowed and not path.is_symlink()
    )


def _media_receipt(root: Path, directory: str, video_path: str, video_sha: str) -> Dict[str, Any]:
    base = safe_path(root, directory)
    receipts = sorted(path for path in base.rglob("*.json") if path.is_file()) if base.exists() else []
    for path in receipts:
        try:
            data = read_json(path)
        except (OSError, json.JSONDecodeError, ValueError):
            continue
        candidate_rows: List[Dict[str, Any]] = []
        for key in ("video", "media", "artifact"):
            value = data.get(key)
            if isinstance(value, dict):
                candidate_rows.append(value)
        for key in ("assets", "outputs", "artifacts", "media"):
            value = data.get(key)
            if isinstance(value, list):
                candidate_rows.extend(item for item in value if isinstance(item, dict))
        if data.get("path") or data.get("artifactPath"):
            candidate_rows.append(data)
        for item in candidate_rows:
            item_path = item.get("path", item.get("artifactPath", item.get("outputPath")))
            item_hash = item.get("sha256", item.get("checksum"))
            if item_path == video_path and item_hash == video_sha:
                return {
                    "path": path.relative_to(root).as_posix(),
                    "sha256": sha256_file(path),
                    "sourceCommitId": committed_source(root, path.relative_to(root).as_posix(), sha256_file(path))["commitId"],
                    "videoPath": item_path,
                    "videoSha256": item_hash,
                    "width": item.get("width", data.get("width")),
                    "height": item.get("height", data.get("height")),
                    "durationSeconds": item.get("durationSeconds", data.get("durationSeconds")),
                    "sceneIds": item.get("sceneIds", data.get("sceneIds", [])),
                    "sourcePaths": item.get("sourcePaths", data.get("sourcePaths", [])),
                    "toolVersions": item.get("toolVersions", data.get("toolVersions", data.get("versions", {}))),
                    "captionPaths": item.get(
                        "captionPaths",
                        data.get(
                            "captionPaths",
                            [row.get("path") for row in data.get("hashes", []) if Path(row.get("path", "")).suffix.lower() in {".srt", ".vtt"}],
                        ),
                    ),
                    "fileHashes": data.get("hashes", []),
                    "sourceCommit": data.get("sourceCommit"),
                    "silent": data.get("silent"),
                    "audioTracks": data.get("audioTracks"),
                    "independentApproval": data.get("independentApproval"),
                    "captionMetrics": data.get("captionMetrics", {}),
                    "status": "matched_video_path_and_sha256",
                }
    return {
        "path": None,
        "sha256": None,
        "sourceCommitId": None,
        "videoPath": video_path,
        "videoSha256": video_sha,
        "status": "missing_matching_rehearsal_render_receipt",
    }


def parse_caption_file(content: str, extension: str) -> List[Dict[str, Any]]:
    cues: List[Dict[str, Any]] = []
    lines = content.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    index = 0
    while index < len(lines):
        match = TIMESTAMP.search(lines[index])
        if not match:
            index += 1
            continue
        cue_text: List[str] = []
        index += 1
        while index < len(lines) and lines[index].strip():
            cue_text.append(lines[index].strip())
            index += 1
        text_value = re.sub(r"<[^>]*>", "", " ".join(cue_text))
        cues.append(
            {
                "startSeconds": _parse_caption_time(match.group("start")),
                "endSeconds": _parse_caption_time(match.group("end")),
                "text": html.unescape(text_value),
            }
        )
    return cues


def _parse_caption_time(value: str) -> float:
    value = value.replace(",", ".")
    parts = value.split(":")
    seconds = float(parts[-1])
    minutes = int(parts[-2])
    hours = int(parts[-3]) if len(parts) == 3 else 0
    return hours * 3600 + minutes * 60 + seconds


def validate_receipt_sources(root: Path, receipt: Dict[str, Any]) -> List[str]:
    """Require each declared render input hash to match both its current bytes and source commit."""
    errors: List[str] = []
    source_paths = receipt.get("sourcePaths", [])
    if not source_paths:
        return ["render receipt is missing its source path list"]
    source_commit = receipt.get("sourceCommit")
    if not isinstance(source_commit, str) or not HEX40.fullmatch(source_commit):
        return ["render receipt source commit is missing or invalid"]
    hashes = receipt.get("fileHashes", [])
    for relative in source_paths:
        try:
            path = safe_path(root, relative)
        except (TypeError, ValueError) as exc:
            errors.append(f"render receipt source {relative}: {exc}")
            continue
        matches = [row for row in hashes if row.get("path") == relative]
        if len(matches) != 1 or not SHA256.fullmatch(str(matches[0].get("sha256", ""))):
            errors.append(f"render receipt source {relative}: exact source SHA-256 is missing or duplicated")
            continue
        expected_sha = matches[0]["sha256"]
        if not path.is_file():
            errors.append(f"render receipt source {relative}: source file is missing")
            continue
        if sha256_file(path) != expected_sha:
            errors.append(f"render receipt source {relative}: current bytes differ from the source snapshot used for rendering")
        committed_bytes = git_bytes(root, "show", f"{source_commit}:{relative}")
        if committed_bytes is None or sha256_bytes(committed_bytes) != expected_sha:
            errors.append(f"render receipt source {relative}: source commit does not contain the recorded source bytes")
    return errors


def validate_caption_content(root: Path, caption_path: str, scenes: Sequence[Dict[str, Any]]) -> List[str]:
    errors = []
    path = safe_path(root, caption_path)
    if not path.is_file():
        return [f"{caption_path}: caption sidecar is missing"]
    cues = parse_caption_file(path.read_text(encoding="utf-8"), path.suffix.lower())
    if not cues:
        errors.append(f"{caption_path}: no timed caption cues were found")
        return errors
    normalized = lambda value: re.sub(r"\s+", "", value)
    observed = normalized("".join(cue["text"] for cue in cues))
    expected = normalized("".join(scene.get("captionText", "") for scene in scenes))
    if observed != expected:
        errors.append(f"{caption_path}: concatenated caption cues do not exactly reproduce the scene caption text")
    previous_end = 0.0
    covered: set = set()
    for cue in cues:
        if cue["startSeconds"] < previous_end - 0.001 or cue["endSeconds"] <= cue["startSeconds"]:
            errors.append(f"{caption_path}: cue times are reversed or overlapping")
        previous_end = cue["endSeconds"]
        overlaps = [
            scene for scene in scenes
            if cue["startSeconds"] < float(scene["endSeconds"]) - 0.001
            and cue["endSeconds"] > float(scene["startSeconds"]) + 0.001
        ]
        if len(overlaps) != 1:
            errors.append(f"{caption_path}: each caption cue must sit inside exactly one timed scene")
            continue
        scene = overlaps[0]
        covered.add(scene.get("sceneId"))
        if cue["startSeconds"] < float(scene["startSeconds"]) - 0.5 or cue["endSeconds"] > float(scene["endSeconds"]) + 0.5:
            errors.append(f"{caption_path}: caption cue crosses its {scene.get('sceneId')} scene boundary")
    missing_scenes = [scene.get("sceneId") for scene in scenes if scene.get("sceneId") not in covered]
    if missing_scenes:
        errors.append(f"{caption_path}: no caption cue covers scenes {', '.join(missing_scenes)}")
    return errors


def _dynamic_video_records(root: Path, spec: Dict[str, Any], context: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[str]]:
    discovery = spec.get("rehearsalDiscovery", {})
    video_paths = _find_media(root, discovery.get("videoRoot", "demo/exports"), discovery.get("acceptedVideoExtensions", [".mp4"]))
    caption_paths = _find_media(root, discovery.get("captionRoot", "demo/captions"), discovery.get("captionExtensions", [".srt", ".vtt"]))
    review_root = discovery.get("reviewRoot", "review/visual/rehearsal")
    review_files = _find_media(root, review_root, [".json", ".png", ".jpg", ".jpeg", ".md", ".txt"])
    scenes = (context.get("sceneMap") or {}).get("scenes", [])
    all_scene_ids = [scene.get("sceneId") for scene in scenes]
    scene_refs = _references_for_scenes(context, all_scene_ids)
    video_records: List[Dict[str, Any]] = []
    caption_records: List[Dict[str, Any]] = []
    errors: List[str] = []
    for video_path in video_paths:
        fact = _file_fact(root, video_path)
        dimensions = fact.get("dimensions", {})
        stem = Path(video_path).stem
        matching = [path for path in caption_paths if Path(path).stem == stem]
        receipt = _media_receipt(root, review_root, video_path, fact.get("sha256"))
        source_errors = validate_receipt_sources(root, receipt)
        receipt["sourceInputStatus"] = "exact_current_source_snapshot" if not source_errors else "stale_or_invalid_source_snapshot"
        receipt["sourceInputErrors"] = source_errors
        for error in source_errors:
            errors.append(error)
        if not matching and len(video_paths) == 1:
            receipt_paths = receipt.get("captionPaths", [])
            matching = [path for path in caption_paths if path in receipt_paths]
            if not matching and len(caption_paths) == 2 and {Path(path).suffix.lower() for path in caption_paths} == {".srt", ".vtt"}:
                matching = list(caption_paths)
        srt_paths = [path for path in matching if Path(path).suffix.lower() == ".srt"]
        vtt_paths = [path for path in matching if Path(path).suffix.lower() == ".vtt"]
        if len(srt_paths) != 1:
            errors.append(f"{video_path}: expected one same-stem SRT caption file; found {len(srt_paths)}")
        if len(vtt_paths) != 1:
            errors.append(f"{video_path}: expected one same-stem VTT caption file; found {len(vtt_paths)}")
        for caption_path in [*srt_paths, *vtt_paths]:
            for error in validate_caption_content(root, caption_path, scenes):
                errors.append(error)
            caption_fact = _file_fact(root, caption_path)
            cap_name = package_filename(
                {"familyIds": ["FAM-DEMO-001"], "assetId": "DEMO-REHEARSAL-CAPTIONS-001", "variant": "silent-rehearsal-captions", "recordId": "captions"},
                safe_path(root, caption_path),
                caption_fact.get("dimensions", {"status": "not_applicable_text_or_caption"}),
                spec,
            )
            cap_package = f"release/{spec['packageVersion']}/assets/{cap_name}"
            cap_copy = _file_fact(root, cap_package)
            receipt_caption_match = any(
                row.get("path") == caption_path and row.get("sha256") == caption_fact.get("sha256")
                for row in receipt.get("fileHashes", [])
            )
            if not receipt_caption_match:
                errors.append(f"{caption_path}: render receipt does not pin the exact caption SHA-256")
            caption_records.append(
                {
                    "recordId": f"{Path(caption_path).stem}-{Path(caption_path).suffix[1:]}",
                    "assetId": "DEMO-REHEARSAL-CAPTIONS-001",
                    "role": "timed-accessible-caption-sidecar",
                    "path": caption_fact["path"],
                    "sha256": caption_fact["sha256"],
                    "sourceCommitId": caption_fact["sourceCommitId"],
                    "format": caption_fact["format"],
                    "packageCopy": {
                        "path": cap_package,
                        "exists": cap_copy.get("exists", False),
                        "sha256": cap_copy.get("sha256"),
                        "expectedSha256": caption_fact.get("sha256"),
                        "byteIdenticalToSource": bool(cap_copy.get("exists") and cap_copy.get("sha256") == caption_fact.get("sha256")),
                    },
                    "sceneIds": all_scene_ids,
                    "mediaClass": "accessible-alternative",
                    "captionCueCount": len(parse_caption_file(safe_path(root, caption_path).read_text(encoding="utf-8"), Path(caption_path).suffix.lower())),
                    "renderReceiptStatus": "matches_exact_caption_hash" if receipt_caption_match else "missing_caption_hash_from_receipt",
                    "status": "draft_rehearsal_only",
                    "allowedDestinations": [],
                    "approvalDate": None,
                    "limitations": ["Captions are rehearsal-only and not a substitute for the real submission demo transcript or approval."]
                }
            )
        dimensions_name = package_filename(
            {"familyIds": ["FAM-DEMO-001"], "assetId": "DEMO-REHEARSAL-VIDEO-001", "variant": "silent-concept-rehearsal"},
            safe_path(root, video_path),
            dimensions,
            spec,
        )
        video_package = f"release/{spec['packageVersion']}/assets/{dimensions_name}"
        copy_fact = _file_fact(root, video_package)
        duration = dimensions.get("durationSeconds")
        if dimensions.get("audioStreamCount") != 0:
            errors.append(f"{video_path}: rehearsal contract requires a silent export with no audio stream")
        planned_duration = (context.get("sceneMap") or {}).get("render", {}).get("plannedDurationSeconds")
        if duration is None or planned_duration is None or abs(float(duration) - float(planned_duration)) > 0.5:
            errors.append(f"{video_path}: duration does not match the {planned_duration}s rehearsal plan within 0.5s")
        if duration is not None and duration > 180:
            errors.append(f"{video_path}: duration exceeds the verified 180-second organizer maximum")
        video_records.append(
            {
                "recordId": Path(video_path).name,
                "assetId": "DEMO-REHEARSAL-VIDEO-001",
                "familyIds": ["FAM-DEMO-001"],
                "role": "silent-concept-rehearsal-video",
                "variant": "silent-concept-rehearsal",
                "assetRevision": spec.get("assetRevision"),
                "locale": spec.get("locale"),
                "requiredForV1": True,
                "releaseStatus": "draft_rehearsal_only",
                "file": fact,
                "source": {
                    "path": "demo/rehearsal-scenes.json",
                    "sha256": _file_fact(root, "demo/rehearsal-scenes.json").get("sha256"),
                    "sourceCommitId": _file_fact(root, "demo/rehearsal-scenes.json").get("sourceCommitId"),
                    "sourcePinStatus": _file_fact(root, "demo/rehearsal-scenes.json").get("sourcePinStatus"),
                    "lineagePaths": _unique(["demo/rehearsal-scenes.json", "demo/narration.md", *[scene.get("assetPath") for scene in scenes if scene.get("assetPath")]]),
                },
                "packageCopy": {
                    "path": video_package,
                    "exists": copy_fact.get("exists", False),
                    "sha256": copy_fact.get("sha256"),
                    "expectedSha256": fact.get("sha256"),
                    "byteIdenticalToSource": bool(copy_fact.get("exists") and copy_fact.get("sha256") == fact.get("sha256")),
                },
                "dimensions": dimensions,
                "sceneIds": all_scene_ids,
                "captionRecordIds": [record["recordId"] for record in caption_records if record["path"] in matching],
                "claimReferences": _claim_snapshot(context, scene_refs["claimIds"]),
                "ctaReferences": _cta_snapshot(context, scene_refs["ctaIds"]),
                "proposedWordingReferences": _proposal_snapshot(context, scene_refs["proposalIds"]),
                "sourcePins": _source_pin_snapshot(context, scene_refs["sourcePinIds"], root),
                "renderReceipt": receipt,
                "inventoryJoin": _inventory_join(context, "DEMO-REHEARSAL-VIDEO-001", video_path, True),
                "provenance": {"recordId": None, "status": "missing_record", "permissionStatus": "not_recorded", "allowedDestinations": [], "expiry": None, "reviewer": None, "reviewDate": None},
                "destinations": {"candidateInternalUse": spec.get("internalDestination"), "permittedReuseDestinations": [], "requestedExternalDestinations": ["official hackathon submission"], "permissionBasis": "No destination-specific video permission record is linked."},
                "approval": {"status": "pending", "reviewerRole": discovery.get("reviewerRole"), "reviewerIdentity": None, "approvalDate": None, "independentReviewStatus": "pending", "visualAccessibilityAndRightsReview": "pending"},
                "limitations": ["Silent synthetic rehearsal only; it is not authentic product/runtime evidence and cannot satisfy the required submission video."],
                "evidenceClassification": "mock / rehearsal",
                "providerMode": "none",
                "status": "draft_rehearsal_only",
                "mediaClass": "video",
                "accessibleAlternative": {"path": "demo/rehearsal-transcript.md", "exists": safe_path(root, "demo/rehearsal-transcript.md").is_file(), "sha256": _file_fact(root, "demo/rehearsal-transcript.md").get("sha256"), "sourceCommitId": _file_fact(root, "demo/rehearsal-transcript.md").get("sourceCommitId"), "status": "transcript_linked" if safe_path(root, "demo/rehearsal-transcript.md").is_file() else "missing"},
            }
        )
    if not video_paths:
        errors.append("No committed silent rehearsal MP4 was found under demo/exports/; no filename or checksum is fabricated.")
    if review_files and not any(Path(path).suffix.lower() == ".json" for path in review_files):
        errors.append("review/visual/rehearsal/ has no JSON render handoff receipt")
    if video_paths and not any(row.get("status") == "matched_video_path_and_sha256" for row in [record["renderReceipt"] for record in video_records]):
        errors.append("No rehearsal render receipt pins the exact MP4 path and SHA-256.")
    for video in video_records:
        if video.get("renderReceipt", {}).get("silent") is not True or video.get("renderReceipt", {}).get("audioTracks") != 0:
            errors.append(f"{video.get('file', {}).get('path')}: render receipt does not affirm a silent file with zero audio tracks")
        receipt = video.get("renderReceipt", {})
        missing_versions = [name for name in ("ffmpeg", "ffprobe", "Chrome", "Node", "Python") if not receipt.get("toolVersions", {}).get(name)]
        if missing_versions:
            errors.append(f"{video.get('file', {}).get('path')}: render receipt lacks tool versions for {', '.join(missing_versions)}")
        missing_caption_receipts = [row["path"] for row in caption_records if not row.get("renderReceiptStatus", "").startswith("matches_")]
        if missing_caption_receipts:
            errors.append(f"{video.get('file', {}).get('path')}: caption hashes are not pinned by receipt: {', '.join(missing_caption_receipts)}")
    return video_records, caption_records, errors


def _support_file(root: Path, relative: str) -> Dict[str, Any]:
    fact = _file_fact(root, relative)
    binding = POLICY_JSON_BINDINGS.get(relative)
    digest = fact["sha256"]
    source_commit_id = fact["sourceCommitId"]
    source_pin_status = fact["sourcePinStatus"]
    if binding and fact["exists"]:
        document = read_json(safe_path(root, relative))
        digest = projected_policy_digest(relative, document)
        source_commit_id = None
        source_pin_status = "self_reference_projection"
    return {
        "path": relative,
        "exists": fact["exists"],
        "sha256": digest,
        "sourceCommitId": source_commit_id,
        "sourcePinStatus": source_pin_status,
        "format": fact.get("format"),
        **({"binding": json.loads(json.dumps(binding))} if binding else {}),
        "purpose": "manifest validation or source/review evidence; not a reusable campaign asset by itself",
    }


def canonical_json_digest(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return sha256_bytes(encoded)


def project_policy_document(relative: str, document: Dict[str, Any]) -> Dict[str, Any]:
    """Return the narrowly projected policy JSON used to avoid manifest self-reference cycles."""
    if relative not in POLICY_JSON_BINDINGS:
        raise ValueError(f"no approved self-reference projection is defined for {relative}")
    projected = json.loads(json.dumps(document, ensure_ascii=False))
    if relative == "docs/collateral-inventory.json":
        rows = [row for row in projected.get("trackedFiles", []) if row.get("path") == "release/v0.1.0-rehearsal/manifest.json"]
        if len(rows) != 1:
            raise ValueError("inventory projection requires exactly one manifest trackedFiles row")
        if "sha256" not in rows[0] or "trackedAtRevision" not in rows[0]:
            raise ValueError("inventory manifest self-reference fields are missing")
        rows[0].pop("sha256", None)
        rows[0].pop("trackedAtRevision", None)
    elif relative == "review/provenance.json":
        rows = [row for row in projected.get("records", []) if row.get("assetId") == "HANDOFF-MANIFEST-001"]
        if len(rows) != 1:
            raise ValueError("provenance projection requires exactly one HANDOFF-MANIFEST-001 record")
        source = rows[0].get("source")
        checksum = rows[0].get("checksum")
        if not isinstance(source, dict) or not isinstance(checksum, dict):
            raise ValueError("provenance manifest self-reference fields are missing")
        if not {"revision", "url"}.issubset(source) or "value" not in checksum:
            raise ValueError("provenance manifest self-reference fields are missing")
        source.pop("revision", None)
        source.pop("url", None)
        checksum.pop("value", None)
        inventory_rows = [row for row in projected.get("records", []) if row.get("assetId") == "PROV-FILE-E018FDB8D981"]
        if len(inventory_rows) != 1:
            raise ValueError("provenance projection requires exactly one PROV-FILE-E018FDB8D981 inventory digest record")
        inventory_source = inventory_rows[0].get("source")
        inventory_checksum = inventory_rows[0].get("checksum")
        if not isinstance(inventory_source, dict) or not isinstance(inventory_checksum, dict):
            raise ValueError("provenance inventory digest projection fields are missing")
        if "revision" not in inventory_source or "value" not in inventory_checksum or "url" not in inventory_source:
            raise ValueError("provenance inventory digest projection fields are missing")
        inventory_source.pop("revision", None)
        inventory_checksum.pop("value", None)
    return projected


def projected_policy_digest(relative: str, document: Dict[str, Any]) -> str:
    return canonical_json_digest(project_policy_document(relative, document))


def _brand_reference(root: Path, context: Dict[str, Any]) -> Dict[str, Any]:
    comparison = context.get("brand") or {}
    consumption = _file_fact(root, "review/brand-consumption.md")
    compare = _file_fact(root, "review/visual/brand-comparison.json")
    visual_candidate = comparison.get("visualCandidate")
    if isinstance(visual_candidate, dict):
        upstream_revision = visual_candidate.get("revision")
    else:
        upstream_revision = None
    if not upstream_revision:
        source_rows = comparison.get("sources") or []
        upstream_revision = next((row.get("revision") for row in source_rows if isinstance(row, dict) and row.get("revision")), None)
    return {
        "localConsumptionRecord": {"path": consumption["path"], "sha256": consumption["sha256"], "sourceCommitId": consumption["sourceCommitId"]},
        "localComparisonRecord": {"path": compare["path"], "sha256": compare["sha256"], "sourceCommitId": compare["sourceCommitId"]},
        "upstreamRepository": "Jevelopers-neatHack-2026/brand-kit",
        "upstreamRevision": upstream_revision,
        "sourcePins": comparison.get("sources", []),
        "approvedSubset": comparison.get("approvedSubset"),
        "brandConformance": comparison.get("brandConformance", "not_recorded"),
        "requiredApprovals": comparison.get("requiredApprovals", []),
        "approvalStatus": "pending" if not comparison.get("approvedSubset") or comparison.get("brandConformance", "").startswith("BLOCKED") else "recorded",
        "approvalDate": None,
        "allowedAssetIds": [],
        "limitations": [
            "Pinned brand references and matching hashes do not grant rights or approval.",
            "No logo or font binaries are included; fallback font and platform glyph metrics can change rendered pixels and hashes.",
        ],
    }


def _scene_summary(root: Path, context: Dict[str, Any]) -> Dict[str, Any]:
    scene_map = context.get("sceneMap") or {}
    path = "demo/rehearsal-scenes.json"
    fact = _file_fact(root, path)
    scenes = []
    for scene in scene_map.get("scenes", []):
        asset_fact = _file_fact(root, scene.get("assetPath"))
        scene_refs = _references_for_scenes(context, [scene.get("sceneId")])
        scenes.append(
            {
                "sceneId": scene.get("sceneId"),
                "startSeconds": scene.get("startSeconds"),
                "endSeconds": scene.get("endSeconds"),
                "durationSeconds": scene.get("durationSeconds"),
                "captionText": scene.get("captionText"),
                "narration": scene.get("narration"),
                "assetId": scene.get("assetId"),
                "assetPath": scene.get("assetPath"),
                "assetSha256": asset_fact.get("sha256"),
                "assetSourceCommitId": asset_fact.get("sourceCommitId"),
                "claimIds": scene_refs["claimIds"],
                "ctaIds": scene_refs["ctaIds"],
                "proposalIds": scene_refs["proposalIds"],
                "sourcePinIds": scene_refs["sourcePinIds"],
                "evidenceClass": scene.get("evidenceClass"),
                "providerMode": scene.get("providerMode"),
                "limitations": [scene.get("assetUse", ""), scene.get("fallback", "")],
            }
        )
    duration = sum(int(row.get("durationSeconds", 0)) for row in scenes)
    return {
        "path": path,
        "sha256": fact.get("sha256"),
        "sourceCommitId": fact.get("sourceCommitId"),
        "durationSeconds": duration,
        "maximumSeconds": scene_map.get("render", {}).get("rehearsalMaximumSeconds"),
        "status": "draft_rehearsal_only",
        "scenes": scenes,
        "submissionGate": scene_map.get("submissionGate", {}).get("readiness", "unknown"),
        "rehearsalSatisfiesFinalDemoRequirement": scene_map.get("submissionGate", {}).get("rehearsalSatisfiesFinalDemoRequirement", False),
    }


def _toolchain(root: Path) -> Dict[str, Any]:
    def version(command: Sequence[str]) -> Optional[str]:
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=10)
        except (OSError, subprocess.TimeoutExpired):
            return None
        return (result.stdout or result.stderr).splitlines()[0].strip() if result.returncode == 0 and (result.stdout or result.stderr) else None

    render = None
    evidence_path = root / "review/visual/browser-render-evidence.json"
    if evidence_path.is_file():
        try:
            evidence = read_json(evidence_path)
            render = {
                "command": evidence.get("command"),
                "browser": evidence.get("browser", {}).get("product"),
                "node": evidence.get("node"),
                "python": evidence.get("python"),
                "pillow": evidence.get("pillow"),
                "evidenceType": evidence.get("evidenceType"),
            }
        except (OSError, json.JSONDecodeError, ValueError):
            render = {"status": "invalid_render_receipt"}
    return {
        "packageBuilder": "python3 tools/package_collateral.py",
        "packageBuilderPython": platform.python_version(),
        "packageBuilderPlatform": platform.platform(),
        "assetRenderRecipe": "node tools/render_collateral.mjs",
        "assetRenderEvidence": render,
        "videoProbe": version(["ffprobe", "-version"]),
        "providerMode": "none",
        "networkAccess": "not used by package builder or validator",
        "paidServiceCalls": 0,
        "reproducibilityLimitations": [
            "PNG/HTML renders may differ across Chrome, operating systems and installed system-font fallbacks. Compare actual pixel review and hashes; matching source text alone is insufficient.",
            "Package copies are byte-for-byte copies of the committed source/export paths. Do not regenerate/recompress an export under the same revision; create a new revision and preserve the prior package.",
        ],
    }


def _input_hashes(root: Path, spec: Dict[str, Any]) -> Dict[str, Any]:
    paths = [
        "docs/collateral-inventory.json",
        "messaging/claims.json",
        "review/provenance.json",
        "demo/rehearsal-scenes.json",
        "review/visual/asset-handoff.json",
        "review/visual/brand-comparison.json",
        "review/brand-consumption.md",
        "review/official-format-sources.json",
        "review/visual/browser-render-evidence.json",
        f"release/{spec['packageVersion']}/package-spec.json",
    ]
    return {path: _support_file(root, path) for path in paths}


def build_manifest(root: Path = ROOT, version: str = DEFAULT_VERSION, materialized: bool = False) -> Dict[str, Any]:
    context = _load_context(root, version)
    spec = context["spec"]
    rows = [_asset_record(root, row, spec, context) for row in spec.get("assets", [])]
    video_records, caption_records, dynamic_errors = _dynamic_video_records(root, spec, context)
    actual_asset_records = [row for row in rows if row["file"].get("exists")]
    all_records = rows + video_records
    selected_asset_ids = _unique(
        [record.get("assetId") for record in all_records if record.get("packageCopy", {}).get("path")]
        + [record.get("assetId") for record in caption_records if record.get("packageCopy", {}).get("path")]
    )
    canonical_selected_asset_ids = sorted(set(selected_asset_ids) & EXPECTED_POLICY_SELECTABLE_ASSET_IDS)
    if not set(canonical_selected_asset_ids).issubset(selected_asset_ids):
        raise ValueError("Package selection omitted an expected canonical selectable asset")
    omitted_selectable = sorted(EXPECTED_POLICY_SELECTABLE_ASSET_IDS - set(canonical_selected_asset_ids))
    if omitted_selectable:
        message = "Package selection omitted canonical selectable asset(s): " + ", ".join(omitted_selectable)
        canonical_blocks = {"available": False, "status": "package_selection_incomplete", "selected": [message], "submission": [message], "selectedAssetIds": canonical_selected_asset_ids}
    else:
        canonical_blocks = canonical_readiness_blockers(root, canonical_selected_asset_ids)
    rehearsal_evidence = []
    for relative in _find_media(root, spec.get("rehearsalDiscovery", {}).get("reviewRoot", "review/visual/rehearsal"), [".json", ".png", ".jpg", ".jpeg", ".md", ".txt"]):
        fact = _file_fact(root, relative)
        rehearsal_evidence.append({
            "path": relative,
            "sha256": fact.get("sha256"),
            "sourceCommitId": fact.get("sourceCommitId"),
            "format": fact.get("format"),
            "dimensions": fact.get("dimensions"),
            "classification": "local author/rehearsal inspection evidence; not independent approval",
        })
    support_files = [_support_file(root, path) for path in spec.get("supportRecords", [])]
    missing_support = [record["path"] for record in support_files if not record["exists"]]
    scene_map = _scene_summary(root, context)
    required = spec.get("requiredSubmissionArtifact", {})
    real_product_fact = _file_fact(root, required.get("path"))
    official = context.get("officialFormats") or {}
    organizer = next((row for row in official.get("sources", []) if row.get("sourceId") == "OFFICIAL-NEATHACK-2026"), {})
    official_requirements = organizer.get("observedRequirements", {})
    external_blockers = [
        "The authentic product demo required for submission is absent at the recorded required path; a silent rehearsal, mockup, storyboard, or deck cannot substitute.",
        "The actual official quote-post URL and confirmed Discord cutoff remain pending; refresh the organizer source before submission.",
        "Submitter name, team name, project name, final public repository URL, and final public demo URL remain unconfirmed external fields.",
        "No submission/posting authorization is recorded; this package does not publish or submit anything.",
        "Distinct authentic implementation/runtime/reasoning/result evidence for neatlogs, Entire, and cfo.ai is not present in this collateral package.",
        "Current product and comparable-baseline evidence does not establish measured outcomes or savings.",
    ]
    if not real_product_fact.get("exists"):
        external_blockers.insert(0, f"{required.get('assetId')} missing at {required.get('path')} (owner: {required.get('ownerRole')}).")
    collateral_gate, submission_gate = evaluate_gates(
        all_records,
        scene_map,
        _brand_reference(root, context),
        dynamic_errors,
        external_blockers,
        required_submission_video={**required, **real_product_fact},
        support_files=support_files,
        canonical_blockers=canonical_blocks,
    )
    return {
        "schemaVersion": "1.0",
        "packageVersion": version,
        "releaseClass": spec.get("releaseClass"),
        "lifecycleState": "draft_rehearsal_only",
        "candidateSourceCommitAtGeneration": context.get("gitHead"),
        "manifestGenerationTime": "Not self-certified; if needed, record the execution time in the separate release review record after this manifest is committed.",
        "contentAddresses": {
            "algorithm": "SHA-256",
            "note": "Asset, export, caption and package-copy digests bind exact bytes. The inventory and provenance policy inputs use their declared canonical JSON semantic-field projection; all other support inputs bind exact bytes. Per-file sourceCommitId binds the commit containing the same bytes; a null pin means the path is missing, untracked, modified, or uses an explicitly declared self-reference projection.",
        },
        "packagePurpose": "Internal review package for a synthetic concept rehearsal and draft announcement collateral. It is not a submission-ready, publicly reusable, or approved v1 release.",
        "destinations": {
            "internalReview": spec.get("internalDestination"),
            "externalDestinationsPending": spec.get("externalDestinationsPending", []),
            "externalPublicationAuthorized": False,
        },
        "collateralPackageReadiness": collateral_gate,
        "externalSubmissionReadiness": submission_gate,
        "naming": {
            "pattern": "{family}-{assetId}-{revision}-{destination}-{dimensions}-{locale}-{variant}.{extension}",
            "revision": spec.get("assetRevision"),
        "example": "demo-demo-workflow-diagram-001-r01-repository-internal-review-1440x900-en-us-concept-workflow-presentation.png",
            "collisionPolicy": "An existing path with different bytes is a hard error. Never overwrite a prior version; increment the asset revision or package version and retain the old path.",
        },
        "requiredSubmissionArtifact": {
            **required,
            "exists": real_product_fact.get("exists", False),
            "sha256": real_product_fact.get("sha256"),
            "sourceCommitId": real_product_fact.get("sourceCommitId"),
            "dimensions": real_product_fact.get("dimensions"),
            "status": "present_but_not_auto_approved" if real_product_fact.get("exists") else "missing",
        },
        "scenes": scene_map,
        "assets": all_records,
        "captionSidecars": caption_records,
        "rehearsalEvidenceFiles": rehearsal_evidence,
        "brandReferences": _brand_reference(root, context),
        "officialFormatSnapshot": {
            "path": "review/official-format-sources.json",
            "sha256": _file_fact(root, "review/official-format-sources.json").get("sha256"),
            "checkedAt": official.get("checkedAt"),
            "requirements": official_requirements,
            "refreshRequiredBeforeSubmission": True,
            "limitations": ["Event source records requirements only; it does not establish product/sponsor evidence or publication permission."],
        },
        "supportFiles": support_files,
        "policyInputHashes": _input_hashes(root, spec),
        "toolchain": _toolchain(root),
        "buildDiagnostics": {
            "materializedPackageCopies": materialized,
            "missingSupportFiles": missing_support,
            "dynamicMediaDiagnostics": dynamic_errors,
            "selectedClaimScopeOnly": True,
            "unusedClaimsAndCtasDoNotBlockCollateralPackage": True,
            "canonicalPolicyApiAvailable": canonical_blocks.get("available", False),
            "canonicalPolicyStatus": canonical_blocks.get("status", "not_run"),
            "selectedAssetIds": selected_asset_ids,
            "canonicalPolicySelectedAssetIds": canonical_selected_asset_ids,
        },
    }


def _manifest_claim_refs(manifest: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    claims: Dict[str, Dict[str, Any]] = {}
    for record in manifest.get("assets", []):
        for row in record.get("claimReferences", []):
            if row.get("id"):
                claims[row["id"]] = row
    for scene in manifest.get("scenes", {}).get("scenes", []):
        for claim_id in scene.get("claimIds", []):
            claims.setdefault(claim_id, {"id": claim_id})
    return claims


def selected_claim_blockers(record: Dict[str, Any]) -> List[str]:
    blockers: List[str] = []
    for claim in record.get("claimReferences", []):
        claim_id = claim.get("id", "<missing-id>")
        if claim.get("status") == "missing_from_current_ledger":
            blockers.append(f"{claim_id}: selected claim is missing from the current claims ledger")
        elif claim.get("reviewStatus") != "approved":
            blockers.append(f"{claim_id}: selected exact wording review is {claim.get('reviewStatus', 'missing')}")
        source = claim.get("source", {})
        revision = str(source.get("revision") or "")
        pinned = bool(HEX40.fullmatch(revision) or re.fullmatch(r"sha256:[0-9a-f]{64}", revision))
        if not pinned:
            blockers.append(f"{claim_id}: selected evidence source revision is pending or not immutably pinned")
    for cta in record.get("ctaReferences", []):
        cta_id = cta.get("id", "<missing-cta-id>")
        if cta.get("status") == "missing_from_current_ledger":
            blockers.append(f"{cta_id}: selected CTA is missing from the current claims ledger")
        if cta.get("wordingReview") != "approved":
            blockers.append(f"{cta_id}: selected CTA wording review is {cta.get('wordingReview', 'missing')}")
        if cta.get("availability") != "confirmed_for_pinned_documentation_only" or not cta.get("target"):
            blockers.append(f"{cta_id}: selected CTA destination is not confirmed")
        if not cta.get("reviewer") or not cta.get("reviewDate"):
            blockers.append(f"{cta_id}: selected CTA requires an actual reviewer identity and review date")
    for proposal in record.get("proposedWordingReferences", []):
        blockers.append(f"{proposal.get('id', '<proposal>')}: proposed wording has not been joined to the canonical claims ledger")
    return blockers


def asset_release_blockers(
    record: Dict[str, Any],
    today: Optional[date] = None,
    check_selected_wording_locally: bool = True,
) -> List[str]:
    today = today or date.today()
    blockers: List[str] = []
    file_row = record.get("file", {})
    record_id = record.get("recordId", record.get("assetId", "asset"))
    if not file_row.get("exists"):
        blockers.append(f"{record_id}: source/export bytes do not exist")
    if not SHA256.fullmatch(str(file_row.get("sha256", ""))):
        blockers.append(f"{record_id}: exact SHA-256 is missing or invalid")
    if not HEX40.fullmatch(str(file_row.get("sourceCommitId", ""))):
        blockers.append(f"{record_id}: source commit is missing or the file is uncommitted/modified")
    if file_row.get("sourcePinStatus") != "pinned":
        blockers.append(f"{record_id}: exact source commit does not contain current bytes")
    package_copy = record.get("packageCopy", {})
    if package_copy.get("path") and not package_copy.get("exists"):
        blockers.append(f"{record_id}: versioned package copy is missing")
    if package_copy.get("path") and not package_copy.get("byteIdenticalToSource"):
        blockers.append(f"{record_id}: packaged bytes differ from the pinned source/export")
    for error in record.get("compositionReferenceErrors", []):
        blockers.append(f"{record_id}: {error}")
    for dependency in record.get("compositionDependencies", []):
        dependency_id = dependency.get("packageCopy", {}).get("path") or dependency.get("relativeReference", "contextual dependency")
        source = dependency.get("source", {})
        packaged = dependency.get("packageCopy", {})
        if dependency.get("resolutionStatus") != "matches_declared_package_path":
            blockers.append(f"{record_id}: {dependency_id}: relative reference does not resolve safely to the declared package path")
        if not SHA256.fullmatch(str(source.get("sha256", ""))) or not HEX40.fullmatch(str(source.get("sourceCommitId", ""))) or source.get("sourcePinStatus") != "pinned":
            blockers.append(f"{record_id}: {dependency_id}: contextual source is missing or unpinned")
        if not packaged.get("exists") or not packaged.get("byteIdenticalToSource") or packaged.get("sha256") != packaged.get("expectedSha256"):
            blockers.append(f"{record_id}: {dependency_id}: contextual package dependency is missing or differs from its source")
    if record.get("releaseStatus") != "approved":
        blockers.append(f"{record_id}: asset lifecycle status {record.get('releaseStatus', 'missing')} is not approved for this package")
    if record.get("inventoryJoin", {}).get("status") != "current":
        blockers.append(f"{record_id}: MM-01 inventory join is {record.get('inventoryJoin', {}).get('status', 'missing')}")
    for reference in record.get("source", {}).get("lineagePaths", []):
        pass
    alt = record.get("accessibleAlternative", {})
    if record.get("mediaClass") in {"visual", "audio", "video"} or record.get("role") in {"rendered-raster-export", "editable-vector-source", "silent-concept-rehearsal-video"}:
        if not alt.get("exists") and not record.get("captionRecordIds"):
            blockers.append(f"{record_id}: visual/video accessible alternative, captions, or transcript link is missing")
        elif alt.get("exists") and (
            not SHA256.fullmatch(str(alt.get("sha256", "")))
            or not HEX40.fullmatch(str(alt.get("sourceCommitId", "")))
            or alt.get("sourcePinStatus") not in {None, "pinned"}
        ):
            blockers.append(f"{record_id}: accessible alternative is not checksum- and source-pinned")
    provenance = record.get("provenance", {})
    if provenance.get("recordId") is None or provenance.get("status") != "approved":
        blockers.append(f"{record_id}: matching provenance and rights record is missing or not approved")
    if provenance.get("permissionStatus") != "approved":
        blockers.append(f"{record_id}: destination permission is {provenance.get('permissionStatus', 'missing')}")
    expiry = provenance.get("expiry")
    if not expiry:
        blockers.append(f"{record_id}: permission expiry/review trigger is unknown")
    else:
        try:
            if date.fromisoformat(expiry) < today:
                blockers.append(f"{record_id}: provenance permission expired on {expiry}")
        except ValueError:
            blockers.append(f"{record_id}: provenance expiry date is invalid")
    candidate_destination = record.get("destinations", {}).get("candidateInternalUse")
    allowed_destinations = provenance.get("allowedDestinations", [])
    approved_destinations = provenance.get("approvedDestinations", [])
    if not candidate_destination or candidate_destination not in allowed_destinations or candidate_destination not in approved_destinations:
        blockers.append(f"{record_id}: rights do not explicitly authorize the exact candidate destination")
    if not provenance.get("reviewer") or not provenance.get("reviewDate"):
        blockers.append(f"{record_id}: rights review identity/date is unknown")
    approval = record.get("approval", {})
    if approval.get("status") != "approved" or not approval.get("reviewerIdentity") or not approval.get("approvalDate"):
        blockers.append(f"{record_id}: exact-asset destination approval/reviewer/date is pending")
    if check_selected_wording_locally:
        for blocker in selected_claim_blockers(record):
            blockers.append(f"{record_id}: {blocker}")
    render = record.get("renderReceipt", {})
    if render.get("status") in {"missing", "missing_or_stale_output_hash", "not_checked_missing_export"}:
        blockers.append(f"{record_id}: exact export render receipt is {render.get('status')}")
    if record.get("status") in {"pending", "superseded", "revoked", "expired", "draft_rehearsal_only"}:
        blockers.append(f"{record_id}: selected sample status {record.get('status')} is not releasable")
    return blockers


def _normalise_policy_blockers(result: Any) -> List[str]:
    if isinstance(result, dict):
        if "blockers" not in result:
            raise TypeError("policy API dictionary result must include a blockers list")
        result = result["blockers"]
    if isinstance(result, str):
        return [result]
    if isinstance(result, (list, tuple, set)) and all(isinstance(item, str) for item in result):
        return [item for item in result if item]
    raise TypeError("policy API must return a blocker sequence or {blockers: sequence}")


def canonical_readiness_blockers(root: Path, selected_asset_ids: Sequence[str]) -> Dict[str, Any]:
    """Use the canonical policy API; an absent or partial API always fails closed."""
    try:
        import validate_collateral as policy
    except Exception as exc:
        message = f"Canonical collateral policy module could not be loaded; both readiness gates fail closed ({type(exc).__name__})."
        return {"available": False, "status": "module_unavailable", "selected": [message], "submission": [message]}
    required = ("validate_all", "selected_collateral_blockers", "submission_blockers")
    missing = [name for name in required if not callable(getattr(policy, name, None))]
    if missing:
        message = f"Canonical readiness API is incomplete; missing callable(s): {', '.join(missing)}. Both readiness gates fail closed."
        return {"available": False, "status": "api_incomplete", "selected": [message], "submission": [message]}
    selectable = getattr(policy, "SELECTABLE_COLLATERAL_ASSET_IDS", None)
    if not isinstance(selectable, (set, frozenset)) or set(selectable) != EXPECTED_POLICY_SELECTABLE_ASSET_IDS:
        message = "Canonical selectable-asset policy is missing or differs from the packaged five-asset contract; both readiness gates fail closed."
        return {"available": False, "status": "selectable_contract_changed", "selected": [message], "submission": [message]}
    selected_fn = getattr(policy, "selected_collateral_blockers")
    submission_fn = getattr(policy, "submission_blockers")
    try:
        ledger = read_json(safe_path(root, "messaging/claims.json"))
        provenance = read_json(safe_path(root, "review/provenance.json"))
        inventory = read_json(safe_path(root, "docs/collateral-inventory.json"))
        fixture = read_json(safe_path(root, "review/fixtures/synthetic-canaries.json"))
        handoff = read_json(safe_path(root, "review/visual/asset-handoff.json"))
        structural_errors = _normalise_policy_blockers(policy.validate_all(ledger, provenance, fixture, handoff, inventory))
        if structural_errors:
            message = "Canonical global validation failed; selected readiness was not evaluated."
            failures = [message, *structural_errors]
            return {"available": True, "status": "global_validation_failed", "selected": failures, "submission": failures, "selectedAssetIds": list(selected_asset_ids)}
        selected = _normalise_policy_blockers(selected_fn(ledger, provenance, list(selected_asset_ids)))
        submission = _normalise_policy_blockers(submission_fn(ledger, provenance, list(selected_asset_ids), inventory))
        return {"available": True, "status": "validated", "selected": selected, "submission": submission, "selectedAssetIds": list(selected_asset_ids)}
    except Exception as exc:
        fail_closed = f"Canonical selected-collateral validation failed closed: {exc}"
        return {"available": False, "status": "validation_error", "selected": [fail_closed], "submission": [fail_closed]}


def evaluate_gates(
    records: Sequence[Dict[str, Any]],
    scene_map: Dict[str, Any],
    brand: Dict[str, Any],
    dynamic_errors: Sequence[str],
    external_blockers: Sequence[str],
    required_submission_video: Dict[str, Any],
    support_files: Sequence[Dict[str, Any]],
    canonical_blockers: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    canonical_active = bool(canonical_blockers and canonical_blockers.get("available"))
    if not canonical_active:
        missing_api = (canonical_blockers or {}).get("selected") or [
            "Canonical collateral readiness validation was not supplied; both readiness gates fail closed."
        ]
        missing_submission_api = (canonical_blockers or {}).get("submission") or missing_api
    else:
        missing_api = []
        missing_submission_api = []
    collateral: List[str] = []
    canonical_selected_asset_ids = set((canonical_blockers or {}).get("selectedAssetIds", []))
    for record in records:
        if record.get("packageCopy", {}).get("path") or record.get("requiredForV1", True):
            use_canonical_wording = canonical_active and record.get("assetId") in canonical_selected_asset_ids
            collateral.extend(asset_release_blockers(record, check_selected_wording_locally=not use_canonical_wording))
    if canonical_active:
        collateral.extend(canonical_blockers.get("selected", []))
    else:
        collateral.extend(missing_api)
    if brand.get("approvalStatus") != "approved":
        collateral.append("Brand allowlist/conformance and named brand/landing consumer approval remain pending.")
    for error in dynamic_errors:
        collateral.append(error)
    missing_support = [row.get("path") for row in support_files if not row.get("exists")]
    for path in missing_support:
        collateral.append(f"Required source/review support file is missing: {path}")
    if scene_map.get("status") != "draft_rehearsal_only" or scene_map.get("rehearsalSatisfiesFinalDemoRequirement") is True:
        collateral.append("Scene map must remain explicitly rehearsal-only and must not satisfy the final demo requirement.")
    if int(scene_map.get("durationSeconds", 0)) > int(scene_map.get("maximumSeconds") or 180):
        collateral.append("Rehearsal scene map exceeds its stated maximum duration.")
    if len(scene_map.get("scenes", [])) == 0:
        collateral.append("Scene map is missing all timed scenes.")
    collateral = _unique(collateral)
    submission = list(external_blockers)
    if canonical_active:
        submission.extend(canonical_blockers.get("submission", []))
    else:
        submission.extend(missing_submission_api)
    if not required_submission_video.get("exists"):
        submission.append(f"Required final product video is missing at {required_submission_video.get('path')}.")
    if scene_map.get("rehearsalSatisfiesFinalDemoRequirement") is not False:
        submission.append("Rehearsal must not be substituted for the final product video.")
    submission = _unique(submission)
    return {
        "decision": "PASS" if not collateral else "BLOCKED",
        "scope": "Collateral-package completeness and destination-specific reuse of only the selected assets in this manifest.",
        "blockers": collateral,
        "readyAtUtc": None if collateral else datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }, {
        "decision": "PASS" if not submission else "BLOCKED",
        "scope": "External hackathon submission/posting readiness; separate from collateral package readiness.",
        "blockers": submission,
        "readyAtUtc": None if submission else datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }


def copy_package_files(root: Path, version: str) -> None:
    context = _load_context(root, version)
    spec = context["spec"]
    planned_targets = set()
    for row in spec.get("assets", []):
        if not row.get("package", True):
            continue
        source = safe_path(root, row["path"])
        if not source.is_file():
            continue
        fact = _file_fact(root, row["path"])
        name = package_filename(row, source, fact.get("dimensions", {"status": "not_applicable"}), spec)
        relative_target = _package_asset_path(row, name, version)
        if relative_target in planned_targets:
            raise FileExistsError(f"Two package rows resolve to {relative_target}; change an asset variant or revision.")
        planned_targets.add(relative_target)
        target = safe_path(root, relative_target)
        target.parent.mkdir(parents=True, exist_ok=True)
        content = source.read_bytes()
        if target.exists():
            if sha256_file(target) != sha256_bytes(content):
                raise FileExistsError(f"Refusing to overwrite changed package asset {relative_target}; increment revision/version.")
            continue
        with target.open("xb") as handle:
            handle.write(content)
    for row in spec.get("assets", []):
        if not row.get("package", True) or not row.get("packageDependencies"):
            continue
        source_path = safe_path(root, row["path"])
        name = package_filename(row, source_path, _file_fact(root, row["path"]).get("dimensions", {"status": "not_applicable"}), spec)
        entrypoint = _package_asset_path(row, name, version)
        for dependency in row.get("packageDependencies", []):
            source_relative = dependency.get("sourcePath")
            package_relative = _package_dependency_path(dependency.get("packagePath", ""), version)
            reference = dependency.get("relativeReference", "")
            resolved = resolve_package_reference(entrypoint, reference, version)
            if resolved != package_relative:
                raise ValueError(f"HTML dependency {reference!r} does not resolve to declared package path {package_relative}")
            if package_relative in planned_targets:
                raise FileExistsError(f"Package output collision for contextual dependency {package_relative}")
            planned_targets.add(package_relative)
            source = safe_path(root, source_relative)
            if not source.is_file():
                raise FileNotFoundError(f"Contextual dependency source is missing: {source_relative}")
            target = safe_path(root, package_relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            content = source.read_bytes()
            if target.exists():
                if sha256_file(target) != sha256_bytes(content):
                    raise FileExistsError(f"Refusing to overwrite changed contextual dependency {package_relative}; increment revision/version.")
                continue
            with target.open("xb") as handle:
                handle.write(content)
    videos, captions, _ = _dynamic_video_records(root, spec, context)
    for row in [*videos, *captions]:
        source_relative = row.get("file", {}).get("path") or row.get("path")
        package_relative = row.get("packageCopy", {}).get("path")
        if not source_relative or not package_relative:
            continue
        if package_relative in planned_targets:
            raise FileExistsError(f"Two package rows resolve to {package_relative}; change an asset variant or revision.")
        planned_targets.add(package_relative)
        source = safe_path(root, source_relative)
        target = safe_path(root, package_relative)
        if not source.is_file():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        content = source.read_bytes()
        if target.exists():
            if sha256_file(target) != sha256_bytes(content):
                raise FileExistsError(f"Refusing to overwrite changed package asset {package_relative}; increment revision/version.")
            continue
        with target.open("xb") as handle:
            handle.write(content)


def validate_manifest_files(root: Path, manifest: Dict[str, Any]) -> List[str]:
    errors: List[str] = package_path_collisions(manifest)

    def verify_source(relative: Optional[str], expected_sha: Optional[str], expected_commit: Optional[str], label: str) -> None:
        if not relative:
            errors.append(f"{label}: manifest path is missing")
            return
        try:
            path = safe_path(root, relative)
        except ValueError as exc:
            errors.append(f"{label} {relative}: {exc}")
            return
        if not path.is_file():
            errors.append(f"{label} {relative}: source file is missing")
            return
        current_sha = sha256_file(path)
        if current_sha != expected_sha:
            errors.append(f"{label} {relative}: source SHA-256 differs from manifest")
        commit = committed_source(root, relative, current_sha)
        if commit.get("status") != "pinned" or commit.get("commitId") != expected_commit:
            errors.append(f"{label} {relative}: source commit is missing, stale, or does not contain the exact bytes")

    def verify_bound_input(support: Dict[str, Any], label: str) -> None:
        relative = support.get("path")
        declared = support.get("binding")
        expected = POLICY_JSON_BINDINGS.get(relative)
        if declared is None:
            if relative in POLICY_JSON_BINDINGS:
                errors.append(f"{label} {relative}: required canonical JSON projection binding is missing")
                return
            if support.get("exists") and support.get("sha256"):
                verify_source(relative, support.get("sha256"), support.get("sourceCommitId"), label)
            return
        if expected is None or declared != expected:
            errors.append(f"{label} {relative}: unsupported or altered canonical JSON projection algorithm/selectors")
            return
        if support.get("sourcePinStatus") != "self_reference_projection" or support.get("sourceCommitId") is not None:
            errors.append(f"{label} {relative}: projected input must not claim a full-file source commit pin")
        if not support.get("exists"):
            errors.append(f"{label} {relative}: projected policy input is missing")
            return
        if not isinstance(support.get("sha256"), str) or not SHA256.fullmatch(support.get("sha256", "")):
            errors.append(f"{label} {relative}: projected canonical JSON SHA-256 is missing or invalid")
            return
        try:
            current = read_json(safe_path(root, relative))
            current_digest = projected_policy_digest(relative, current)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            errors.append(f"{label} {relative}: canonical JSON projection failed closed ({exc})")
            return
        if current_digest != support.get("sha256"):
            errors.append(f"{label} {relative}: canonical JSON semantic field binding differs from manifest")

    for record in manifest.get("assets", []):
        package = record.get("packageCopy", {})
        path_value = package.get("path")
        if path_value:
            try:
                path = safe_path(root, path_value)
            except ValueError as exc:
                errors.append(f"{path_value}: {exc}")
                continue
            if not path.is_file():
                errors.append(f"{path_value}: packaged file is missing")
            elif sha256_file(path) != package.get("expectedSha256"):
                errors.append(f"{path_value}: packaged SHA-256 does not match manifest")
        file_row = record.get("file", {})
        source_path = file_row.get("path")
        if file_row.get("exists"):
            verify_source(source_path, file_row.get("sha256"), file_row.get("sourceCommitId"), "asset source")
        source = record.get("source", {})
        if source.get("path") and source.get("sha256"):
            verify_source(source.get("path"), source.get("sha256"), source.get("sourceCommitId"), "editable/source lineage")
        dependencies = record.get("compositionDependencies", [])
        for dependency in dependencies:
            label = f"contextual dependency {dependency.get('relativeReference', '<missing-reference>')}"
            dependency_source = dependency.get("source", {})
            dependency_copy = dependency.get("packageCopy", {})
            verify_source(
                dependency_source.get("path"),
                dependency_source.get("sha256"),
                dependency_source.get("sourceCommitId"),
                f"{label} source",
            )
            try:
                copy_path = safe_path(root, dependency_copy.get("path", ""))
            except ValueError as exc:
                errors.append(f"{label} package path: {exc}")
                continue
            if not dependency_copy.get("exists") or not copy_path.is_file():
                errors.append(f"{label}: packaged contextual dependency is missing")
                continue
            copy_sha = sha256_file(copy_path)
            if copy_sha != dependency_copy.get("expectedSha256") or copy_sha != dependency_copy.get("sha256"):
                errors.append(f"{label}: packaged contextual dependency checksum mismatch")
            verify_source(
                dependency_copy.get("path"),
                dependency_copy.get("sha256"),
                dependency_copy.get("sourceCommitId"),
                f"{label} package copy",
            )
            source_path_value = dependency_source.get("path")
            if source_path_value:
                try:
                    dependency_source_path = safe_path(root, source_path_value)
                except ValueError:
                    dependency_source_path = None
                if dependency_source_path and dependency_source_path.is_file() and copy_sha != sha256_file(dependency_source_path):
                    errors.append(f"{label}: packaged contextual dependency differs from its source bytes")
        source_ext = Path(str(file_row.get("path", ""))).suffix.lower()
        if source_ext == ".html" and file_row.get("exists"):
            try:
                html_path = safe_path(root, str(file_row.get("path", "")))
                if html_path.is_file():
                    composition_errors = package_composition_reference_errors(
                        str(package.get("path", "")),
                        html_local_references(html_path),
                        dependencies,
                        str(manifest.get("packageVersion", "")),
                    )
                    errors.extend(f"{record.get('recordId', record.get('assetId', 'asset'))}: {item}" for item in composition_errors)
            except (OSError, UnicodeError, ValueError) as exc:
                errors.append(f"{record.get('recordId', record.get('assetId', 'asset'))}: HTML composition validation failed closed ({exc})")
        alternative = record.get("accessibleAlternative", {})
        if alternative.get("exists"):
            verify_source(alternative.get("path"), alternative.get("sha256"), alternative.get("sourceCommitId"), "accessible alternative")
        render = record.get("renderReceipt", {})
        if render.get("path"):
            verify_source(render.get("path"), render.get("sha256"), render.get("sourceCommitId"), "render receipt")
    for record in manifest.get("captionSidecars", []):
        relative = record.get("path")
        if relative:
            try:
                path = safe_path(root, relative)
            except ValueError as exc:
                errors.append(f"{relative}: {exc}")
                continue
            if not path.is_file() or sha256_file(path) != record.get("sha256"):
                errors.append(f"{relative}: caption sidecar changed or is missing")
            else:
                commit = committed_source(root, relative, sha256_file(path))
                if commit.get("status") != "pinned" or commit.get("commitId") != record.get("sourceCommitId"):
                    errors.append(f"{relative}: caption source commit is missing, stale, or does not contain the exact bytes")
            package = record.get("packageCopy", {})
            if package.get("path"):
                try:
                    package_path = safe_path(root, package["path"])
                except ValueError as exc:
                    errors.append(f"{package['path']}: {exc}")
                    continue
                if not package_path.is_file() or sha256_file(package_path) != package.get("expectedSha256"):
                    errors.append(f"{package['path']}: packaged caption checksum mismatch or missing")
    required = manifest.get("requiredSubmissionArtifact", {})
    if required.get("exists"):
        verify_source(required.get("path"), required.get("sha256"), required.get("sourceCommitId"), "required submission artifact")
    for scene in manifest.get("scenes", {}).get("scenes", []):
        if scene.get("assetPath") and scene.get("assetSha256"):
            verify_source(scene.get("assetPath"), scene.get("assetSha256"), scene.get("assetSourceCommitId"), f"scene {scene.get('sceneId')} asset")
    for support in manifest.get("supportFiles", []):
        verify_bound_input(support, "support file")
    for support in manifest.get("rehearsalEvidenceFiles", []):
        if support.get("exists", True) and support.get("sha256"):
            verify_source(support.get("path"), support.get("sha256"), support.get("sourceCommitId"), "support/evidence file")
    for support in manifest.get("policyInputHashes", {}).values():
        verify_bound_input(support, "policy input")
    return errors


def readiness_cache_errors(cached_manifest: Dict[str, Any], current_manifest: Dict[str, Any]) -> List[str]:
    """Reject readiness decisions that differ from a fresh package/policy evaluation."""
    errors: List[str] = []
    for field, label in (
        ("collateralPackageReadiness", "collateral package"),
        ("externalSubmissionReadiness", "external submission"),
    ):
        cached = cached_manifest.get(field)
        current = current_manifest.get(field)
        if not isinstance(cached, dict) or not isinstance(current, dict):
            errors.append(f"cached {label} readiness is missing or invalid; current readiness cannot be trusted")
            continue
        for key in ("decision", "scope", "blockers"):
            if cached.get(key) != current.get(key):
                errors.append(f"cached {label} readiness {key} differs from current source and policy evaluation")
    return errors


def recompute_manifest_readiness(root: Path, manifest: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    version = manifest.get("packageVersion")
    if not isinstance(version, str) or not version:
        return {}, ["manifest packageVersion is missing; current readiness cannot be recomputed"]
    try:
        current = build_manifest(root, version=version, materialized=False)
    except Exception as exc:
        return {}, [f"current readiness recomputation failed closed: {exc}"]
    return current, readiness_cache_errors(manifest, current)


def package_path_collisions(manifest: Dict[str, Any]) -> List[str]:
    seen: set = set()
    duplicates: List[str] = []
    records = [*manifest.get("assets", []), *manifest.get("captionSidecars", [])]
    for record in records:
        package_path = record.get("packageCopy", {}).get("path")
        if not package_path:
            continue
        if package_path in seen:
            duplicates.append(f"duplicate package output path: {package_path}")
        seen.add(package_path)
        for dependency in record.get("compositionDependencies", []):
            dependency_path = dependency.get("packageCopy", {}).get("path")
            if not dependency_path:
                continue
            if dependency_path in seen:
                duplicates.append(f"duplicate package output path: {dependency_path}")
            seen.add(dependency_path)
    return _unique(duplicates)


def verify_caption_receipt_records(manifest: Dict[str, Any], root: Optional[Path] = None) -> List[str]:
    errors: List[str] = []
    caption_by_id = {record.get("recordId"): record for record in manifest.get("captionSidecars", [])}
    for video in [record for record in manifest.get("assets", []) if record.get("assetId") == "DEMO-REHEARSAL-VIDEO-001"]:
        receipt = video.get("renderReceipt", {})
        if receipt.get("status") != "matched_video_path_and_sha256":
            errors.append(f"{video.get('file', {}).get('path')}: matching rehearsal render receipt is required")
        if receipt.get("sourceInputStatus") != "exact_current_source_snapshot":
            errors.extend(receipt.get("sourceInputErrors", []) or [f"{video.get('file', {}).get('path')}: render receipt source inputs are not exact current bytes"])
        if root is not None:
            errors.extend(validate_receipt_sources(root, receipt))
        if sorted(receipt.get("sceneIds", [])) != sorted(video.get("sceneIds", [])):
            errors.append(f"{video.get('file', {}).get('path')}: render receipt scene IDs do not match scene map")
        if receipt.get("width") != video.get("dimensions", {}).get("width") or receipt.get("height") != video.get("dimensions", {}).get("height"):
            errors.append(f"{video.get('file', {}).get('path')}: receipt dimensions differ from ffprobe")
        if receipt.get("durationSeconds") is None or video.get("dimensions", {}).get("durationSeconds") is None or abs(float(receipt.get("durationSeconds")) - float(video["dimensions"]["durationSeconds"])) > 0.5:
            errors.append(f"{video.get('file', {}).get('path')}: receipt duration differs from ffprobe")
        if not receipt.get("toolVersions"):
            errors.append(f"{video.get('file', {}).get('path')}: receipt is missing render tool versions")
        if not receipt.get("captionPaths"):
            errors.append(f"{video.get('file', {}).get('path')}: receipt is missing caption path references")
        caption_ids = video.get("captionRecordIds", [])
        captions = [caption_by_id.get(identifier) for identifier in caption_ids]
        if len(captions) < 2 or any(row is None for row in captions):
            errors.append(f"{video.get('file', {}).get('path')}: SRT and VTT caption sidecar records are required")
        else:
            extensions = {Path(row.get("path", "")).suffix.lower() for row in captions}
            if extensions != {".srt", ".vtt"}:
                errors.append(f"{video.get('file', {}).get('path')}: one SRT and one VTT sidecar are required")
            receipt_hashes = {(row.get("path"), row.get("sha256")) for row in receipt.get("fileHashes", [])}
            for row in captions:
                if row.get("path") not in receipt.get("captionPaths", []) or (row.get("path"), row.get("sha256")) not in receipt_hashes:
                    errors.append(f"{row.get('path')}: caption path/hash is not pinned by the matching render receipt")
                if row.get("renderReceiptStatus") != "matches_exact_caption_hash":
                    errors.append(f"{row.get('path')}: caption render receipt is missing or stale")
    return errors


def build_current_cli(root: Path, version: str, materialize: bool) -> Dict[str, Any]:
    if materialize:
        copy_package_files(root, version)
    manifest = build_manifest(root, version, materialized=materialize)
    collisions = package_path_collisions(manifest)
    if collisions:
        raise FileExistsError("; ".join(collisions))
    receipt_errors = verify_caption_receipt_records(manifest, root)
    if receipt_errors:
        manifest["buildDiagnostics"]["dynamicMediaDiagnostics"] = _unique([*manifest["buildDiagnostics"].get("dynamicMediaDiagnostics", []), *receipt_errors])
        manifest["collateralPackageReadiness"]["blockers"] = _unique([*manifest["collateralPackageReadiness"].get("blockers", []), *receipt_errors])
        manifest["collateralPackageReadiness"]["decision"] = "BLOCKED"
    return manifest


def persist_draft_manifest(root: Path, manifest_path: Path, manifest: Dict[str, Any], encoded: str) -> Optional[str]:
    """Write a draft snapshot; archive prior draft metadata, keep approved releases immutable."""
    if manifest.get("releaseClass") != "draft_rehearsal_only" or manifest.get("lifecycleState") != "draft_rehearsal_only":
        raise ValueError("This builder only writes manifests explicitly classified draft_rehearsal_only.")
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    new_bytes = encoded.encode("utf-8")
    if not manifest_path.exists():
        with manifest_path.open("xb") as handle:
            handle.write(new_bytes)
        return None

    old_bytes = manifest_path.read_bytes()
    if old_bytes == new_bytes:
        return None
    try:
        old_manifest = json.loads(old_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise FileExistsError(f"Refusing to replace invalid existing manifest {manifest_path.relative_to(root)}") from exc
    if not isinstance(old_manifest, dict) or old_manifest.get("releaseClass") != "draft_rehearsal_only" or old_manifest.get("lifecycleState") != "draft_rehearsal_only":
        raise FileExistsError(f"Refusing to replace a non-draft manifest {manifest_path.relative_to(root)}; approved release metadata is immutable.")

    history_name = f"manifest-{sha256_bytes(old_bytes)[:16]}.json"
    history_relative = f"release/{manifest.get('packageVersion')}/history/{history_name}"
    history_path = safe_path(root, history_relative)
    history_path.parent.mkdir(parents=True, exist_ok=True)
    if history_path.exists():
        if history_path.read_bytes() != old_bytes:
            raise FileExistsError(f"Draft manifest history collision at {history_relative}")
    else:
        with history_path.open("xb") as handle:
            handle.write(old_bytes)

    temporary_path: Optional[Path] = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", prefix=".manifest-", suffix=".tmp", dir=manifest_path.parent, delete=False
        ) as handle:
            temporary_path = Path(handle.name)
            handle.write(new_bytes)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, manifest_path)
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()
    return history_relative


def bind_draft_manifest_self_reference(root: Path, version: str) -> str:
    """Bind the generated draft digest into only its documented self-reference fields.

    Run after `build` in a clean isolated checkout. The narrow canonical JSON
    projection keeps these three checksum/revision fields outside the input
    digest while every other policy field remains covered.
    """
    if version != DEFAULT_VERSION:
        raise ValueError("manifest self-reference binding is defined only for the v0.1.0-rehearsal policy projection")
    manifest_relative = f"release/{version}/manifest.json"
    manifest_path = safe_path(root, manifest_relative)
    if not manifest_path.is_file():
        raise FileNotFoundError(f"generated draft manifest is missing: {manifest_relative}")
    manifest = read_json(manifest_path)
    if manifest.get("releaseClass") != "draft_rehearsal_only" or manifest.get("lifecycleState") != "draft_rehearsal_only":
        raise ValueError("refusing to bind a non-draft or approved manifest")
    digest = sha256_file(manifest_path)

    inventory_relative = "docs/collateral-inventory.json"
    provenance_relative = "review/provenance.json"
    inventory_path = safe_path(root, inventory_relative)
    provenance_path = safe_path(root, provenance_relative)
    inventory = read_json(inventory_path)
    provenance = read_json(provenance_path)
    inventory_before = projected_policy_digest(inventory_relative, inventory)
    provenance_before = projected_policy_digest(provenance_relative, provenance)

    inventory_rows = [row for row in inventory.get("trackedFiles", []) if row.get("path") == manifest_relative]
    provenance_rows = [row for row in provenance.get("records", []) if row.get("assetId") == "HANDOFF-MANIFEST-001"]
    if len(inventory_rows) != 1 or len(provenance_rows) != 1:
        raise ValueError("manifest self-reference requires exactly one inventory path and one HANDOFF-MANIFEST-001 provenance record")
    inventory_row = inventory_rows[0]
    provenance_row = provenance_rows[0]
    source = provenance_row.get("source")
    checksum = provenance_row.get("checksum")
    if not isinstance(source, dict) or source.get("path") != manifest_relative or source.get("repo") != "Jevelopers-neatHack-2026/marketing-material":
        raise ValueError("manifest provenance source must identify the exact local generated manifest")
    if not isinstance(checksum, dict) or checksum.get("algorithm") != "SHA-256":
        raise ValueError("manifest provenance must declare the SHA-256 checksum algorithm")

    inventory_row["sha256"] = digest
    source["revision"] = f"sha256:{digest}"
    source["url"] = None
    checksum["value"] = digest

    if projected_policy_digest(inventory_relative, inventory) != inventory_before or projected_policy_digest(provenance_relative, provenance) != provenance_before:
        raise ValueError("self-reference binding unexpectedly changed a nonexcluded canonical policy field")
    for target, document in ((inventory_path, inventory), (provenance_path, provenance)):
        encoded = json.dumps(document, indent=2, ensure_ascii=False) + "\n"
        temporary_path: Optional[Path] = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", prefix=".self-reference-", suffix=".tmp", dir=target.parent, delete=False) as handle:
                temporary_path = Path(handle.name)
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, target)
        finally:
            if temporary_path and temporary_path.exists():
                temporary_path.unlink()
    return digest


def _cli() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    build = subparsers.add_parser("build", help="Materialize draft package bytes and write a manifest")
    build.add_argument("--root", type=Path, default=ROOT)
    build.add_argument("--version", default=DEFAULT_VERSION)
    build.add_argument("--dry-run", action="store_true", help="Do not materialize/copy package bytes or write the manifest")
    validate = subparsers.add_parser("validate", help="Check source/export/copy hashes and current release blockers")
    validate.add_argument("manifest", type=Path)
    validate.add_argument("--root", type=Path, default=ROOT)
    validate.add_argument("--require-release-ready", action="store_true", help="Return exit 2 unless the collateral package decision is PASS")
    bind_self_reference = subparsers.add_parser(
        "bind-self-reference",
        help="Bind a draft manifest SHA-256 into its exact projected inventory/provenance self-reference fields",
    )
    bind_self_reference.add_argument("--root", type=Path, default=ROOT)
    bind_self_reference.add_argument("--version", default=DEFAULT_VERSION)
    args = parser.parse_args()
    root = args.root.resolve()
    if args.command == "bind-self-reference":
        try:
            digest = bind_draft_manifest_self_reference(root, args.version)
            print(f"Bound {args.version} draft manifest self-reference SHA-256: {digest}")
            print("Only the documented manifest hash/revision self-reference fields were refreshed; draft gates remain unchanged.")
            return 0
        except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 1
    if args.command == "build":
        try:
            manifest = build_current_cli(root, args.version, materialize=not args.dry_run)
            encoded = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
            output_path = safe_path(root, f"release/{args.version}/manifest.json")
            if args.dry_run:
                print(f"Would write {output_path.relative_to(root)}")
                print(f"Collateral package readiness: {manifest['collateralPackageReadiness']['decision']} ({len(manifest['collateralPackageReadiness']['blockers'])} blockers)")
                print(f"External submission readiness: {manifest['externalSubmissionReadiness']['decision']} ({len(manifest['externalSubmissionReadiness']['blockers'])} blockers)")
                return 0
            archived = persist_draft_manifest(root, output_path, manifest, encoded)
            print(f"Wrote {output_path.relative_to(root)}")
            if archived:
                print(f"Archived prior draft manifest at {archived}")
            print(f"Collateral package readiness: {manifest['collateralPackageReadiness']['decision']} ({len(manifest['collateralPackageReadiness']['blockers'])} blockers)")
            print(f"External submission readiness: {manifest['externalSubmissionReadiness']['decision']} ({len(manifest['externalSubmissionReadiness']['blockers'])} blockers)")
            print("A BLOCKED draft manifest is still useful for review; it does not grant publication rights.")
            return 0
        except (OSError, ValueError, FileExistsError, KeyError, json.JSONDecodeError) as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 1
    manifest_path = args.manifest if args.manifest.is_absolute() else root / args.manifest
    try:
        manifest = read_json(manifest_path)
        errors = validate_manifest_files(root, manifest)
        errors.extend(verify_caption_receipt_records(manifest, root))
        current_manifest, readiness_errors = recompute_manifest_readiness(root, manifest)
        errors.extend(readiness_errors)
        if errors:
            for error in errors:
                print(f"ERROR: {error}", file=sys.stderr)
            return 1
        collateral = current_manifest.get("collateralPackageReadiness", {})
        external = current_manifest.get("externalSubmissionReadiness", {})
        print(f"Integrity: PASS ({len(manifest.get('assets', []))} manifest asset records; all present source/package checksums match)")
        print(f"Collateral package readiness: {collateral.get('decision', 'missing')} ({len(collateral.get('blockers', []))} recorded blockers)")
        print(f"External submission readiness: {external.get('decision', 'missing')} ({len(external.get('blockers', []))} recorded blockers)")
        print("Rehearsal-only or pending assets are not submission-ready.")
        if args.require_release_ready and collateral.get("decision") != "PASS":
            return 2
        return 0
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(_cli())
