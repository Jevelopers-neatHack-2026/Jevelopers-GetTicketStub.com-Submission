"""Synthetic negative cases for the measured source palette; never approval records."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_accessibility as a
from token_lib import TokenError, load_model

ROOT = Path(__file__).resolve().parents[2]


class ContrastTests(unittest.TestCase):
    def test_black_white_reference_and_symmetry(self):
        black, white = a.parse_color('#000'), a.parse_color('#fff')
        self.assertEqual(a.contrast(black, white), 21.0)
        self.assertEqual(a.contrast(white, black), 21.0)
        self.assertEqual(a.contrast(black, black), 1.0)

    def test_threshold_does_not_round_up(self):
        self.assertFalse(a.meets(4.499999, 'normal-text'))
        self.assertTrue(a.meets(4.5, 'normal-text'))
        self.assertFalse(a.meets(2.999999, 'large-text'))
        self.assertFalse(a.meets(2.999999, 'ui'))

    def test_muted_alpha_known_result(self):
        model = load_model(ROOT)
        row = a.pair(model, 'semantic.day.text-muted', 'semantic.day.bg')
        self.assertAlmostEqual(row['ratio'], 5.53248256415345, places=12)
        self.assertAlmostEqual(row['foreground_srgb_0_to_255'][0], 98.14)

    def test_surface_is_composited_before_text(self):
        model = load_model(ROOT)
        with self.assertRaises(TokenError):
            a.pair(model, 'semantic.day.text-muted', 'semantic.day.surface')
        row = a.pair(model, 'semantic.day.text-muted', 'semantic.day.surface', 'semantic.day.bg')
        self.assertNotEqual(row['ratio'], a.pair(model, 'semantic.day.text-muted', 'semantic.day.bg')['ratio'])
        self.assertTrue(row['normal_text'])

    def test_known_prohibited_pairs(self):
        model = load_model(ROOT)
        for f, b in [('orange','cream'), ('copper','cream'), ('cyan','cream'), ('copper','ink'), ('orange','moss'), ('copper','moss')]:
            with self.subTest(pair=(f,b)):
                self.assertFalse(a.pair(model, 'color.'+f, 'color.'+b)['normal_text'])
        self.assertFalse(a.pair(model, 'color.cyan', 'color.orange')['ui_contrast'])
        self.assertTrue(a.pair(model, 'color.ink', 'color.orange')['normal_text'])

    def test_all_profile_color_syntaxes(self):
        self.assertEqual(a.parse_color('#1234'), a.parse_color('#11223344'))
        self.assertEqual(a.parse_color('rgb(23 20 15 / 0.66)'), a.parse_color('rgba(23,20,15,0.66)'))
        for v in ['#12345','transparent','linear-gradient(red,blue)','rgba(0,0,0,2)','rgb(256,0,0)',None]:
            with self.subTest(value=v), self.assertRaises(TokenError):
                a.parse_color(v)

    def test_unknown_or_noncolor_tokens_fail(self):
        model = load_model(ROOT)
        for path in ['missing', 'gradient.foil', 'font.weight.regular']:
            with self.subTest(path=path), self.assertRaises(TokenError):
                a.pair(model, path, 'color.cream')

    def test_full_matrix_is_deterministic_and_required_pairs_pass(self):
        one, two = a.make_report(ROOT), a.make_report(ROOT)
        self.assertEqual(a.outputs(one), a.outputs(two))
        self.assertEqual(len(one['palette']), 36)
        for row in one['semantic']:
            if row['required_use']:
                self.assertTrue(a.meets(row['ratio'], row['required_use']), row['id'])

    def test_changed_core_pair_fails_even_with_rebuilt_report(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            shutil.copytree(ROOT / 'tokens', root / 'tokens')
            (root / 'tools').mkdir()
            shutil.copy2(ROOT / 'tools/check_accessibility.py', root / 'tools/check_accessibility.py')
            source = root / 'tokens/tokens.json'
            tokens = json.loads(source.read_text())
            tokens['semantic']['day']['cta-label']['$value'] = '{color.cream}'
            source.write_text(json.dumps(tokens))
            report = a.make_report(root)
            for relative, content in a.outputs(report).items():
                p = root / relative
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(content)
            problems = a.check_report(root, report)
        self.assertTrue(any('day.cta-label fails required normal-text' in p for p in problems))

    def test_missing_css_variable_is_not_a_visual_pass(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            shutil.copytree(ROOT / 'tokens', root / 'tokens')
            css = root / 'tools/accessibility-fixture/fixture.css'
            css.parent.mkdir(parents=True)
            css.write_text('body {color: var(--ts-nonexistent);}')
            problems = a.check_report(root, a.make_report(ROOT))
        self.assertTrue(any('--ts-nonexistent' in p for p in problems))

    def test_missing_report_or_fixture_is_failure(self):
        report = a.make_report(ROOT)
        with tempfile.TemporaryDirectory() as d:
            problems = a.check_report(Path(d), report)
        self.assertTrue(any('report missing or stale' in p for p in problems))
        self.assertTrue(any('missing local fixture' in p for p in problems))

    def test_cli_negative_pair_and_invalid_source_exit_nonzero(self):
        base = [sys.executable, '-I', str(ROOT / 'tools/check_accessibility.py')]
        p = subprocess.run(base + ['pair','--foreground','color.copper','--background','color.ink'], capture_output=True, text=True)
        self.assertEqual(p.returncode, 1)
        self.assertFalse(json.loads(p.stdout)['passed'])
        with tempfile.TemporaryDirectory() as d:
            p = subprocess.run(base + ['check','--root',d], capture_output=True, text=True)
        self.assertEqual(p.returncode, 1)
        self.assertNotIn('Traceback', p.stderr)


if __name__ == '__main__':
    unittest.main()
