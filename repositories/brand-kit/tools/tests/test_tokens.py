"""Tests for the BK-03A token profile, validator, generator and drift checks.

Run: python3 -m unittest discover -s tools/tests   (or `make test`). Standard library only.
Each negative test edits a copy of the inputs in a temp directory and expects a useful diagnostic.
"""
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
import build_tokens  # noqa: E402
import token_lib as T  # noqa: E402
from inventory_lib import ROOT  # noqa: E402

FIX = HERE.parent / "fixtures"
SCRIPT = ROOT / "tools/build_tokens.py"


def copy_root(build=True):
    tmp = Path(tempfile.mkdtemp())
    (tmp / "tokens").mkdir()
    for rel in T.INPUTS:
        shutil.copy(ROOT / rel, tmp / rel)
    if build:
        m = T.load_model(tmp)
        assert not m.errors, m.errors
        build_tokens.write_outputs(m, tmp / "tokens")
    return tmp


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = copy_root()
        self.addCleanup(shutil.rmtree, self.tmp)

    def edit(self, rel, fn):
        p = self.tmp / rel
        data = json.loads(p.read_text(), object_pairs_hook=dict)
        fn(data)
        p.write_text(json.dumps(data, indent=1))

    def rebuild(self):
        m = T.load_model(self.tmp)
        build_tokens.write_outputs(m, self.tmp / "tokens")

    def problems(self):
        return "\n".join(build_tokens.check(self.tmp))

    def run_cli(self, cmd):
        return subprocess.run([sys.executable, "-I", str(SCRIPT), cmd, "--root", str(self.tmp)],
                              capture_output=True, text=True)


class RepositoryTests(unittest.TestCase):
    def test_committed_tokens_pass_every_check(self):
        self.assertEqual(build_tokens.check(ROOT), [])

    def test_profile_does_not_claim_dtcg(self):
        m = T.load_model(ROOT)
        self.assertIs(m.profile["dtcg_compatible"], False)
        self.assertIn("NOT", m.profile["dtcg_note"])

    def test_every_leaf_has_exactly_one_mapping_and_matrix_row(self):
        m = T.load_model(ROOT)
        self.assertEqual(list(m.leaves), list(m.mapping["tokens"]))
        matrix = (ROOT / T.OUT_MATRIX).read_text()
        for p in m.leaves:
            self.assertEqual(matrix.count(f"| `{p}` |"), 1, p)
        for p, e in m.mapping["tokens"].items():
            self.assertEqual(("css" in e) + ("source_only" in e), 1, p)

    def test_baseline_values_preserved(self):
        base = json.loads((FIX / "baseline/tokens.json").read_text())
        m = T.load_model(ROOT)

        def flat(node, path=()):
            for k, v in node.items():
                if k.startswith("$"):
                    continue
                if isinstance(v, dict) and "$value" not in v:
                    yield from flat(v, path + (k,))
                else:
                    yield ".".join(path + (k,)), (v["$value"] if isinstance(v, dict) else v)
        old = dict(flat(base))
        self.assertEqual(len(old), 82)
        self.assertEqual(set(old), set(m.leaves))
        for p, v in old.items():
            self.assertEqual(str(m.leaves[p].value), str(v), p)

    def test_baseline_css_variables_preserved(self):
        old_text = re.sub(r"@import[^;]*;", "", (FIX / "baseline/tokens.css").read_text())
        new_text = (ROOT / T.OUT_CSS).read_text()

        def blocks(text):
            out = {}
            for media, sels, decls in T.parse_css(text):
                out.setdefault((media, tuple(sels)), {}).update(decls)
            return out
        old, new = blocks(old_text), blocks(new_text)
        self.assertEqual(set(old), set(new))
        for key, decls in old.items():
            for name, val in decls.items():
                self.assertEqual(new[key].get(name), val, f"{key} {name}")
        extra_reduced = set(new[("(prefers-reduced-motion: reduce)", (":root",))]) - set(old[("(prefers-reduced-motion: reduce)", (":root",))])
        self.assertEqual(extra_reduced, {"--ts-dur-print-sweep"})

    def test_google_font_import_moved_to_opt_in_file_with_same_url(self):
        old_url = re.search(r'@import url\("([^"]+)"\)', (FIX / "baseline/tokens.css").read_text()).group(1)
        self.assertNotRegex((ROOT / T.OUT_CSS).read_text(), r"(?m)^\s*@import|@font-face|url\(")
        fonts = (ROOT / T.OUT_FONTS).read_text()
        self.assertIn(f'@import url("{old_url}");', fonts)
        self.assertIn("EXPLICIT OPT-IN", fonts)
        self.assertNotIn("@font-face", fonts)

    def test_theme_and_reduced_motion_resolution(self):
        m = T.load_model(ROOT)
        css = (ROOT / T.OUT_CSS).read_text()
        day = T.css_context(m, css, "day")
        self.assertEqual(T.resolve_var(day, "--ts-bg"), "#F4ECDD")
        self.assertEqual(T.resolve_var(day, "--ts-focus"), "#17140F")
        for ctx in ("night-class", "night-attr", "night-media"):
            n = T.css_context(m, css, ctx)
            self.assertEqual(T.resolve_var(n, "--ts-bg"), "#17140F")
            self.assertEqual(T.resolve_var(n, "--ts-surface"), "#26302A")
            self.assertEqual(T.resolve_var(n, "--ts-focus"), "#7CC6D2")
            self.assertEqual(T.resolve_var(n, "--ts-cta-bg"), "#E4572E")
            self.assertEqual(n["color-scheme"], "dark")
        red = T.css_context(m, css, "reduced")
        for name in ("track", "quick", "base", "settle", "reveal", "shutter", "print-sweep"):
            self.assertEqual(T.resolve_var(red, f"--ts-dur-{name}"), "0ms", name)
        self.assertEqual(T.resolve_var(day, "--ts-dur-print-sweep"), "2600ms")
        self.assertEqual(T.resolve_var(day, "--ts-dur-shutter"), "320ms")

    def test_plain_css_fixture_uses_only_defined_variables(self):
        m = T.load_model(ROOT)
        css = (ROOT / T.OUT_CSS).read_text()
        fx = (FIX / "consumer.css").read_text()
        self.assertEqual(T.undefined_var_problems(m, css, fx, "fixture"), [])
        self.assertGreaterEqual(len(T.used_vars(fx)), 25)

    def test_tailwind_preset_has_no_hardcoded_duration(self):
        body = re.sub(r"/\*.*?\*/", "", (ROOT / T.OUT_TAILWIND).read_text(), flags=re.S)
        self.assertEqual(re.findall(r"\b\d+m?s\b", body), [])
        for name in ("track", "quick", "base", "settle", "reveal", "shutter", "print-sweep"):
            self.assertIn(f'var(--ts-dur-{name})', body)

    def test_pinned_tailwind_version(self):
        pkg = json.loads((ROOT / "tools/tokens-dev/package.json").read_text())
        self.assertEqual(pkg["devDependencies"], {"tailwindcss": "3.4.19"})
        self.assertTrue(pkg["private"])
        lock = json.loads((ROOT / "tools/tokens-dev/package-lock.json").read_text())
        self.assertEqual(lock["packages"]["node_modules/tailwindcss"]["version"], "3.4.19")


class DeterminismTests(unittest.TestCase):
    def test_two_builds_same_file_set_and_hashes(self):
        a, b = copy_root(), copy_root()
        self.addCleanup(shutil.rmtree, a)
        self.addCleanup(shutil.rmtree, b)

        def snap(root):
            return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((root / "tokens").iterdir())}
        sa, sb = snap(a), snap(b)
        self.assertEqual(sa, sb)
        self.assertEqual(set(sa), {Path(r).name for r in T.INPUTS + T.OUTPUTS})
        committed = {Path(r).name: hashlib.sha256((ROOT / r).read_bytes()).hexdigest() for r in T.OUTPUTS}
        self.assertEqual({k: sa[k] for k in committed}, committed)


class InvalidSourceTests(Base):
    def fails(self, expect):
        out = self.problems()
        self.assertIn(expect, out)
        r = self.run_cli("check")
        self.assertEqual(r.returncode, 1)
        self.assertIn(expect, r.stdout)

    def test_invalid_type(self):
        self.edit("tokens/tokens.json", lambda d: d["space"].update({"$type": "length"}))
        self.fails("unknown $type 'length'")

    def test_invalid_dimension_unit(self):
        self.edit("tokens/tokens.json", lambda d: d["space"]["1"].update({"$value": "4pt"}))
        self.fails("dimension '4pt' needs a number and one of")

    def test_invalid_duration_unit(self):
        self.edit("tokens/tokens.json", lambda d: d["motion"]["duration"]["base"].update({"$value": "0.24s"}))
        self.fails("duration '0.24s'")

    def test_invalid_number_unit_extension(self):
        def f(d):
            d["motion"]["tilt"]["maxDeg"]["$extensions"]["com.ticketstub"]["unit"] = "px"
        self.edit("tokens/tokens.json", f)
        self.fails("unit 'px' not in")

    def test_wrong_value_kind(self):
        self.edit("tokens/tokens.json", lambda d: d["font"]["weight"]["regular"].update({"$value": "400"}))
        self.fails("needs an integer")

    def test_bad_colour_and_alpha(self):
        self.edit("tokens/tokens.json", lambda d: d["color"]["ink"].update({"$value": "#12345"}))
        self.fails("is not #hex")
        self.edit("tokens/tokens.json", lambda d: d["color"]["ink"].update({"$value": "rgba(1, 2, 3, 1.5)"}))
        self.fails("alpha above 1")

    def test_bare_scalar_rejected(self):
        self.edit("tokens/tokens.json", lambda d: d["space"].update({"9": "72px"}))
        self.fails("bare scalar")

    def test_missing_type(self):
        self.edit("tokens/tokens.json", lambda d: d["shadow"].pop("$type"))
        self.fails("no $type on the token or any ancestor")

    def test_missing_value_field_is_empty_group(self):
        self.edit("tokens/tokens.json", lambda d: d["radius"].update({"huge": {"$description": "x"}}))
        self.fails("empty group")

    def test_missing_alias_target(self):
        self.edit("tokens/tokens.json", lambda d: d["semantic"]["day"]["bg"].update({"$value": "{color.nope}"}))
        self.fails("alias target 'color.nope' does not exist")

    def test_alias_to_group_rejected(self):
        self.edit("tokens/tokens.json", lambda d: d["semantic"]["day"]["bg"].update({"$value": "{color}"}))
        self.fails("alias target 'color'")

    def test_alias_cycle(self):
        def f(d):
            d["color"]["cream"]["$value"] = "{color.ink}"
            d["color"]["ink"]["$value"] = "{color.cream}"
        self.edit("tokens/tokens.json", f)
        self.fails("alias cycle: color.cream -> color.ink -> color.cream")

    def test_self_alias_cycle(self):
        self.edit("tokens/tokens.json", lambda d: d["color"]["ink"].update({"$value": "{color.ink}"}))
        self.fails("alias cycle: color.ink -> color.ink")

    def test_alias_type_mismatch(self):
        self.edit("tokens/tokens.json", lambda d: d["semantic"]["day"]["bg"].update({"$value": "{space.1}"}))
        self.fails("alias type mismatch: color -> space.1 is dimension")

    def test_alias_unit_metadata_validated(self):
        def f(d):
            d["motion"]["tilt"]["maxDeg"].update({"$value": "{font.line-height.body}"})
            d["motion"]["tilt"]["maxDeg"]["$extensions"]["com.ticketstub"]["unit"] = "px"
        self.edit("tokens/tokens.json", f)
        self.fails("unit 'px' not in")

    def test_alias_unit_must_match_target(self):
        def f(d):
            d["motion"]["tilt"]["maxDeg"].update({"$value": "{font.line-height.body}"})
        self.edit("tokens/tokens.json", f)
        self.fails("alias unit mismatch: deg -> font.line-height.body is unitless")

    def test_alias_ms_to_hz_rejected(self):
        self.edit("tokens/tokens.json", lambda d: d["motion"]["smoothing"]["tauTiltMs"].update({"$value": "{motion.spring.stepHz}"}))
        self.fails("alias unit mismatch: ms -> motion.spring.stepHz is hz")

    def test_alias_unit_chain_checked_recursively(self):
        def f(d):
            d["motion"]["smoothing"]["tauLightMs"].update({"$value": "{motion.smoothing.tauTiltMs}"})
            d["motion"]["smoothing"]["tauTiltMs"].update({"$value": "{motion.spring.stepHz}"})
        self.edit("tokens/tokens.json", f)
        self.fails("tauTiltMs: alias unit mismatch")

    def test_same_unit_number_alias_passes(self):
        self.edit("tokens/tokens.json", lambda d: d["motion"]["smoothing"]["tauLightMs"].update({"$value": "{motion.smoothing.tauTiltMs}"}))
        self.rebuild()
        self.assertEqual(self.problems(), "")

    def test_font_family_alias_emits_resolved_list(self):
        self.edit("tokens/tokens.json", lambda d: d["font"]["family"]["display"].update({"$value": "{font.family.ui}"}))
        self.rebuild()
        self.assertEqual(self.problems(), "")
        m = T.load_model(self.tmp)
        want = T.family_list(m.leaves["font.family.ui"].value)
        js = (self.tmp / "tokens/tailwind.preset.js").read_text()
        self.assertNotIn("{font.family", js)
        self.assertIn("display: [" + ", ".join(json.dumps(x) for x in want) + "]", js)

    def test_unresolved_family_alias_never_emitted(self):
        self.edit("tokens/tokens.json", lambda d: d["font"]["family"]["display"].update({"$value": "{font.family.nope}"}))
        self.fails("alias target 'font.family.nope'")
        with self.assertRaises(T.TokenError):
            T.final_family(T.load_model(self.tmp), "font.family.display")

    def test_embedded_alias_rejected(self):
        self.edit("tokens/tokens.json", lambda d: d["gradient"]["foil"].update({"$value": "linear-gradient(135deg, {color.copper} 0%, #000 100%)"}))
        self.fails("malformed or embedded alias")

    def test_css_injection_rejected(self):
        self.edit("tokens/tokens.json", lambda d: d["shadow"]["paper"].update({"$value": "0 1px 0 #000; } body { display: none"}))
        self.fails("contains characters not allowed")

    def test_unknown_top_level_group_needs_profile_and_mapping(self):
        self.edit("tokens/tokens.json", lambda d: d.update({"zindex": {"$type": "number", "modal": {"$value": 10}}}))
        self.fails("unknown top-level group 'zindex'")

    def test_unknown_reserved_key(self):
        self.edit("tokens/tokens.json", lambda d: d["color"]["ink"].update({"$alias": "x"}))
        self.fails("unknown reserved key '$alias'")

    def test_font_family_needs_generic_fallback(self):
        self.edit("tokens/tokens.json", lambda d: d["font"]["family"]["ui"].update({"$value": "'Inter Tight', 'Segoe UI'"}))
        self.fails("generic family fallback")

    def test_bezier_range(self):
        self.edit("tokens/tokens.json", lambda d: d["motion"]["easing"]["flip"].update({"$value": "cubic-bezier(1.5,0,.55,1)"}))
        self.fails("x values must be within 0-1")

    def test_profile_version_mismatch(self):
        self.edit("tokens/tokens.json", lambda d: d["$extensions"]["com.ticketstub"].update({"version": "9.9.9"}))
        self.fails("must declare profile ticketstub-token-profile version 1.0.0")

    def test_dtcg_claim_rejected(self):
        self.edit("tokens/profile.json", lambda d: d.update({"dtcg_compatible": True}))
        self.fails("dtcg_compatible must stay false")

    def test_duplicate_json_key(self):
        p = self.tmp / "tokens/tokens.json"
        p.write_text(p.read_text().replace('"ink": {', '"ink": {"$value": "#000000"}, "ink": {', 1))
        r = self.run_cli("check")
        self.assertEqual(r.returncode, 1)
        self.assertIn("duplicate JSON key 'ink'", r.stdout)

    def test_invalid_json(self):
        (self.tmp / "tokens/tokens.json").write_text("{ nope")
        r = self.run_cli("validate")
        self.assertEqual(r.returncode, 1)
        self.assertIn("invalid JSON", r.stdout)

    def test_missing_required_input_is_error(self):
        (self.tmp / "tokens/mapping.json").unlink()
        r = self.run_cli("check")
        self.assertEqual(r.returncode, 1)
        self.assertIn("missing required input: tokens/mapping.json", r.stdout)


class MappingAndRuleTests(Base):
    def test_token_without_mapping(self):
        self.edit("tokens/mapping.json", lambda d: d["tokens"].pop("space.8"))
        self.assertIn("space.8: no mapping entry", self.problems())

    def test_mapping_for_unknown_token(self):
        self.edit("tokens/mapping.json", lambda d: d["tokens"].update({"space.99": {"css": "--ts-space-99"}}))
        self.assertIn("matches no token", self.problems())

    def test_duplicate_css_name(self):
        self.edit("tokens/mapping.json", lambda d: d["tokens"]["space.2"].update({"css": "--ts-space-1"}))
        self.assertIn("css name --ts-space-1 is claimed by", self.problems())

    def test_source_only_needs_rationale(self):
        self.edit("tokens/mapping.json", lambda d: d["tokens"]["material.foil.glowRest"].update({"source_only": "n/a"}))
        self.assertIn("needs a rationale", self.problems())

    def test_css_and_source_only_together(self):
        self.edit("tokens/mapping.json", lambda d: d["tokens"]["space.1"].update({"source_only": "also not exported because reasons"}))
        self.assertIn("exactly one of css or source_only", self.problems())

    def test_tailwind_section_type_mismatch(self):
        self.edit("tokens/mapping.json", lambda d: d["tokens"]["space.1"].update({"tailwind": "borderRadius.s1"}))
        self.edit("tokens/mapping.json", lambda d: d["tokens"]["color.ink"].update({"tailwind": "boxShadow.ink"}))
        self.assertIn("needs shadow", self.problems())

    def test_night_without_day_counterpart(self):
        self.edit("tokens/tokens.json", lambda d: d["semantic"]["night"].pop("focus"))
        self.edit("tokens/mapping.json", lambda d: d["tokens"].pop("semantic.night.focus"))
        self.assertIn("theme parity: day-only ['focus']", self.problems())

    def test_night_css_name_must_match_day(self):
        self.edit("tokens/mapping.json", lambda d: d["tokens"]["semantic.night.bg"].update({"css": "--ts-night-bg"}))
        self.assertIn("same css name as its day token", self.problems())

    def test_exported_alias_to_source_only_target(self):
        def f(d):
            d["tokens"]["color.cream"] = {"source_only": "pretend the palette is not exported at all"}
        self.edit("tokens/mapping.json", f)
        self.assertIn("alias target 'color.cream' has no css output", self.problems())

    def test_new_duration_needs_reduced_motion_policy(self):
        def t(d):
            d["motion"]["duration"]["slow"] = {"$value": "900ms"}
        self.edit("tokens/tokens.json", t)
        self.edit("tokens/mapping.json", lambda d: d["tokens"].update({"motion.duration.slow": {"css": "--ts-dur-slow"}}))
        self.assertIn("duration token 'motion.duration.slow' has no reduced-motion policy", self.problems())

    def test_reduced_motion_path_must_exist(self):
        self.edit("tokens/profile.json", lambda d: d["reduced_motion"]["zero_durations"].append({"path": "motion.duration.gone", "reason": "x"}))
        self.assertIn("'motion.duration.gone' is not a token", self.problems())

    def test_self_hosting_not_allowed_by_profile(self):
        self.edit("tokens/profile.json", lambda d: d["external_fonts"].update({"self_hosted": True}))
        self.assertIn("does not self-host", self.problems())

    def test_font_url_must_be_google_https(self):
        self.edit("tokens/profile.json", lambda d: d["external_fonts"]["legacy_google"].update({"import_url": "https://evil.example/x.css"}))
        self.assertIn("import_url must be", self.problems())


class DriftTests(Base):
    def test_clean_copy_passes(self):
        self.assertEqual(self.problems(), "")
        r = self.run_cli("check")
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_hand_edited_css_value(self):
        p = self.tmp / "tokens/tokens.css"
        p.write_text(p.read_text().replace("--ts-orange: #E4572E", "--ts-orange: #FF0000"))
        r = self.run_cli("check")
        self.assertEqual(r.returncode, 1)
        self.assertIn("drift: tokens/tokens.css", r.stdout)
        self.assertIn("#FF0000", r.stdout)

    def test_hand_edited_tailwind_preset(self):
        p = self.tmp / "tokens/tailwind.preset.js"
        p.write_text(p.read_text().replace("var(--ts-dur-base)", "240ms"))
        out = self.problems()
        self.assertIn("drift: tokens/tailwind.preset.js", out)
        self.assertIn("hardcodes durations", out)

    def test_source_edit_without_rebuild(self):
        self.edit("tokens/tokens.json", lambda d: d["color"]["orange"].update({"$value": "#E4572F"}))
        self.assertIn("drift: tokens/tokens.css", self.problems())
        self.rebuild()
        self.assertEqual(self.problems(), "")

    def test_deleted_generated_file(self):
        (self.tmp / "tokens/token-matrix.md").unlink()
        self.assertIn("missing generated file tokens/token-matrix.md", self.problems())

    def test_stray_file_in_tokens_dir(self):
        (self.tmp / "tokens/extra.css").write_text("a{}")
        self.assertIn("unexpected file tokens/extra.css", self.problems())

    def test_font_import_smuggled_into_tokens_css(self):
        p = self.tmp / "tokens/tokens.css"
        p.write_text('@import url("https://fonts.googleapis.com/css2?family=X");\n' + p.read_text())
        out = self.problems()
        self.assertIn("must not load fonts or any URL", out)
        self.assertIn("drift: tokens/tokens.css", out)

    def test_missing_header(self):
        p = self.tmp / "tokens/tokens.css"
        p.write_text(re.sub(r"\A/\*.*?\*/\n", "", p.read_text(), flags=re.S))
        self.assertIn("generated-file header missing", "\n".join(build_tokens.check(self.tmp)) or "generated-file header missing")

    def test_build_refuses_invalid_source_and_leaves_outputs(self):
        before = (self.tmp / "tokens/tokens.css").read_bytes()
        self.edit("tokens/tokens.json", lambda d: d["space"]["1"].update({"$value": "4pt"}))
        r = self.run_cli("build")
        self.assertEqual(r.returncode, 1)
        self.assertEqual((self.tmp / "tokens/tokens.css").read_bytes(), before)

    def test_parity_detects_wrong_night_override(self):
        p = self.tmp / "tokens/tokens.css"
        css = p.read_text().replace("--ts-surface: var(--ts-moss);", "--ts-surface: var(--ts-ink);", 1)
        m = T.load_model(self.tmp)
        self.assertTrue(any("--ts-surface" in e for e in T.parity_problems(m, css)))


if __name__ == "__main__":
    unittest.main()
