"""Strict offline validation and rasterization for TicketStub's outlined SVG profile.

This is deliberately a small accepted format, not a general SVG sanitizer. Reject
anything outside the profile before handing bytes to the local renderer.
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import math
import os
from pathlib import Path
import platform
import re
import shutil
import struct
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zlib

from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path
from PIL import Image, PngImagePlugin

SVG_NS = "http://www.w3.org/2000/svg"
NUMBER = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?")
ATTRIBUTES = {
    "svg": {"viewBox", "width", "height", "role", "aria-label", "color", "preserveAspectRatio"},
    "title": set(), "defs": set(),
    "linearGradient": {"id", "x1", "y1", "x2", "y2"},
    "stop": {"offset", "stop-color"},
    "path": {"d", "fill", "fill-rule", "transform"},
    "g": {"fill", "transform"},
    "rect": {"width", "height", "x", "y", "fill", "transform"},
    "circle": {"cx", "cy", "r", "fill", "transform"},
}
CHILDREN = {
    "svg": {"title", "defs", "g", "path", "rect", "circle"},
    "g": {"g", "path", "rect", "circle"},
    "defs": {"linearGradient"}, "linearGradient": {"stop"},
}


class AssetError(ValueError):
    """An input or output does not meet the declared local review contract."""


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def number(value: str) -> float:
    if not NUMBER.fullmatch(value):
        raise AssetError(f"Invalid unitless SVG number: {value!r}")
    result = float(value)
    if not math.isfinite(result) or abs(result) > 1_000_000:
        raise AssetError("SVG number is not finite or exceeds the bounded profile")
    return result


def numbers(value: str, count: int | None = None) -> list[float]:
    if re.search(r"^\s*,|,\s*,|,\s*$", value):
        raise AssetError("Malformed SVG number separators")
    values = value.replace(",", " ").split()
    result = [number(part) for part in values]
    if not result or (count is not None and len(result) != count):
        raise AssetError(f"Expected {count or 'one or more'} SVG numbers")
    return result


def transform(value: str) -> Transform:
    result = Transform()
    remaining = value.strip()
    while remaining:
        match = re.match(r"(translate|scale)\(([^()]*)\)\s*", remaining)
        if not match:
            raise AssetError("Only bounded translate/scale transforms are supported")
        args = numbers(match[2])
        if len(args) not in (1, 2):
            raise AssetError("Transform must have one or two numbers")
        if match[1] == "translate":
            result = result.translate(args[0], args[1] if len(args) == 2 else 0)
        else:
            if min(args) <= 0:
                raise AssetError("Scale must be positive")
            result = result.scale(args[0], args[1] if len(args) == 2 else args[0])
        remaining = remaining[match.end():]
    return result


def validate_svg(data: bytes, *, expected_current_color: bool | None = None) -> dict:
    """Validate structure, resources, dimensions and transformed outline bounds.

    No DOCTYPE/entities/processing instructions, foreign namespace, CSS, event
    attributes, links, images, scripts, fonts, text glyphs or animation is accepted.
    """
    if len(data) > 1_000_000 or b"<!" in data or b"<?" in data:
        raise AssetError("SVG declarations, processing instructions or oversized input are forbidden")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise AssetError(f"Malformed SVG XML: {exc}") from exc
    if root.tag != f"{{{SVG_NS}}}svg":
        raise AssetError("SVG root must use the SVG namespace")
    try:
        x, y, width, height = numbers(root.attrib["viewBox"], 4)
        canvas_w, canvas_h = number(root.attrib["width"]), number(root.attrib["height"])
    except KeyError as exc:
        raise AssetError(f"Missing required dimension: {exc}") from exc
    if min(width, height, canvas_w, canvas_h) <= 0:
        raise AssetError("SVG dimensions must be positive")
    if not math.isclose(canvas_w / canvas_h, width / height, rel_tol=1e-6):
        raise AssetError("SVG width/height and viewBox aspect ratios differ")
    if root.get("preserveAspectRatio", "xMidYMid meet") != "xMidYMid meet":
        raise AssetError("Only xMidYMid meet aspect preservation is supported")
    if root.get("role") != "img" or not root.get("aria-label", "").strip():
        raise AssetError("SVG requires role=img and a nonempty aria-label")
    if len(root.findall(f"{{{SVG_NS}}}title")) != 1:
        raise AssetError("SVG requires exactly one title")

    ids: set[str] = set()
    references: set[str] = set()
    bounds: list[tuple[float, float, float, float]] = []
    path_count, current_color = 0, False

    def visit(node: ET.Element, parent: str | None, matrix: Transform) -> None:
        nonlocal path_count, current_color
        if not isinstance(node.tag, str) or not node.tag.startswith(f"{{{SVG_NS}}}"):
            raise AssetError("Foreign SVG content is forbidden")
        tag = node.tag.split("}", 1)[1]
        if tag not in ATTRIBUTES or (parent is not None and tag not in CHILDREN.get(parent, set())):
            raise AssetError(f"Unsupported SVG element or placement: {tag}")
        unknown = set(node.attrib) - ATTRIBUTES[tag]
        if unknown:
            raise AssetError(f"Unsupported attributes on {tag}: {sorted(unknown)}")
        if tag != "title" and (node.text or "").strip():
            raise AssetError("Only title text is supported; glyphs must be outlines")
        if (node.tail or "").strip():
            raise AssetError("Unexpected text outside the title")
        if tag == "title" and not (node.text or "").strip():
            raise AssetError("SVG title must not be empty")
        matrix = matrix.transform(transform(node.get("transform", "")))
        for name, value in node.attrib.items():
            if name in {"fill", "stop-color", "color"}:
                if value == "currentColor":
                    current_color = True
                elif match := re.fullmatch(r"url\(#([A-Za-z_][A-Za-z0-9_.-]*)\)", value):
                    if name != "fill":
                        raise AssetError("Only fill may reference a local gradient")
                    references.add(match[1])
                elif not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
                    raise AssetError("Only hex colors, currentColor and local gradient fills are supported")
            elif name == "id":
                if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]*", value) or value in ids:
                    raise AssetError("Gradient IDs must be unique bounded identifiers")
                ids.add(value)
            elif name == "fill-rule" and value not in {"evenodd", "nonzero"}:
                raise AssetError("Unsupported fill rule")
            elif name in {"width", "height", "x", "y", "cx", "cy", "r", "x1", "y1", "x2", "y2", "offset"}:
                numeric = number(value)
                if name in {"width", "height", "r"} and numeric <= 0:
                    raise AssetError("Shape dimensions must be positive")
                if name == "offset" and not 0 <= numeric <= 1:
                    raise AssetError("Gradient offset is outside 0..1")
        if tag == "path":
            path_count += 1
            d = node.get("d", "")
            if not d or re.search(r"[^MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]", d) or not d.rstrip().endswith(("z", "Z")):
                raise AssetError("Glyph paths must be closed valid outline data")
            for numeric in NUMBER.findall(d):
                number(numeric)
            pen = BoundsPen(None)
            try:
                parse_path(d, TransformPen(pen, matrix))
            except (ValueError, IndexError, TypeError, AssertionError, ZeroDivisionError) as exc:
                raise AssetError("Malformed outline path") from exc
            if pen.bounds is None or pen.bounds[0] >= pen.bounds[2] or pen.bounds[1] >= pen.bounds[3]:
                raise AssetError("Empty glyph outline")
            bounds.append(pen.bounds)
        elif tag in {"rect", "circle"}:
            try:
                if tag == "rect":
                    left, top = number(node.get("x", "0")), number(node.get("y", "0"))
                    right, bottom = left + number(node.attrib["width"]), top + number(node.attrib["height"])
                else:
                    cx, cy, radius = number(node.attrib["cx"]), number(node.attrib["cy"]), number(node.attrib["r"])
                    left, top, right, bottom = cx - radius, cy - radius, cx + radius, cy + radius
            except KeyError as exc:
                raise AssetError(f"Missing shape dimension: {exc}") from exc
            points = [matrix.transformPoint(p) for p in ((left, top), (right, bottom))]
            bounds.append((*points[0], *points[1]))
        for child in node:
            visit(child, tag, matrix)

    visit(root, None, Transform())
    if references - ids:
        raise AssetError("SVG references a missing local gradient")
    if not path_count:
        raise AssetError("Canonical marks must contain outlined glyph paths")
    if expected_current_color is not None and current_color != expected_current_color:
        raise AssetError("currentColor use differs from the output matrix")
    union = (min(b[0] for b in bounds), min(b[1] for b in bounds), max(b[2] for b in bounds), max(b[3] for b in bounds))
    if not all(math.isfinite(v) for v in union):
        raise AssetError("Transformed outline has non-finite bounds")
    tolerance = 0.025  # Existing generator rounds glyph coordinates to 0.01 units.
    if union[0] < x - tolerance or union[1] < y - tolerance or union[2] > x + width + tolerance or union[3] > y + height + tolerance:
        raise AssetError("Transformed outline exceeds the viewBox (clipping risk)")
    return {"viewBox": [x, y, width, height], "outline_bounds": [round(v, 5) for v in union], "path_count": path_count, "current_color": current_color}


def toolchain(config: dict) -> dict:
    actual = platform.python_version()
    if actual != config["python_version"]:
        raise AssetError(f"Pinned Python {config['python_version']} required; found {actual}")
    actual_platform = f"{platform.system().lower()}-{platform.machine().lower()}"
    if actual_platform != config["platform"]:
        raise AssetError(f"Pinned platform {config['platform']} required; found {actual_platform}")
    packages = {}
    for package, expected in config["python_packages"].items():
        try:
            packages[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError as exc:
            raise AssetError(f"Missing {package}; install tools/assets/requirements.txt") from exc
        if packages[package] != expected:
            raise AssetError(f"Pinned {package} {expected} required; found {packages[package]}")
    renderer = shutil.which("inkscape")
    if renderer is None:
        raise AssetError("Missing pinned Inkscape renderer")
    completed = subprocess.run([renderer, "--version"], check=True, capture_output=True, text=True, timeout=30)
    renderer_version = completed.stdout.strip()
    if renderer_version != config["renderer_version"]:
        raise AssetError(f"Renderer version differs: {renderer_version}")
    # The debug report includes native renderer/library versions, without host paths.
    debug = subprocess.run([renderer, "--debug-info"], check=True, capture_output=True, text=True, timeout=30).stdout.strip()
    return {"python": actual, "platform": actual_platform, "python_packages": packages,
            "renderer_version": renderer_version, "renderer_sha256": sha256(Path(renderer)),
            "renderer_debug_info": debug, "zlib_runtime": zlib.ZLIB_RUNTIME_VERSION}


def save_png(image: Image.Image, path: Path, *, dpi: int = 96) -> None:
    """Re-encode actual renderer pixels with minimal deterministic sRGB metadata."""
    metadata = PngImagePlugin.PngInfo()
    metadata.add(b"sRGB", b"\x00")  # Standard sRGB, perceptual rendering intent.
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGBA").save(path, format="PNG", pnginfo=metadata, dpi=(dpi, dpi), optimize=False, compress_level=9)


def rasterize(data: bytes, output: Path, width: int, height: int, *, color: str | None = None, dpi: int = 96) -> None:
    info = validate_svg(data)
    if not 1 <= width <= 4096 or not 1 <= height <= 4096:
        raise AssetError("Raster dimensions must be in 1..4096")
    if color is not None and not re.fullmatch(r"#[0-9A-Fa-f]{6}", color):
        raise AssetError("Explicit currentColor context must be a hex color")
    if info["current_color"] and color is None:
        raise AssetError("currentColor rasterization requires an explicit foreground")
    # Preserve the vector aspect ratio; integer pixel rounding becomes letterboxing,
    # never a stretched glyph. Only this temporary renderer input gets new dimensions.
    root = ET.fromstring(data)
    root.set("width", str(width))
    root.set("height", str(height))
    root.set("preserveAspectRatio", "xMidYMid meet")
    if color is not None:
        root.set("color", color)
    with tempfile.TemporaryDirectory(prefix="ticketstub-render-") as temporary:
        folder = Path(temporary)
        source, raw = folder / "input.svg", folder / "raw.png"
        source.write_bytes(ET.tostring(root, encoding="utf-8"))
        env = dict(os.environ)
        env.update({"INKSCAPE_PROFILE_DIR": str(folder / "profile"), "LC_ALL": "C", "TZ": "UTC"})
        completed = subprocess.run([
            "inkscape", "--batch-process", str(source), "--export-type=png", "--export-area-page",
            f"--export-filename={raw}", f"--export-width={width}", f"--export-height={height}",
            "--export-background-opacity=0", "--export-png-color-mode=RGBA_8", "--export-png-use-dithering=false",
        ], capture_output=True, text=True, env=env, timeout=60)
        if completed.returncode:
            raise AssetError(f"Inkscape failed ({completed.returncode}): {completed.stderr.strip()}")
        with Image.open(raw) as rendered:
            if rendered.size != (width, height):
                raise AssetError("Renderer returned incorrect dimensions")
            save_png(rendered, output, dpi=dpi)


def validate_png(path: Path, width: int, height: int, *, alpha: str, dpi: int = 96, knockout: bool = False) -> dict:
    if not 1 <= width <= 4096 or not 1 <= height <= 4096 or path.stat().st_size > 70_000_000:
        raise AssetError("PNG dimensions or input size exceeds the bounded profile")
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssetError("Expected a PNG file")
    offset, chunks = 8, []
    while offset < len(data):
        if offset + 12 > len(data):
            raise AssetError("Truncated PNG chunk")
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        tag = data[offset + 4:offset + 8]
        end = offset + 12 + length
        if end > len(data):
            raise AssetError("Truncated PNG chunk payload")
        crc = struct.unpack(">I", data[end - 4:end])[0]
        if zlib.crc32(data[offset + 4:end - 4]) & 0xFFFFFFFF != crc:
            raise AssetError("PNG chunk checksum mismatch")
        if tag not in {b"IHDR", b"sRGB", b"pHYs", b"IDAT", b"IEND"}:
            raise AssetError("Unexpected PNG metadata or content")
        payload = data[offset + 8:end - 4]
        lengths = {b"IHDR": 13, b"sRGB": 1, b"pHYs": 9, b"IEND": 0}
        if tag in lengths and length != lengths[tag]:
            raise AssetError("Malformed PNG fixed-length chunk")
        if tag == b"sRGB" and payload != b"\x00":
            raise AssetError("PNG must declare sRGB perceptual intent")
        if tag == b"pHYs" and payload[8] != 1:
            raise AssetError("PNG resolution metadata must use pixels per metre")
        if tag in {b"sRGB", b"pHYs"} and b"IDAT" in chunks:
            raise AssetError("PNG color/resolution metadata must precede image data")
        if tag == b"IDAT" and b"IDAT" in chunks and chunks[-1] != b"IDAT":
            raise AssetError("PNG image data chunks must be contiguous")
        if b"IEND" in chunks:
            raise AssetError("PNG contains data after the end marker")
        if tag == b"IHDR":
            if length != 13:
                raise AssetError("Malformed PNG header")
            header = struct.unpack(">IIBBBBB", data[offset + 8:end - 4])
            if header != (width, height, 8, 6, 0, 0, 0):
                raise AssetError("Wrong PNG dimensions or unsupported encoding header")
        chunks.append(tag)
        offset = end
    if any(chunks.count(tag) != 1 for tag in (b"IHDR", b"sRGB", b"pHYs", b"IEND")) or b"IDAT" not in chunks or not chunks or chunks[0] != b"IHDR" or chunks[-1] != b"IEND":
        raise AssetError("PNG metadata is missing, duplicated or misplaced")
    try:
        with Image.open(path) as image:
            image.load()
            if image.size != (width, height) or image.mode != "RGBA":
                raise AssetError("Wrong PNG dimensions or color mode")
            if image.info.get("srgb") != 0:
                raise AssetError("PNG must declare sRGB perceptual intent")
            if any(abs(v - dpi) > 0.025 for v in image.info.get("dpi", (0, 0))):
                raise AssetError("Wrong PNG resolution metadata")
            alpha_band = image.getchannel("A")
            extrema = alpha_band.getextrema()
            if alpha == "opaque" and extrema != (255, 255):
                raise AssetError("Opaque PNG contains transparency")
            # At 24px the full-colour stamp's edge bites can cover fractions of
            # every pixel. Partial alpha is still genuine transparency; demanding
            # a fully clear pixel would reject this unchanged canonical source.
            if alpha == "transparent" and not (extrema[0] < 255 and extrema[1] == 255):
                raise AssetError(f"Transparent PNG {path.name} needs non-opaque and opaque pixels")
            if alpha not in {"opaque", "transparent"}:
                raise AssetError("Unknown alpha contract")
            if knockout:
                inner = alpha_band.crop((width // 4, height // 4, width * 3 // 4, height * 3 // 4))
                if inner.getextrema()[0] != 0:
                    raise AssetError("Expected interior glyph knockout is absent")
            return {"width": width, "height": height, "mode": image.mode, "alpha_extrema": list(extrema),
                    "dpi": list(image.info["dpi"]), "color_space": "sRGB", "sha256": sha256(path),
                    "rgba_sha256": hashlib.sha256(image.tobytes()).hexdigest()}
    except (OSError, SyntaxError) as exc:
        raise AssetError("Malformed PNG image") from exc
