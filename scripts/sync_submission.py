#!/usr/bin/env python3
"""Publish reproducible source snapshots; never execute source-repository code."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ORG = 'Jevelopers-neatHack-2026'
TARGET = 'Jevelopers-GetTicketStub.com-Submission'
REMOTE = f'https://github.com/{ORG}/{TARGET}.git'
MANAGED = ('repositories', 'sources.json', 'REPOSITORIES.md')


def run(*args, cwd=None, data=None, binary=False):
    result = subprocess.run(args, cwd=cwd, input=data, capture_output=True, text=not binary)
    if result.returncode:
        detail = result.stderr.decode(errors='replace') if binary else result.stderr
        raise RuntimeError(f'{args[0]} failed: {detail.strip()}')
    return result.stdout


def api(endpoint):
    return json.loads(run('gh', 'api', '--hostname', 'github.com', endpoint))


def discover():
    # Paginate the REST endpoint: no fixed repository-count ceiling.
    pages = json.loads(run('gh', 'api', '--hostname', 'github.com', '--paginate', '--slurp',
                          f'orgs/{ORG}/repos?per_page=100&type=all'))
    repos = []
    for repo in (item for page in pages for item in page):
        if repo['name'].lower() == TARGET.lower():
            continue
        if repo['private'] or repo.get('visibility', 'public') != 'public':
            print(f"Excluding non-public repository: {repo['name']}", flush=True)
            continue
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', repo['name']) or repo['name'] in ('.', '..'):
            raise RuntimeError('Unsafe repository name')
        repos.append(repo)
    if not repos:
        raise RuntimeError('No public source repositories found; refusing an empty snapshot')
    return sorted(repos, key=lambda repo: repo['name'].lower())


def safe_path(name):
    path = PurePosixPath(name)
    if path.is_absolute() or any(p.lower() == '.git' or p in ('', '.', '..') for p in name.split('/')):
        raise RuntimeError(f'Unsafe source path: {name}')
    return path


def export_tree(git_dir, sha, destination):
    """Read Git blobs directly: preserve tracked files, modes and safe symlinks.

    No hooks, smudge filters, export-ignore rules, or source scripts are executed.
    Reject submodules/LFS rather than silently submitting pointers in place of code.
    """
    tree = run('git', '-C', str(git_dir), 'ls-tree', '-rz', '--full-tree', sha, binary=True)
    entries = []
    for entry in tree.split(b'\0'):
        if not entry:
            continue
        meta, raw_name = entry.split(b'\t', 1)
        mode, kind, oid = meta.decode().split()
        name = raw_name.decode('utf-8')
        safe_path(name)
        if kind != 'blob' or mode not in ('100644', '100755', '120000'):
            raise RuntimeError(f'Unsupported source entry (e.g. submodule): {name}')
        entries.append((mode, oid, name))
    destination.mkdir(parents=True)
    with subprocess.Popen(['git', '-C', str(git_dir), 'cat-file', '--batch'],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE) as process:
        try:
            for mode, oid, name in entries:
                process.stdin.write((oid + '\n').encode())
                process.stdin.flush()
                header = process.stdout.readline().decode().split()
                if len(header) != 3 or header[1] != 'blob':
                    raise RuntimeError(f'Cannot read blob: {name}')
                size = int(header[2])
                if size >= 95 * 1024 * 1024:
                    raise RuntimeError(f'File too large for ordinary Git publication: {name}')
                content = process.stdout.read(size)
                if len(content) != size or process.stdout.read(1) != b'\n':
                    raise RuntimeError(f'Incomplete blob: {name}')
                if content.startswith(b'version https://git-lfs.github.com/spec/v1\n'):
                    raise RuntimeError(f'LFS object needs explicit materialization: {name}')
                path = destination / name
                path.parent.mkdir(parents=True, exist_ok=True)
                if mode == '120000':
                    target = content.decode('utf-8')
                    if os.path.isabs(target) or not (path.parent / target).resolve().is_relative_to(destination.resolve()):
                        raise RuntimeError(f'Symlink escapes its source repository: {name}')
                    path.symlink_to(target)
                else:
                    path.write_bytes(content)
                    path.chmod(0o755 if mode == '100755' else 0o644)
        except BaseException:
            process.kill()
            raise
        finally:
            process.stdin.close()
        if process.wait() != 0:
            raise RuntimeError('Git blob export failed')
    return len(entries)


def fetch_source(repo, temporary, stage):
    name = repo['name']
    # Recheck visibility immediately before downloading; a privacy change must fail closed.
    current = api(f'repos/{ORG}/{name}')
    if current['private'] or current.get('visibility', 'public') != 'public':
        raise RuntimeError(f'Source is no longer public: {name}')
    branch = current['default_branch']
    source = temporary / name
    run('git', 'init', '--bare', '--quiet', str(source))
    print(f'Fetching {name} ({branch})', flush=True)
    run('git', '-C', str(source), '-c', 'core.hooksPath=/dev/null', 'fetch', '--quiet',
        '--depth=1', f'https://github.com/{ORG}/{name}.git', f'refs/heads/{branch}')
    sha = run('git', '-C', str(source), 'rev-parse', 'FETCH_HEAD').strip()
    count = export_tree(source, sha, stage / 'repositories' / name)
    return {'name': name, 'path': f'repositories/{name}', 'url': current['html_url'],
            'branch': branch, 'commit': sha,
            'tree': run('git', '-C', str(source), 'rev-parse', f'{sha}^{{tree}}').strip(),
            'committed_at': run('git', '-C', str(source), 'show', '-s', '--format=%cI', sha).strip(),
            'description': current.get('description') or '', 'tracked_files': count}


def write_index(stage, entries):
    (stage / 'sources.json').write_text(json.dumps({
        'schema_version': 1, 'organization': ORG, 'strategy': 'public-default-branch-snapshots',
        'repositories': entries}, indent=2) + '\n')
    lines = ['# Source repository index', '',
             'Each folder contains actual tracked source files at the linked commit. '
             'Original authorship, event-dated commits, and full development history remain in the source repositories.', '',
             '| Repository | Purpose | Branch | Source commit |', '| --- | --- | --- | --- |']
    for repo in entries:
        description = repo['description'].replace('|', '\\|').replace('\n', ' ')
        lines.append(f"| [{repo['name']}]({repo['path']}/) | {description} | `{repo['branch']}` | "
                     f"[{repo['commit'][:12]}]({repo['url']}/commit/{repo['commit']}) |")
    lines += ['', 'Machine-readable provenance: [sources.json](sources.json).', '']
    (stage / 'REPOSITORIES.md').write_text('\n'.join(lines))


def finding_identity(finding, stage):
    relative = Path(finding['File']).relative_to(stage).as_posix()
    # Archive members use archive.tar.gz!member paths in Gitleaks reports.
    outer = relative.split('!', 1)[0]
    digest = hashlib.sha256((stage / outer).read_bytes()).hexdigest()
    location = ':'.join(str(finding.get(key, '')) for key in
                        ('RuleID', 'StartLine', 'StartColumn', 'EndLine', 'EndColumn'))
    return relative, digest, location


def unreviewed_findings(findings, stage):
    baseline = ROOT / 'scripts' / 'reviewed-scan-findings.json'
    approved = set()
    if baseline.exists():
        for entry in json.loads(baseline.read_text())['files']:
            for location in entry['findings']:
                approved.add((entry['path'], entry['sha256'], location))
    return [finding for finding in findings if finding_identity(finding, stage) not in approved]


def scan(stage, scratch):
    # Explicit default rules prevent source .gitleaks.toml / ignore comments suppressing findings.
    config = scratch / 'gitleaks.toml'
    config.write_text('[extend]\nuseDefault = true\n')
    report_fd, report_name = tempfile.mkstemp(prefix='ticketstub-secret-scan-', suffix='.json')
    os.close(report_fd)
    result = subprocess.run(['gitleaks', 'dir', str(stage), '--config', str(config),
                             '--gitleaks-ignore-path', str(scratch / 'no-ignore-file'),
                             '--ignore-gitleaks-allow', '--redact', '--no-banner',
                             '--max-archive-depth', '2', '--exit-code', '42', '--report-format', 'json',
                             '--report-path', report_name], capture_output=True, text=True)
    # Use a dedicated leak exit code to distinguish findings from scanner failures.
    if result.returncode not in (0, 42):
        raise RuntimeError(f'Secret scanner failed; nothing was published. Report: {report_name}\n' + result.stderr)
    findings = json.loads(Path(report_name).read_text() or '[]')
    if result.returncode == 42 and not findings:
        raise RuntimeError('Scanner reported findings without a usable report; nothing was published')
    unexpected = unreviewed_findings(findings, stage)
    if unexpected:
        raise RuntimeError(f'{len(unexpected)} unreviewed secret-scan findings; nothing was published. '
                           f'Redacted report: {report_name}')
    if findings:
        print(f'{len(findings)} previously reviewed fixture/identifier matches; exact file hashes verified.', flush=True)
    Path(report_name).unlink(missing_ok=True)
    print('Secret scan passed.', flush=True)


def check_checkout(publish):
    if run('git', 'rev-parse', '--show-toplevel', cwd=ROOT).strip() != str(ROOT):
        raise RuntimeError('Run from a dedicated submission checkout')
    if run('git', 'status', '--porcelain', '--untracked-files=all', cwd=ROOT).strip():
        raise RuntimeError('Submission checkout must be clean. Commit or move local changes first.')
    if run('git', 'branch', '--show-current', cwd=ROOT).strip() != 'main':
        raise RuntimeError('Check out main before syncing')
    if publish:
        origin = run('git', 'remote', 'get-url', 'origin', cwd=ROOT).strip()
        if origin not in (REMOTE, REMOTE.removesuffix('.git'), f'git@github.com:{ORG}/{TARGET}.git'):
            raise RuntimeError('Origin does not match the submission repository')
        target = api(f'repos/{ORG}/{TARGET}')
        if target['private'] or target.get('visibility', 'public') != 'public':
            raise RuntimeError('Submission repository must be public')
        if run('git', 'ls-remote', '--heads', 'origin', 'refs/heads/main', cwd=ROOT).strip():
            run('git', 'fetch', 'origin', 'main', cwd=ROOT)
            if run('git', 'rev-parse', 'HEAD', cwd=ROOT) != run('git', 'rev-parse', 'FETCH_HEAD', cwd=ROOT):
                raise RuntimeError('Local main differs from origin/main. Resolve it before syncing.')


def apply_snapshot(stage):
    # Only generated paths are replaced. A complete staging export and scan precede this step.
    for name in MANAGED:
        target = ROOT / name
        if target.is_symlink() or target.is_file():
            target.unlink()
        elif target.exists():
            shutil.rmtree(target)
        shutil.move(str(stage / name), str(target))
    # -f includes every upstream tracked file even when its own .gitignore matches it.
    run('git', 'add', '-f', '--all', '--', *MANAGED, cwd=ROOT)
    return bool(run('git', 'diff', '--cached', '--name-only', cwd=ROOT).strip())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', action='store_true', help='commit the snapshot and push main')
    parser.add_argument('--dry-run', action='store_true', help='download, validate and scan without changing the checkout')
    args = parser.parse_args()
    if args.publish and args.dry_run:
        parser.error('--publish and --dry-run are mutually exclusive')
    for tool in ('git', 'gh', 'gitleaks'):
        if not shutil.which(tool):
            raise RuntimeError(f'Required executable missing: {tool}')
    lock_path = Path(run('git', 'rev-parse', '--absolute-git-dir', cwd=ROOT).strip()) / 'submission-sync.lock'
    with lock_path.open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another sync is running in this checkout') from None
        check_checkout(args.publish)
        repos = discover()
        previous = ROOT / 'sources.json'
        if previous.exists():
            old = {item['name'] for item in json.loads(previous.read_text())['repositories']}
            missing = old - {repo['name'] for repo in repos}
            if missing:
                raise RuntimeError(f'Previously included repositories disappeared or became private: {sorted(missing)}. '
                                   'Review sources.json explicitly before proceeding.')
        with tempfile.TemporaryDirectory(prefix='ticketstub-submission-') as temp:
            scratch = Path(temp)
            stage = scratch / 'stage'
            stage.mkdir()
            entries = [fetch_source(repo, scratch / 'git', stage) for repo in repos]
            write_index(stage, entries)
            scan(stage, scratch)
            print(f"Validated {len(entries)} repositories, {sum(r['tracked_files'] for r in entries)} tracked files.", flush=True)
            if args.dry_run:
                print('Dry run complete; checkout and remote unchanged.')
                return
            changed = apply_snapshot(stage)
            for entry in entries:
                actual = run('git', 'write-tree', f"--prefix={entry['path']}/", cwd=ROOT).strip()
                if actual != entry['tree']:
                    raise RuntimeError(f"Staged files differ from source tree for {entry['name']}; nothing was published")
        if not changed:
            print('Already up to date; no new commit.')
            return
        if args.publish:
            run('git', '-c', 'core.hooksPath=/dev/null', 'commit', '-m',
                f'Sync {len(entries)} public project repositories for submission', cwd=ROOT)
            run('git', 'push', '--set-upstream', 'origin', 'HEAD:refs/heads/main', cwd=ROOT)
            print(f'Published: https://github.com/{ORG}/{TARGET}')
        else:
            print('Snapshot staged. Review git diff --cached, then commit and push when ready.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
