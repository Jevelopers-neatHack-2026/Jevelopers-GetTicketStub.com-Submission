"""Validate one local SVG/PNG; success is structural QA, never release approval."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from asset_lib import AssetError, validate_png, validate_svg


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="format", required=True)
    svg = subparsers.add_parser("svg")
    svg.add_argument("path", type=Path)
    png = subparsers.add_parser("png")
    png.add_argument("path", type=Path)
    png.add_argument("--width", type=int, required=True)
    png.add_argument("--height", type=int, required=True)
    png.add_argument("--alpha", choices=("opaque", "transparent"), required=True)
    png.add_argument("--dpi", type=int, default=96)
    png.add_argument("--knockout", action="store_true")
    args = parser.parse_args()
    try:
        if args.format == "svg":
            result = validate_svg(args.path.read_bytes())
        else:
            result = validate_png(args.path, args.width, args.height, alpha=args.alpha, dpi=args.dpi, knockout=args.knockout)
    except (AssetError, OSError) as exc:
        print(f"ASSET CHECK FAILED: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"outcome": "pass", "scope": "structural QA only; no approval", **result}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
