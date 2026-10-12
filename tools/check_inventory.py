"""Validate inventory/brand-inventory.json against the repository.

Offline and deterministic: reads files only. Exit 0 when every check passes, 1 otherwise.

    python3 tools/check_inventory.py [--root DIR]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from inventory_lib import INVENTORY, ROOT, list_files  # noqa: E402

REQUIRED = ["id", "path", "type", "category", "classification", "description", "owner_role",
            "approval_status", "provenance_status", "release_class", "canonical_authority"]
INDEX_DOC = "docs/source-of-truth.md"


def check(root: Path, include_untracked: bool = False) -> list[str]:
    errors: list[str] = []
    inv_path = root / INVENTORY
    if not inv_path.is_file():
        return [f"missing required input: {INVENTORY}"]
    try:
        inv = json.loads(inv_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"{INVENTORY}: invalid JSON: {exc}"]
    entries = inv.get("entries")
    if not isinstance(entries, list) or not entries:
        return [f"{INVENTORY}: 'entries' must be a non-empty list"]
    enums = inv.get("enums", {})

    ids: set[str] = set()
    paths: set[str] = set()
    for i, e in enumerate(entries):
        where = f"entries[{i}] ({e.get('path', '?')})"
        for key in REQUIRED:
            if not e.get(key):
                errors.append(f"{where}: missing required field '{key}'")
        if e.get("id") in ids:
            errors.append(f"{where}: duplicate id '{e.get('id')}'")
        ids.add(e.get("id"))
        if e.get("path") in paths:
            errors.append(f"{where}: duplicate path '{e.get('path')}'")
        paths.add(e.get("path"))
        for field in ("classification", "approval_status", "provenance_status", "release_class"):
            if field in enums and e.get(field) not in enums[field]:
                errors.append(f"{where}: {field} '{e.get(field)}' not in enum {enums[field]}")
        if e.get("path") and not (root / e["path"]).is_file():
            errors.append(f"{where}: path does not exist")
        if e.get("classification") == "generated":
            for key in ("generated_by", "generated_from"):
                if not e.get(key):
                    errors.append(f"{where}: generated entry needs '{key}'")
        if e.get("classification") == "derived-manual" and str(e.get("generated_by", "")).endswith(".py"):
            errors.append(f"{where}: derived-manual entry names a generator; classify it 'generated'")

    all_paths = paths
    for i, e in enumerate(entries):
        where = f"entries[{i}] ({e.get('path', '?')})"
        refs = [e.get("canonical_authority"), e.get("usage_guidance"), e.get("licence_file")]
        refs += list(e.get("generated_from") or []) + list(e.get("inputs") or []) + list(e.get("covers") or [])
        if e.get("generated_by", "").endswith(".py"):
            refs.append(e["generated_by"])
        for ref in filter(None, refs):
            if ref not in all_paths:
                errors.append(f"{where}: reference '{ref}' is not a catalogued path")
            elif not (root / ref).is_file():
                errors.append(f"{where}: reference '{ref}' does not exist")

    tracked = set(list_files(root, include_untracked))
    for f in sorted(tracked - all_paths):
        errors.append(f"uncatalogued file: {f}")
    for f in sorted(all_paths - tracked):
        errors.append(f"catalogued path is not a tracked file: {f}")

    for topic in inv.get("source_of_truth", []):
        for p in topic.get("paths", []):
            if p not in all_paths:
                errors.append(f"source_of_truth '{topic.get('topic')}': '{p}' is not catalogued")
        for p in topic.get("generated_outputs", []) + topic.get("derived_manual_outputs", []):
            if not (root / p).exists():
                errors.append(f"source_of_truth '{topic.get('topic')}': output '{p}' does not exist")
    for m in inv.get("path_map", []):
        for p in m.get("actual", []):
            if not (root / p).exists():
                errors.append(f"path_map '{m.get('proposed')}': actual path '{p}' does not exist")

    index = root / INDEX_DOC
    if not index.is_file():
        errors.append(f"missing source-of-truth index: {INDEX_DOC}")
    else:
        text = index.read_text(encoding="utf-8")
        for topic in inv.get("source_of_truth", []):
            for p in topic.get("paths", []):
                if p not in text:
                    errors.append(f"{INDEX_DOC} does not mention source_of_truth path '{p}'")
    readme = root / "README.md"
    if not readme.is_file() or INDEX_DOC not in readme.read_text(encoding="utf-8"):
        errors.append(f"README.md does not link {INDEX_DOC}")
    return errors


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", type=Path, default=ROOT)
    ap.add_argument("--include-untracked", action="store_true",
                    help="authoring aid: also require untracked-unignored files to be catalogued (default: tracked files only)")
    args = ap.parse_args(argv)
    errors = check(args.root.resolve(), args.include_untracked)
    if errors:
        for e in errors:
            print(f"FAIL {e}")
        print(f"check-inventory: {len(errors)} problem(s)")
        return 1
    inv = json.loads((args.root / INVENTORY).read_text(encoding="utf-8"))
    print(f"check-inventory: OK ({len(inv['entries'])} entries cover all tracked files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
