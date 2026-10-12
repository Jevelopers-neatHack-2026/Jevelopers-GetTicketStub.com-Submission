#!/usr/bin/env python3
"""Check maintained judge links and asset hashes; optionally check public HTTP links."""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from urllib.request import Request, urlopen
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import argparse
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-links', action='store_true')
    args = parser.parse_args()
    files = [ROOT / 'README.md', ROOT / 'REPOSITORIES.md', *sorted((ROOT / 'docs/judges').glob('*.md')),
             ROOT / 'docs/assets/submission/README.md']
    errors, external, count = [], set(), 0
    for path in files:
        content = path.read_text()
        links = re.findall(r'!?\[[^\]]*\]\(([^)]+)\)', content)
        links += re.findall(r'(?:src|srcset)="([^"]+)"', content)
        for reference in links:
            if reference.startswith('https://'):
                external.add(reference)
                continue
            link = urlsplit(reference)
            target = path.parent / unquote(link.path) if link.path else path
            count += 1
            if not target.exists() and not (args.public_links and target.resolve() == ROOT / 'docs/judges/LINK-CHECK.json'):
                errors.append(f'{path.relative_to(ROOT)}: missing {reference}')
            elif link.fragment and target.suffix == '.md':
                headings = re.findall(r'^#+ (.*)$', target.read_text(), re.M)
                slugs = [re.sub(r'[^\w\- ]', '', h.lower()).replace(' ', '-') for h in headings]
                if link.fragment not in slugs:
                    errors.append(f'{path.relative_to(ROOT)}: missing anchor {reference}')
    manifest = ROOT / 'docs/assets/submission/ASSET-MANIFEST.json'
    for asset in json.loads(manifest.read_text())['assets']:
        path = manifest.parent / asset['file']
        if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != asset['sha256']:
            errors.append(f'Asset changed: {asset["file"]}; review and update its manifest hash')
    print(f'{count} relative links checked; asset hashes checked.')
    prose = (ROOT / 'README.md').read_text()
    prose = re.sub(r'```.*?```', '', prose, flags=re.S)
    prose = re.sub(r'!?\[([^\]]*)\]\([^)]+\)', r'\1', prose)
    prose = re.sub(r'<img\b[^>]*\balt="([^"]*)"[^>]*>', r'\1', prose)
    prose = re.sub(r'<[^>]*>', '', prose)
    print(f'README: {len(prose.split())} words including image alt text, excluding code.')
    if args.public_links:
        def check(url):
            try:
                request = Request(url, headers={'User-Agent': 'TicketStub-submission-link-check/1.0'})
                with urlopen(request, timeout=25) as response:
                    return {'url': url, 'status': response.status, 'final_url': response.url}
            except Exception as error:
                return {'url': url, 'error': str(error)}
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(check, sorted(external)))
        report = {'checked_at': datetime.now(timezone.utc).isoformat(),
                  'method': 'Unauthenticated HTTP GET; does not prove form completion or page claims.',
                  'links': results}
        (ROOT / 'docs/judges/LINK-CHECK.json').write_text(json.dumps(report, indent=2) + '\n')
        failed = [r for r in results if r.get('status') != 200]
        print(f'{len(results) - len(failed)}/{len(results)} public links returned HTTP 200.')
        errors.extend(str(r) for r in failed)
    if errors:
        raise SystemExit('\n'.join(errors))
    print('Judge documentation checks passed.')


if __name__ == '__main__':
    main()
