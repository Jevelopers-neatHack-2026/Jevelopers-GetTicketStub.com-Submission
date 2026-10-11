"""Native desktop-Excel recalculation and input-change checks for a CFO.ai XLSX export.

Requires macOS, Microsoft Excel and openpyxl. Copies the workbook into Excel's sandbox
container, applies each input edit through AppleScript, runs `calculate full`, saves a
recalculated copy and reads it back. The source workbook is never modified.
Usage: python3 excel-recalc-check.py WORKBOOK.xlsx OUTPUT.json [--original]
  --original  use the 2026-10-11 layout (drivers in table 04) to reproduce CFO-001/002/003.
"""
import json
import math
import os
import shutil
import subprocess
import sys

import openpyxl

XDIR = os.path.expanduser('~/Library/Containers/com.microsoft.Excel/Data/cfo-review')
S01 = '01 — Editable assumptions — USD'; S03 = '03 — Digital unit economics and'
S04 = '04 — Scenario comparison — Base'; S05 = '05 — One-factor sensitivities —'; S07 = '07 — Cash projection — hypothet'

def _q(s): return s.replace('\\', '\\\\').replace('"', '\\"')

def recalc(src, name, edits):
    os.makedirs(XDIR, exist_ok=True)
    inp, out = os.path.join(XDIR, f'{name}-in.xlsx'), os.path.join(XDIR, f'{name}-out.xlsx')
    shutil.copyfile(src, inp)
    if os.path.exists(out): os.remove(out)
    lines = []
    for sheet, cell, kind, val in edits:
        r = f'range "{cell}" of worksheet "{_q(sheet)}" of wb'
        lines.append({'number': f'set value of {r} to {val!r}', 'clear': f'clear contents {r}',
                      'formula': f'set formula of {r} to "{_q(str(val))}"'}[kind])
    script = f'''set p to POSIX file "{inp}"
tell application "Microsoft Excel"
  set display alerts to false
  open p
  set wb to active workbook
  {chr(10).join(lines)}
  calculate full
  save workbook as wb filename (POSIX file "{out}" as string) file format Excel XML file format
  close wb saving no
end tell'''
    r = subprocess.run(['osascript', '-e', script], capture_output=True, text=True, timeout=300)
    if r.returncode or not os.path.exists(out): raise RuntimeError(f'Excel failed for {name}: {r.stderr}')
    return out

def values(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    return {ws.title: {c.coordinate: c.value for row in ws.iter_rows() for c in row if c.value is not None} for ws in wb.worksheets}

def labels(v, sheet):
    return {val: k[1:] for k, val in v[sheet].items() if k[0] == 'A' and k[1:].isdigit() and isinstance(val, str)}

def main():
    src, outp = sys.argv[1], sys.argv[2]
    original = '--original' in sys.argv
    cached = values(src)
    full = values(recalc(src, 'full', []))
    diffs = []
    n = 0
    for sh, cells in cached.items():
        for k, cv in cells.items():
            rv = full[sh].get(k); n += 1
            same = (math.isclose(cv, rv, rel_tol=0, abs_tol=1e-8) if isinstance(cv, (int, float)) and isinstance(rv, (int, float))
                    else str(cv) == str(rv))
            if not same: diffs.append([sh, k, str(cv), str(rv)])
    errs = [[sh, k, v] for sh, c in full.items() for k, v in c.items() if isinstance(v, str) and v.startswith('#')]
    L03, L04 = labels(cached, S03), labels(cached, S04)
    drv = S04 if original else S01
    d = dict(visits='B5', start='B6', conversion='B7', chats='B9' if original else 'B10',
             marketing='B18' if original else 'B32', cash='B24' if original else 'B34')
    cases = {
        'baseline': [],
        'zero paid conversion': [(drv, d['conversion'], 'number', 0)],
        'zero traffic': [(drv, d['visits'], 'number', 0)],
        'paid conversion 1%': [(drv, d['conversion'], 'number', .01)],
        'traffic 20,000': [(drv, d['visits'], 'number', 20000)],
        'start rate 20%': [(drv, d['start'], 'number', .2)],
        'chats 8': [(drv, d['chats'], 'number', 8)],
        'marketing 600': [(drv, d['marketing'], 'number', 600)],
        'opening cash 10,000 (ramp covered)': [(drv, d['cash'], 'number', 10000)],
        'opening cash explicit 0': [(drv, d['cash'], 'number', 0)],
        'opening cash blank': [(drv, d['cash'], 'clear', None)],
        'opening cash empty string': [(drv, d['cash'], 'formula', '=""')],
    }
    if original:
        cases['display cell 01!B7 overwritten 1%'] = [(S01, 'B7', 'number', .01)]
        cases['display cell 01!B33 overwritten 0'] = [(S01, 'B33', 'number', 0)]
    keys03 = ['TS Digital orders', 'TS AI cost per paid order', 'TS Digital contribution per order', 'TS Monthly contribution',
              'TS Monthly operating profit bootstrap', 'TS Monthly burn bootstrap', 'TS Launch reserve', 'TS Six month funding bootstrap',
              'TS Ramp funding bootstrap', 'TS Break-even orders bootstrap', 'TS Launch funding gap', 'TS Ramp funding gap bootstrap', 'TS Launch status']
    results = {}
    for i, (name, edits) in enumerate(cases.items()):
        v = values(recalc(src, f'case{i}', edits))
        r = {f'03 {k}': v[S03].get(f'B{L03[k]}') for k in keys03 if k in L03}
        for col, scen in zip('BCD', ('Base', 'Conservative', 'Growth')):
            for k in ('TS Hypothetical opening cash', 'TS Launch status', 'TS Monthly operating profit bootstrap'):
                r[f'04 {scen} {k}'] = v[S04].get(f'{col}{L04[k]}')
        r['07 Oct-2026 bootstrap cash'] = v[S07].get('B10'); r['07 Dec-2026 bootstrap cash'] = v[S07].get('D10')
        r['05 baseline sensitivity profit'] = v[S05].get('S5')
        r['error_cells'] = [[sh, k] for sh, c in v.items() for k, x in c.items() if isinstance(x, str) and x.startswith('#')]
        results[name] = {'edits': [[s, c, k, x] for s, c, k, x in edits], 'outputs': r}
    excel = subprocess.run(['defaults', 'read', '/Applications/Microsoft Excel.app/Contents/Info.plist', 'CFBundleShortVersionString'],
                           capture_output=True, text=True).stdout.strip()
    report = dict(workbook=os.path.basename(src), engine=f'Microsoft Excel for Mac {excel}', method='AppleScript edit + calculate full + save copy; openpyxl read-back',
                  full_recalculation=dict(cells_compared=n, differences=diffs, error_cells=errs), cases=results)
    with open(outp, 'w') as f: json.dump(report, f, indent=1, default=str); f.write('\n')
    print(json.dumps(dict(cells_compared=n, differences=len(diffs), error_cells=len(errs)), indent=1))

if __name__ == '__main__':
    main()
