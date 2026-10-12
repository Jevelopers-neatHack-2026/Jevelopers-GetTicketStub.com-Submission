"""Offline regression tests for snapshot fidelity and safe updates."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('sync', Path(__file__).resolve().parents[1] / 'scripts/sync_submission.py')
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


def git(root, *args):
    return sync.run('git', '-C', str(root), *args)


def init(root):
    root.mkdir(parents=True)
    git(root, 'init', '-q', '-b', 'main')
    git(root, 'config', 'user.name', 'Snapshot Test')
    git(root, 'config', 'user.email', 'snapshot@example.invalid')


def commit(root):
    git(root, 'add', '-f', '--all')
    git(root, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture')
    return git(root, 'rev-parse', 'HEAD').strip()


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.source = self.base / 'source'
        init(self.source)

    def test_export_preserves_ignored_files_modes_and_safe_symlinks(self):
        (self.source / '.gitignore').write_text('ignored.txt\n')
        (self.source / '.gitattributes').write_text('ignored.txt export-ignore\n')
        (self.source / 'ignored.txt').write_bytes(b'tracked\x00data\r\n')
        executable = self.source / 'run.sh'
        executable.write_text('#!/bin/sh\nexit 0\n')
        executable.chmod(0o755)
        (self.source / 'link').symlink_to('ignored.txt')
        sha = commit(self.source)
        output = self.base / 'export'
        count = sync.export_tree(self.source, sha, output)
        self.assertEqual(count, 5)
        self.assertEqual((output / 'ignored.txt').read_bytes(), b'tracked\x00data\r\n')
        self.assertEqual((output / 'run.sh').stat().st_mode & 0o777, 0o755)
        self.assertEqual(os.readlink(output / 'link'), 'ignored.txt')
        self.assertFalse((output / '.git').exists())

    def test_escaping_symlink_rejected(self):
        (self.source / 'escape').symlink_to('../../outside')
        sha = commit(self.source)
        with self.assertRaisesRegex(RuntimeError, 'Symlink escapes'):
            sync.export_tree(self.source, sha, self.base / 'export')

    def test_lfs_pointer_rejected(self):
        (self.source / 'asset').write_text('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 42\n')
        sha = commit(self.source)
        with self.assertRaisesRegex(RuntimeError, 'LFS object'):
            sync.export_tree(self.source, sha, self.base / 'export')

    def test_submodule_rejected(self):
        (self.source / 'file').write_text('hello')
        sha = commit(self.source)
        git(self.source, 'update-index', '--add', '--cacheinfo', f'160000,{sha},module')
        git(self.source, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'gitlink')
        with self.assertRaisesRegex(RuntimeError, 'Unsupported source entry'):
            sync.export_tree(self.source, 'HEAD', self.base / 'export')

    def test_discovery_excludes_private_and_submission_but_includes_new_public(self):
        repos = [{'name': 'new-project', 'private': False, 'visibility': 'public'},
                 {'name': 'checkpoint', 'private': True, 'visibility': 'private'},
                 {'name': sync.TARGET, 'private': False, 'visibility': 'public'}]
        with patch.object(sync, 'run', return_value=json.dumps([repos])):
            self.assertEqual([r['name'] for r in sync.discover()], ['new-project'])

    def test_update_deletes_removed_files_and_unchanged_snapshot_is_noop(self):
        (self.source / 'README.md').write_text('handwritten guide')
        old = self.source / 'repositories' / 'project'
        old.mkdir(parents=True)
        (old / 'removed').write_text('obsolete')
        commit(self.source)
        for iteration in range(2):
            stage = self.base / f'stage-{iteration}'
            new = stage / 'repositories' / 'project'
            new.mkdir(parents=True)
            (new / '.gitignore').write_text('ignored\n')
            (new / 'ignored').write_text('must be retained')
            (stage / 'sources.json').write_text('{}\n')
            (stage / 'REPOSITORIES.md').write_text('index\n')
            with patch.object(sync, 'ROOT', self.source):
                self.assertEqual(sync.apply_snapshot(stage), iteration == 0)
            if iteration == 0:
                commit(self.source)
        self.assertFalse((old / 'removed').exists())
        self.assertEqual((self.source / 'README.md').read_text(), 'handwritten guide')
        self.assertIn('repositories/project/ignored', git(self.source, 'ls-files'))

    def test_scan_failure_does_not_apply_or_publish(self):
        stage = self.base / 'stage'
        stage.mkdir()
        with patch.object(sync.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'redacted finding')):
            with self.assertRaisesRegex(RuntimeError, 'nothing was published'):
                sync.scan(stage, self.base)
        self.assertFalse((self.source / 'repositories').exists())

    def test_reviewed_findings_reject_changed_files_and_new_matches(self):
        stage = self.base / 'stage'
        stage.mkdir()
        file = stage / 'fixture.txt'
        file.write_text('synthetic fixture')
        finding = {'File': str(file), 'RuleID': 'example-rule', 'StartLine': 1,
                   'StartColumn': 1, 'EndLine': 1, 'EndColumn': 10}
        path, digest, location = sync.finding_identity(finding, stage)
        scripts = self.source / 'scripts'
        scripts.mkdir()
        (scripts / 'reviewed-scan-findings.json').write_text(json.dumps({'files': [
            {'path': path, 'sha256': digest, 'findings': [location]}]}))
        with patch.object(sync, 'ROOT', self.source):
            self.assertEqual(sync.unreviewed_findings([finding], stage), [])
            extra = dict(finding, StartColumn=2)
            self.assertEqual(sync.unreviewed_findings([extra], stage), [extra])
            file.write_text('changed credential-shaped value')
            self.assertEqual(sync.unreviewed_findings([finding], stage), [finding])

    def test_invalid_paths_rejected(self):
        for path in ('../escape', '/absolute', 'nested/.git/config', 'a/../../b'):
            with self.subTest(path=path), self.assertRaises(RuntimeError):
                sync.safe_path(path)


if __name__ == '__main__':
    unittest.main()
