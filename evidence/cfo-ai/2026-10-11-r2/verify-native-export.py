"""Read-only check of the revision 2 CFO.ai native XLSX against model.py; stdlib only.

Finds rows by their CFO.ai variable labels (not fixed addresses), so it survives row moves.
Usage: python3 -I verify-native-export.py [workbook.xlsx]
"""
import json
import math
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from model import SCENARIOS, economics, cash  # noqa: E402

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}

def load(path):
    with ZipFile(path) as z:
        names = z.namelist()
        shared = []
        if 'xl/sharedStrings.xml' in names:
            shared = [''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)]
        wb = ET.fromstring(z.read('xl/workbook.xml'))
        rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        target = {r.get('Id'): r.get('Target') for r in rels}
        sheets, errors, formulas = {}, [], 0
        for s in wb.findall('m:sheets/m:sheet', NS):
            t = target[s.get('{%s}id' % NS['r'])].lstrip('/')
            t = t if t.startswith('xl/') else 'xl/' + t
            cells = {}
            for c in ET.fromstring(z.read(t)).iter('{%s}c' % NS['m']):
                v = c.find('m:v', NS); inline = c.find('m:is', NS); f = c.find('m:f', NS)
                val = v.text if v is not None else (''.join(inline.itertext()) if inline is not None else None)
                typ = c.get('t')
                if typ == 's' and val is not None: val = shared[int(val)]
                elif typ == 'e': errors.append((s.get('name'), c.get('r'), val))
                elif typ in (None, 'n') and val is not None: val = float(val)
                if f is not None: formulas += 1
                cells[c.get('r')] = dict(v=val, f=f.text if f is not None else None)
            sheets[s.get('name')] = cells
        risky = [n for n in names if 'vbaProject' in n or n.startswith('xl/externalLinks/')]
    return sheets, errors, formulas, risky

def rows_by_label(cells):
    out = {}
    for ref, c in cells.items():
        m = re.fullmatch(r'A(\d+)', ref)
        if m and isinstance(c['v'], str): out.setdefault(c['v'], int(m.group(1)))
    return out

def num(x):
    return x if isinstance(x, float) else None

def close(a, b, tol=1e-6):
    if b is None: return a in (None, '')
    return a is not None and math.isclose(a, b, rel_tol=0, abs_tol=tol)

def main():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'cfo-native-export.xlsx'
    sheets, errors, formulas, risky = load(path)
    checks, failures = [], []
    def check(ok, msg):
        (checks if ok else failures).append(msg)
    check(not errors, f'no cached formula-error cells ({len(errors)} found)')
    check(not risky, f'no macros or external workbook links ({risky})')
    comp = next(n for n in sheets if n.startswith('04'))
    labels = rows_by_label(sheets[comp])
    expected = {'B': economics(SCENARIOS[1]), 'C': economics(SCENARIOS[0]), 'D': economics(SCENARIOS[2])}
    metric = {'TS Digital orders': 'orders', 'TS Studio starts': 'starts', 'TS Monthly digital revenue': 'revenue',
              'TS Monthly AI spend': 'ai_monthly', 'TS AI cost per paid order': 'ai_per_order',
              'TS Digital contribution per order': 'cm_per_order', 'TS Fixed monthly budget': 'fixed',
              'TS Monthly operating profit bootstrap': 'operating_profit', 'TS Monthly operating profit founder': 'founder_pay_profit',
              'TS Break-even orders bootstrap': 'break_even_orders', 'TS Break-even orders founder': 'founder_break_even_orders'}
    compared = 0
    for label, key in metric.items():
        if label not in labels: failures.append(f'missing row {label!r} in {comp}'); continue
        for col, exp in expected.items():
            got = num(sheets[comp].get(f'{col}{labels[label]}', {}).get('v'))
            want = exp[key]
            check(close(got, float(want) if want is not None else None), f'{comp} {label} {col}: export {got} vs model {want}')
            compared += 1
    cash_rows = {'TS Launch reserve': 'reserve', 'TS Six month funding bootstrap': 'six_month_need',
                 'TS Six month funding founder': 'six_month_payroll_need', 'TS Ramp funding bootstrap': 'ramp_need',
                 'TS Ramp funding founder': 'ramp_payroll_need'}
    for label, key in cash_rows.items():
        if label not in labels: failures.append(f'missing row {label!r} in {comp}'); continue
        for col, exp in expected.items():
            got = num(sheets[comp].get(f'{col}{labels[label]}', {}).get('v'))
            want = cash(exp, 1000)[key]
            check(close(got, want), f'{comp} {label} {col}: export {got} vs model {want}')
            compared += 1
    result = dict(workbook=path.name, sheets=list(sheets), formula_cells=formulas, values_compared=compared,
                  outcome='pass' if not failures else 'fail', failures=failures, passed=len(checks))
    print(json.dumps(result, indent=1))
    sys.exit(0 if not failures else 1)

if __name__ == '__main__':
    main()
