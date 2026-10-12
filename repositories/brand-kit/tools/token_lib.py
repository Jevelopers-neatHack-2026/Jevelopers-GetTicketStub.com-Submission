"""Token profile loader, validator and renderers for BK-03A. Standard library only (Python 3.9+).

Inputs (all under <root>/tokens): tokens.json (canonical values), profile.json (types, units,
theme and reduced-motion rules, external-font policy, Tailwind sections), mapping.json (per-token
outputs). See docs/token-profile.md.
"""
from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal
from pathlib import Path

TOKENS = "tokens/tokens.json"
PROFILE = "tokens/profile.json"
MAPPING = "tokens/mapping.json"
INPUTS = (TOKENS, PROFILE, MAPPING)
OUT_CSS = "tokens/tokens.css"
OUT_TAILWIND = "tokens/tailwind.preset.js"
OUT_FONTS = "tokens/external-fonts-google.css"
OUT_MATRIX = "tokens/token-matrix.md"
OUTPUTS = (OUT_CSS, OUT_TAILWIND, OUT_FONTS, OUT_MATRIX)
EXT_NS = "com.ticketstub"

NUM = r"(?:\d+\.?\d*|\.\d+)"
ALIAS_RE = re.compile(r"^\{([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\}$")
SEGMENT_RE = re.compile(r"^[A-Za-z0-9_-]+$")
HEX_RE = re.compile(r"^#(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$")
RGB_RE = re.compile(r"^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*(" + NUM + r")\s*)?\)$")
DIM_RE = re.compile(r"^-?" + NUM + r"(px|rem|em)$")
DUR_RE = re.compile(r"^" + NUM + r"(ms)$")
BEZIER_RE = re.compile(r"^cubic-bezier\(\s*(-?" + NUM + r")\s*,\s*(-?" + NUM + r")\s*,\s*(-?" + NUM + r")\s*,\s*(-?" + NUM + r")\s*\)$")
LEN = r"(?:-?" + NUM + r"(?:px|rem|em)|0)"
COLOR = r"(?:#[0-9A-Fa-f]{3,8}|rgba?\([^()]*\))"
SHADOW_LAYER_RE = re.compile(r"^(?:inset\s+)?" + LEN + r"\s+" + LEN + r"(?:\s+" + LEN + r"){0,2}\s+" + COLOR + r"$")
GRADIENT_RE = re.compile(r"^(?:repeating-)?linear-gradient\(.+\)$", re.S)
CSS_NAME_RE = re.compile(r"^--ts-[a-z0-9]+(?:-[a-z0-9]+)*$|^--ts-step--1$")
UNSAFE = re.compile(r"[;<>@\\]|/\*|\*/|url\(|expression\(|@import", re.I)
GENERIC_FAMILIES = {"serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif",
                    "ui-sans-serif", "ui-monospace", "ui-rounded"}
RGBA_ANY = re.compile(r"rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(" + NUM + r")\s*)?\)")


class TokenError(Exception):
    pass


# ---------------------------------------------------------------- loading

def _pairs(pairs):
    out = {}
    for k, v in pairs:
        if k in out:
            raise TokenError(f"duplicate JSON key '{k}'")
        out[k] = v
    return out


def _reject_constant(name):
    raise TokenError(f"non-finite JSON number '{name}'")


def read_text(root: Path, rel: str) -> str:
    p = root / rel
    if not p.is_file():
        raise TokenError(f"missing required input: {rel}")
    return p.read_bytes().decode("utf-8").replace("\r\n", "\n")


def load_json(root: Path, rel: str):
    text = read_text(root, rel)
    try:
        return json.loads(text, object_pairs_hook=_pairs, parse_float=Decimal, parse_constant=_reject_constant)
    except json.JSONDecodeError as exc:
        raise TokenError(f"{rel}: invalid JSON: {exc}")
    except TokenError as exc:
        raise TokenError(f"{rel}: {exc}")


def input_hashes(root: Path) -> dict:
    return {rel: hashlib.sha256(read_text(root, rel).encode("utf-8")).hexdigest() for rel in INPUTS}


def num_text(v) -> str:
    return format(v, "f") if isinstance(v, Decimal) else str(v)


# ---------------------------------------------------------------- model

class Leaf:
    def __init__(self, path, node, type_):
        self.path, self.node, self.type = path, node, type_
        self.value = node.get("$value")
        ext = node.get("$extensions")
        self.unit = ext.get(EXT_NS, {}).get("unit") if isinstance(ext, dict) and isinstance(ext.get(EXT_NS), dict) else None

    def alias(self):
        if isinstance(self.value, str):
            m = ALIAS_RE.match(self.value)
            return m.group(1) if m else None
        return None


def walk(tree, profile, errors):
    """Return {path: Leaf} in source order, validating structure and $type inheritance."""
    leaves = {}
    allowed = set(profile["allowed_node_keys"])
    types = profile["types"]

    def visit(node, path, inherited):
        where = ".".join(path) or "<root>"
        if not isinstance(node, dict):
            errors.append(f"{where}: bare scalar or non-object node; wrap it as {{\"$value\": ...}} with a $type")
            return
        for k in node:
            if k.startswith("$") and k not in allowed:
                errors.append(f"{where}: unknown reserved key '{k}'")
        t = node.get("$type", inherited)
        if "$type" in node and node["$type"] not in types:
            errors.append(f"{where}: unknown $type '{node['$type']}' (profile types: {', '.join(types)})")
            t = None
        for k in node:
            if not k.startswith("$") and not SEGMENT_RE.match(k):
                errors.append(f"{where}: invalid token name '{k}'")
        if "$value" in node:
            extra = [k for k in node if not k.startswith("$")]
            if extra:
                errors.append(f"{where}: token has $value and child keys {extra}")
            if t is None:
                errors.append(f"{where}: no $type on the token or any ancestor")
            else:
                leaves[".".join(path)] = Leaf(".".join(path), node, t)
            return
        children = [k for k in node if not k.startswith("$")]
        if not children and path:
            errors.append(f"{where}: empty group")
        for k in children:
            visit(node[k], path + (k,), t)

    root_keys = [k for k in tree if not k.startswith("$")]
    for k in tree:
        if k.startswith("$") and k not in allowed:
            errors.append(f"<root>: unknown reserved key '{k}'")
    for g in profile["top_level_groups"]:
        if g not in tree:
            errors.append(f"missing required top-level group '{g}'")
    for k in root_keys:
        if k not in profile["top_level_groups"]:
            errors.append(f"unknown top-level group '{k}': add it to tokens/profile.json top_level_groups and give it a mapping")
        else:
            visit(tree[k], (k,), None)
    return leaves


def split_top(s: str):
    parts, depth, cur = [], 0, ""
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur.strip())
            cur = ""
        else:
            cur += ch
    parts.append(cur.strip())
    return parts, depth


def check_value(leaf: Leaf, profile, errors):
    t, v, p = leaf.type, leaf.value, leaf.path
    spec = profile["types"][t]
    if leaf.unit is not None:
        if t != "number":
            errors.append(f"{p}: $extensions unit is only valid on $type number")
        elif "units" in spec and leaf.unit not in spec["units"]:
            errors.append(f"{p}: unit {leaf.unit!r} not in {spec['units']}")
    if leaf.alias():
        return
    if isinstance(v, str) and UNSAFE.search(v):
        errors.append(f"{p}: value {v!r} contains characters not allowed in a token value")
        return
    if isinstance(v, str) and "{" in v and "}" in v:
        errors.append(f"{p}: malformed or embedded alias {v!r}; an alias must be the whole value like {{group.name}}")
        return
    kind = spec["kind"]
    if kind == "string" and not isinstance(v, str):
        errors.append(f"{p}: $type {t} needs a string, got {type(v).__name__}")
        return
    if kind == "number" and (isinstance(v, bool) or not isinstance(v, (int, Decimal))):
        errors.append(f"{p}: $type {t} needs a JSON number, got {type(v).__name__}")
        return
    if kind == "integer" and (isinstance(v, bool) or not isinstance(v, int)):
        errors.append(f"{p}: $type {t} needs an integer, got {v!r}")
        return
    if t == "color":
        if HEX_RE.match(v):
            return
        m = RGB_RE.match(v)
        if not m:
            errors.append(f"{p}: color {v!r} is not #hex, rgb()/rgba() or an alias")
        else:
            if any(int(c) > 255 for c in m.groups()[:3]):
                errors.append(f"{p}: color channel above 255 in {v!r}")
            if m.group(4) is not None and Decimal(m.group(4)) > 1:
                errors.append(f"{p}: alpha above 1 in {v!r}")
    elif t == "dimension":
        if not DIM_RE.match(v):
            errors.append(f"{p}: dimension {v!r} needs a number and one of {spec['units']}")
    elif t == "duration":
        if not DUR_RE.match(v):
            errors.append(f"{p}: duration {v!r} needs a non-negative number and unit {spec['units']}")
    elif t == "fontWeight":
        if not spec["min"] <= v <= spec["max"]:
            errors.append(f"{p}: font weight {v} outside {spec['min']}-{spec['max']}")
    elif t == "fontFamily":
        parts, depth = split_top(v)
        bad = [x for x in parts if not re.match(r"""^(?:'[^'"]+'|"[^'"]+"|[A-Za-z0-9_-]+)$""", x)]
        if depth or bad or len(parts) < 2:
            errors.append(f"{p}: font family list {v!r} needs 2+ comma-separated names (quoted or plain identifiers)")
        elif parts[-1] not in GENERIC_FAMILIES:
            errors.append(f"{p}: font family list must end with a generic family fallback, got {parts[-1]!r}")
    elif t == "cubicBezier":
        m = BEZIER_RE.match(v)
        if not m:
            errors.append(f"{p}: cubic-bezier {v!r} needs four numbers")
        elif not (0 <= Decimal(m.group(1)) <= 1 and 0 <= Decimal(m.group(3)) <= 1):
            errors.append(f"{p}: cubic-bezier x values must be within 0-1 in {v!r}")
    elif t == "gradient":
        _, depth = split_top(v)
        if depth or not GRADIENT_RE.match(v):
            errors.append(f"{p}: gradient {v!r} must be one balanced linear-gradient()/repeating-linear-gradient()")
    elif t == "shadow":
        layers, depth = split_top(v)
        if depth or not layers or not all(SHADOW_LAYER_RE.match(x) for x in layers):
            errors.append(f"{p}: shadow {v!r} needs comma-separated layers of 2-4 lengths then a colour")


def effective_unit(leaves, leaf):
    """Effective number unit: the declared unit, else the unit of the alias target chain (None = unitless)."""
    seen = set()
    while leaf.unit is None and leaf.alias() and leaf.path not in seen:
        seen.add(leaf.path)
        nxt = leaves.get(leaf.alias())
        if nxt is None:
            return None
        leaf = nxt
    return leaf.unit


def resolve(leaves, path, errors, seen=None):
    """Follow aliases to the final leaf; report missing target, type mismatch and cycles."""
    chain = []
    cur = leaves.get(path)
    if cur is None:
        return None
    while cur.alias():
        target = cur.alias()
        chain.append(cur.path)
        if target in chain or target == cur.path:
            errors.append(f"alias cycle: {' -> '.join(chain + [target])}")
            return None
        nxt = leaves.get(target)
        if nxt is None:
            errors.append(f"{cur.path}: alias target '{target}' does not exist or is a group, not a token")
            return None
        if nxt.type != cur.type:
            errors.append(f"{cur.path}: alias type mismatch: {cur.type} -> {target} is {nxt.type}")
            return None
        if cur.type == "number" and cur.unit != effective_unit(leaves, nxt):
            errors.append(f"{cur.path}: alias unit mismatch: {cur.unit or 'unitless'} -> {target} is {effective_unit(leaves, nxt) or 'unitless'}")
            return None
        cur = nxt
    return cur


class Model:
    def __init__(self, root, tokens, profile, mapping, leaves, errors):
        self.root, self.tokens, self.profile, self.mapping = root, tokens, profile, mapping
        self.leaves, self.errors = leaves, errors

    def final(self, path):
        return resolve(self.leaves, path, [])

    def css_name(self, path):
        e = self.mapping["tokens"].get(path, {})
        return e.get("css")

    def theme_pairs(self):
        base, over = self.profile["themes"]["base_group"], self.profile["themes"]["override_group"]
        return base + ".", over + "."


def load_model(root: Path) -> Model:
    errors: list[str] = []
    tokens = load_json(root, TOKENS)
    profile = load_json(root, PROFILE)
    mapping = load_json(root, MAPPING)
    if not isinstance(tokens, dict) or not isinstance(profile, dict) or not isinstance(mapping, dict):
        raise TokenError("tokens.json, profile.json and mapping.json must each be a JSON object")
    for key in ("profile", "version", "types", "top_level_groups", "allowed_node_keys", "themes",
                "reduced_motion", "external_fonts", "tailwind"):
        if key not in profile:
            raise TokenError(f"{PROFILE}: missing required key '{key}'")
    if profile.get("dtcg_compatible") is not False:
        errors.append(f"{PROFILE}: dtcg_compatible must stay false until a pinned DTCG validator passes")
    ext = tokens.get("$extensions", {}).get(EXT_NS, {}) if isinstance(tokens.get("$extensions"), dict) else {}
    if ext.get("profile") != profile["profile"] or ext.get("version") != profile["version"]:
        errors.append(f"{TOKENS}: $extensions.{EXT_NS} must declare profile {profile['profile']} version {profile['version']}, found {ext or 'nothing'}")
    leaves = walk(tokens, profile, errors)
    for leaf in leaves.values():
        check_value(leaf, profile, errors)
    for path in leaves:
        resolve(leaves, path, errors)
    m = Model(root, tokens, profile, mapping, leaves, errors)
    check_mapping(m)
    check_rules(m)
    errors[:] = list(dict.fromkeys(errors))
    return m


# ---------------------------------------------------------------- mapping and rules

def check_mapping(m: Model):
    errors, leaves, mapping, profile = m.errors, m.leaves, m.mapping, m.profile
    if mapping.get("profile") != f"{profile['profile']}@{profile['version']}":
        errors.append(f"{MAPPING}: profile must be {profile['profile']}@{profile['version']}")
    entries = mapping.get("tokens")
    if not isinstance(entries, dict):
        errors.append(f"{MAPPING}: 'tokens' must be an object")
        return
    for p in leaves:
        if p not in entries:
            errors.append(f"{p}: no mapping entry; add css (and optional tailwind) or a source_only rationale to {MAPPING}")
    for p in entries:
        if p not in leaves:
            errors.append(f"{MAPPING}: entry '{p}' matches no token in {TOKENS}")
    sections = profile["tailwind"]["sections"]
    css_owner: dict = {}
    tw_owner: dict = {}
    for p, e in entries.items():
        if not isinstance(e, dict):
            errors.append(f"{MAPPING}: entry '{p}' must be an object")
            continue
        unknown = set(e) - {"css", "tailwind", "source_only"}
        if unknown:
            errors.append(f"{MAPPING}: entry '{p}' has unknown keys {sorted(unknown)}")
        if ("css" in e) == ("source_only" in e):
            errors.append(f"{MAPPING}: entry '{p}' needs exactly one of css or source_only")
            continue
        if "source_only" in e:
            if "tailwind" in e:
                errors.append(f"{MAPPING}: '{p}' is source_only and cannot have a tailwind output")
            if not isinstance(e["source_only"], str) or len(e["source_only"].strip()) < 20:
                errors.append(f"{MAPPING}: '{p}' source_only needs a rationale of at least 20 characters")
            continue
        if not isinstance(e["css"], str) or not CSS_NAME_RE.match(e["css"]):
            errors.append(f"{MAPPING}: '{p}' css name {e['css']!r} must look like --ts-name")
            continue
        css_owner.setdefault(e["css"], []).append(p)
        if "tailwind" in e:
            sec, _, key = str(e["tailwind"]).partition(".")
            if sec not in sections or not SEGMENT_RE.match(key):
                errors.append(f"{MAPPING}: '{p}' tailwind {e['tailwind']!r} must be <section>.<key> with section in {list(sections)}")
            else:
                if p in leaves and leaves[p].type != sections[sec]["type"]:
                    errors.append(f"{MAPPING}: '{p}' is {leaves[p].type} but tailwind section {sec} needs {sections[sec]['type']}")
                tw_owner.setdefault(e["tailwind"], []).append(p)
    base, over = m.theme_pairs()
    for name, owners in css_owner.items():
        if len(owners) == 1:
            continue
        ok = len(owners) == 2 and owners[0].startswith(base) and owners[1].startswith(over) \
            and owners[0][len(base):] == owners[1][len(over):]
        if not ok:
            errors.append(f"{MAPPING}: css name {name} is claimed by {owners}; only a day/night pair may share a name")
    for name, owners in tw_owner.items():
        if len(owners) > 1:
            errors.append(f"{MAPPING}: tailwind key {name} is claimed by {owners}")
    day = {p[len(base):] for p in leaves if p.startswith(base)}
    night = {p[len(over):] for p in leaves if p.startswith(over)}
    if day != night:
        errors.append(f"theme parity: day-only {sorted(day - night)}, night-only {sorted(night - day)}")
    for p in leaves:
        if p.startswith(over) and "tailwind" in entries.get(p, {}):
            errors.append(f"{MAPPING}: night token '{p}' must not have its own tailwind output (the variable switches)")
        if p.startswith(over) and p.replace(over, base, 1) in entries and entries[p].get("css") != entries[p.replace(over, base, 1)].get("css"):
            errors.append(f"{MAPPING}: night token '{p}' must use the same css name as its day token")
        if p.startswith((base, over)) and "source_only" in entries.get(p, {}):
            errors.append(f"{MAPPING}: theme token '{p}' cannot be source_only")
    for p, leaf in leaves.items():
        a = leaf.alias()
        e = entries.get(p, {})
        if a and "css" in e:
            te = entries.get(a, {})
            if "css" not in te:
                errors.append(f"{p}: exported but its alias target '{a}' has no css output, so var() would dangle")
            elif te["css"] == e["css"]:
                errors.append(f"{p}: alias renders var({te['css']}) inside {e['css']} (self-reference)")
        elif a and "source_only" in e:
            pass


def check_rules(m: Model):
    errors, leaves, mapping, profile = m.errors, m.leaves, m.mapping["tokens"], m.profile
    rm = profile["reduced_motion"]
    listed = []
    for item in rm["zero_durations"]:
        p = item.get("path")
        listed.append(p)
        if p not in leaves:
            errors.append(f"reduced_motion: '{p}' is not a token")
        elif leaves[p].type != "duration":
            errors.append(f"reduced_motion: '{p}' is {leaves[p].type}, not duration")
        elif "css" not in mapping.get(p, {}):
            errors.append(f"reduced_motion: '{p}' has no css output to override")
        if not item.get("reason"):
            errors.append(f"reduced_motion: '{p}' needs a reason")
    if len(set(listed)) != len(listed):
        errors.append("reduced_motion: duplicate path in zero_durations")
    for p, leaf in leaves.items():
        if leaf.type == "duration" and p not in listed:
            errors.append(f"reduced_motion: duration token '{p}' has no reduced-motion policy; add it to {PROFILE} zero_durations")
    for key in ("base_group", "override_group"):
        g = profile["themes"][key]
        if not any(p.startswith(g + ".") for p in leaves):
            errors.append(f"themes.{key}: '{g}' has no tokens")
    fonts = profile["external_fonts"]
    if fonts.get("self_hosted") is not False:
        errors.append("external_fonts.self_hosted must be false: this repository does not self-host or convert fonts")
    url = fonts.get("legacy_google", {}).get("import_url", "")
    if not url.startswith("https://fonts.googleapis.com/") or UNSAFE.search(url.replace("@", "")) or '"' in url:
        errors.append("external_fonts.legacy_google.import_url must be an https://fonts.googleapis.com/ URL without quotes or CSS syntax")


# ---------------------------------------------------------------- rendering

def render_family_css(v: str) -> str:
    parts, _ = split_top(v)
    return ", ".join('"' + x[1:-1] + '"' if x[0] in "'\"" else x for x in parts)


def final_family(m, path):
    """Resolved font-family value; an unresolved alias must never reach an adapter."""
    final = m.final(path)
    if final is None or final.alias() or not isinstance(final.value, str):
        raise TokenError(f"{path}: font family alias does not resolve to a literal family list")
    return final.value


def family_list(v: str):
    parts, _ = split_top(v)
    return [x[1:-1] if x[0] in "'\"" else x for x in parts]


def render_color(v: str) -> str:
    m = RGB_RE.match(v)
    if not m:
        return v
    r, g, b, a = m.groups()
    return f"rgb({r} {g} {b} / {a})" if a is not None else f"rgb({r} {g} {b})"


def render_literal(leaf: Leaf) -> str:
    t, v = leaf.type, leaf.value
    if t == "color":
        return render_color(v)
    if t == "shadow":
        return RGBA_ANY.sub(lambda mo: render_color(mo.group(0)), v)
    if t == "fontFamily":
        return render_family_css(v)
    if t == "cubicBezier":
        return "cubic-bezier(" + ", ".join(BEZIER_RE.match(v).groups()) + ")"
    if t == "number":
        return num_text(v) + (leaf.unit or "")
    if t == "fontWeight":
        return str(v)
    return v


def render_css_value(m: Model, leaf: Leaf) -> str:
    a = leaf.alias()
    if a:
        return f"var({m.css_name(a)})"
    return render_literal(leaf)


def resolved_literal(m: Model, path: str) -> str:
    return render_literal(m.final(path))


def base_over(m: Model):
    base, over = m.theme_pairs()
    return base, over


def css_entries(m: Model):
    """Ordered (path, css name, value) for every css-mapped token outside the night group."""
    base, over = base_over(m)
    out = []
    for p, leaf in m.leaves.items():
        e = m.mapping["tokens"][p]
        if "css" in e and not p.startswith(over):
            out.append((p, e["css"], render_css_value(m, leaf)))
    return out


def night_overrides(m: Model):
    base, over = base_over(m)
    out = []
    day_vals = {p: v for p, _, v in css_entries(m)}
    for p, leaf in m.leaves.items():
        if p.startswith(over):
            dp = base + p[len(over):]
            v = render_css_value(m, leaf)
            if v != day_vals[dp]:
                out.append((p, m.css_name(p), v))
    return out


def header(m: Model, kind: str, lead: str, comment) -> str:
    hashes = input_hashes(m.root)
    lines = ["GENERATED FILE - DO NOT EDIT BY HAND.", lead,
             "Source of truth: tokens/tokens.json (rules: tokens/profile.json, outputs: tokens/mapping.json).",
             "Generator: tools/build_tokens.py. Regenerate with `make build-tokens`; `make check-tokens` fails on drift.",
             f"Profile: {m.profile['profile']} {m.profile['version']} (not claimed DTCG-compatible)."]
    lines += [f"Input sha256 {rel}: {h}" for rel, h in hashes.items()]
    return comment(lines)


def block_comment(lines):
    return "/* " + "\n   ".join(lines) + " */\n"


def section_key(path: str):
    parts = path.split(".")
    return ".".join(parts[:2]) if parts[0] in ("semantic", "font", "motion", "material") else parts[0]


def render_css(m: Model) -> str:
    th = m.profile["themes"]
    rm = m.profile["reduced_motion"]
    out = [header(m, "css", "Loads no fonts and makes no network request. Opt-in web fonts: tokens/external-fonts-google.css.", block_comment)]
    out.append(f"{th['base_selector']} {{")
    last = None
    for p, name, val in css_entries(m):
        k = section_key(p)
        if k != last:
            if last is not None:
                out.append("")
            out.append(f"  /* {k} */")
            last = k
        out.append(f"  {name}: {val};")
    out.append("}\n")
    ov = night_overrides(m)
    decls = [f"{n}: {v};" for _, n, v in ov] + [f"{k}: {v};" for k, v in th["override_declarations"].items()]
    out.append("/* night stage: only variables whose value differs from day */")
    out.append(",\n".join(th["override_selectors"]) + " {")
    out += [f"  {d}" for d in decls]
    out.append("}")
    mq = th["override_media"]
    out.append(f"@media {mq['query']} {{\n  {mq['selector']} {{")
    out += [f"    {d}" for d in decls]
    out.append("  }\n}\n")
    out.append("/* reduced motion: durations go to 0ms so transitions and loops built on the variables stop */")
    out.append(f"@media {rm['media']} {{\n  {rm['selector']} {{")
    out += [f"    {m.css_name(i['path'])}: 0ms;" for i in rm["zero_durations"]]
    out.append("  }\n}")
    return "\n".join(out) + "\n"


def js_key(k: str) -> str:
    return k if re.match(r"^[A-Za-z_$][A-Za-z0-9_$]*$", k) else json.dumps(k)


def render_tailwind(m: Model) -> str:
    secs = m.profile["tailwind"]["sections"]
    data = {s: [] for s in secs}
    for p, leaf in m.leaves.items():
        e = m.mapping["tokens"][p]
        if "tailwind" in e:
            sec, _, key = e["tailwind"].partition(".")
            if secs[sec]["form"] == "family-list":
                val = "[" + ", ".join(json.dumps(x) for x in family_list(final_family(m, p))) + "]"
            else:
                val = json.dumps(f"var({e['css']})")
            data[sec].append((key, val))
    lines = ["module.exports = {", "  theme: {", "    extend: {"]
    for sec, items in data.items():
        if items:
            lines.append(f"      {sec}: {{")
            lines += [f"        {js_key(k)}: {v}," for k, v in items]
            lines.append("      },")
    lines += ["    },", "  },", "};"]
    head = "/**\n * " + "\n * ".join([
        "GENERATED FILE - DO NOT EDIT BY HAND.",
        f"Tailwind adapter for {m.profile['tailwind']['supported']}.",
        "Values reference the CSS variables in tokens.css, so the night theme and reduced-motion overrides apply without a rebuild.",
        "Usage: presets: [require(\"@ticketstub/brand-kit/tokens/tailwind.preset.js\")] plus tokens.css loaded by the page (no package is published).",
        "Source of truth: tokens/tokens.json (rules: tokens/profile.json, outputs: tokens/mapping.json).",
        "Generator: tools/build_tokens.py. Regenerate with `make build-tokens`; `make check-tokens` fails on drift.",
        f"Profile: {m.profile['profile']} {m.profile['version']} (not claimed DTCG-compatible).",
    ] + [f"Input sha256 {rel}: {h}" for rel, h in input_hashes(m.root).items()]) + "\n */\n"
    return head + "\n".join(lines) + "\n"


def render_fonts(m: Model) -> str:
    g = m.profile["external_fonts"]["legacy_google"]
    head = header(m, "css", "EXTERNAL FONT HOSTING, EXPLICIT OPT-IN. Not imported by tokens.css.", block_comment)
    note = ("/* Importing this file makes the visitor's browser request " + g["hosts"][0] + " (CSS) and "
            + g["hosts"][1] + " (font files), which discloses the visitor's IP address and page context to Google.\n"
            "   It reproduces the @import that tokens.css carried before BK-03A so existing sites keep their fonts after migrating.\n"
            "   It is not a font provider or hosting decision, and this repository does not self-host or convert fonts.\n"
            "   Put this import before any other rule in the consuming stylesheet. Omit it to use only the fallback stacks. */\n")
    return head + note + f'@import url("{g["import_url"]}");\n'


def esc(s) -> str:
    return str(s).replace("|", "\\|").replace("\n", " ")


def render_matrix(m: Model) -> str:
    entries = m.mapping["tokens"]
    base, over = base_over(m)
    rm = m.profile["reduced_motion"]
    zero = {i["path"] for i in rm["zero_durations"]}
    day_vals = {p: v for p, _, v in css_entries(m)}
    n_css = sum(1 for e in entries.values() if "css" in e)
    n_tw = sum(1 for e in entries.values() if "tailwind" in e)
    n_src = sum(1 for e in entries.values() if "source_only" in e)
    out = ["<!-- GENERATED FILE - DO NOT EDIT BY HAND. Source: tokens/tokens.json, tokens/profile.json, tokens/mapping.json. "
           "Generator: tools/build_tokens.py (`make build-tokens`); `make check-tokens` fails on drift. "
           + " ".join(f"{rel} sha256 {h}." for rel, h in input_hashes(m.root).items()) + " -->",
           "# Token coverage matrix", "",
           f"Profile `{m.profile['profile']}` {m.profile['version']}. Every leaf of `tokens/tokens.json` appears once. "
           f"{len(entries)} tokens: {n_css} exported as CSS variables, {n_tw} also exposed in the Tailwind adapter, {n_src} source-only.", "",
           "| Token path | Type | Source value | CSS variable | Tailwind | Status / notes |", "|---|---|---|---|---|---|"]
    for p, leaf in m.leaves.items():
        e = entries[p]
        notes = []
        css = f"`{e['css']}`" if "css" in e else "none"
        tw = f"`{e['tailwind']}`" if "tailwind" in e else "none"
        if "source_only" in e:
            notes.append("source-only: " + e["source_only"])
        elif p.startswith(over):
            dp = base + p[len(over):]
            same = render_css_value(m, leaf) == day_vals[dp]
            notes.append("night override of the day variable" if not same else "night value equals day; no override emitted (cascade identical)")
        elif p.startswith(base):
            notes.append("day theme default on :root")
        else:
            notes.append("exported")
        if p in zero:
            notes.append("reduced motion: 0ms")
        if leaf.unit:
            notes.append(f"unit {leaf.unit} declared in source")
        if "tailwind" in e:
            notes.append("Tailwind value is var(" + e["css"] + ")" if m.profile["tailwind"]["sections"][e["tailwind"].split(".")[0]]["form"] == "var" else "Tailwind value is the literal family list")
        out.append(f"| `{p}` | {leaf.type} | `{esc(leaf.value)}` | {css} | {tw} | {esc('; '.join(notes))} |")
    out += ["", "## Theme rules", "",
            f"- Default (`{m.profile['themes']['base_selector']}`): `{m.profile['themes']['base_group']}`.",
            f"- Night (`{', '.join(m.profile['themes']['override_selectors'])}`, and under `@media {m.profile['themes']['override_media']['query']}` for `{m.profile['themes']['override_media']['selector']}`): `{m.profile['themes']['override_group']}` where it differs from day, plus `color-scheme: dark`.",
            f"- Night variables emitted: {', '.join('`' + n + '`' for _, n, _ in night_overrides(m))}.", "",
            "## Reduced-motion rules", "",
            f"`@media {rm['media']}` sets these variables to `0ms` on `{rm['selector']}`:", ""]
    out += [f"- `{m.css_name(i['path'])}` (`{i['path']}`): {i['reason']}" for i in rm["zero_durations"]]
    out += ["", rm["loop_policy"], ""]
    return "\n".join(out)


def render_all(m: Model) -> dict:
    return {OUT_CSS: render_css(m), OUT_TAILWIND: render_tailwind(m),
            OUT_FONTS: render_fonts(m), OUT_MATRIX: render_matrix(m)}


# ---------------------------------------------------------------- generated CSS reader (parity checks)

def parse_css(text: str):
    """Minimal reader for the generated CSS: [(media or None, selectors list, {decl: value})]."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    rules, media, buf, i = [], [], "", 0
    stack = []
    for ch in text:
        if ch == "{":
            head = buf.strip()
            buf = ""
            stack.append(head)
        elif ch == "}":
            body = buf
            buf = ""
            head = stack.pop()
            if head.startswith("@media"):
                continue
            decls = {}
            for d in body.split(";"):
                if ":" in d:
                    k, _, v = d.partition(":")
                    decls[k.strip()] = " ".join(v.split())
            media_q = next((h[len("@media"):].strip() for h in stack if h.startswith("@media")), None)
            rules.append((media_q, [s.strip() for s in head.split(",")], decls))
        else:
            buf += ch
    return rules


def css_context(m: Model, text: str, context: str):
    """Variables in effect for 'day', 'night-class', 'night-attr', 'night-media', 'reduced'."""
    th, rm = m.profile["themes"], m.profile["reduced_motion"]
    mq = th["override_media"]
    env = {}
    for media_q, sels, decls in parse_css(text):
        if media_q is None and sels == [th["base_selector"]]:
            env.update(decls)
    for media_q, sels, decls in parse_css(text):
        if context == "night-class" and media_q is None and th["override_selectors"][0] in sels:
            env.update(decls)
        if context == "night-attr" and media_q is None and th["override_selectors"][1] in sels:
            env.update(decls)
        if context == "night-media" and media_q == mq["query"] and sels == [mq["selector"]]:
            env.update(decls)
        if context == "reduced" and media_q == rm["media"] and sels == [rm["selector"]]:
            env.update(decls)
    return env


def resolve_var(env: dict, name: str, depth: int = 0) -> str:
    val = env[name]
    for _ in range(20):
        mo = re.fullmatch(r"var\((--[a-z0-9-]+)\)", val)
        if not mo:
            return val
        val = env[mo.group(1)]
    raise TokenError(f"var() chain too deep or cyclic at {name}")


def parity_problems(m: Model, css_text: str) -> list:
    """Compare every exported variable, resolved from the generated CSS, with the JSON-resolved value."""
    errs = []
    base, over = base_over(m)
    entries = m.mapping["tokens"]
    for ctx in ("day", "night-class", "night-attr", "night-media", "reduced"):
        env = css_context(m, css_text, ctx)
        for p, leaf in m.leaves.items():
            e = entries[p]
            if "css" not in e:
                continue
            is_night = ctx.startswith("night")
            if p.startswith(over) != is_night and p.startswith((base, over)):
                continue
            try:
                got = resolve_var(env, e["css"])
            except (KeyError, TokenError):
                errs.append(f"[{ctx}] {e['css']} ({p}) is not defined or does not resolve")
                continue
            want = resolved_literal(m, p)
            if ctx == "reduced" and p in {i["path"] for i in m.profile["reduced_motion"]["zero_durations"]}:
                want = "0ms"
            if got != want:
                errs.append(f"[{ctx}] {e['css']} ({p}) resolves to {got!r}, source says {want!r}")
        if ctx.startswith("night") and env.get("color-scheme") != "dark":
            errs.append(f"[{ctx}] color-scheme: dark missing")
    return errs


def used_vars(css_text: str) -> set:
    return set(re.findall(r"var\((--[A-Za-z0-9_-]+)", re.sub(r"/\*.*?\*/", "", css_text, flags=re.S)))


def undefined_var_problems(m: Model, css_text: str, consumer_css: str, label: str) -> list:
    defined = {e["css"] for e in m.mapping["tokens"].values() if "css" in e}
    return [f"{label}: uses {v}, which tokens.css/the mapping does not define"
            for v in sorted(used_vars(consumer_css) - defined) if not v.startswith("--tw-")]
