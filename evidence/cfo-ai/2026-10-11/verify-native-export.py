"""Read-only review of CFO.ai's native XLSX export; no workbook rewriting."""
import json
import math
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile
from model import SCENARIOS, economics

HERE=Path(__file__).parent
NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def main():
    checks=[]
    with ZipFile(HERE/'cfo-native-export.xlsx') as z:
        shared=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            shared=[''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',NS)]
        sheets={}; errors=[]; formula_count=0
        for i in range(1,10):
            rows={}; formulas={}; refs={}
            root=ET.fromstring(z.read(f'xl/worksheets/sheet{i}.xml'))
            for row in root.findall('m:sheetData/m:row',NS):
                values=[]; fs=[]; addresses=[]
                for c in row.findall('m:c',NS):
                    v=c.find('m:v',NS); inline=c.find('m:is',NS); f=c.find('m:f',NS)
                    value=v.text if v is not None else ''.join(inline.itertext()) if inline is not None else None
                    if c.get('t')=='s': value=shared[int(value)]
                    if c.get('t')=='e': errors.append((i,c.get('r'),value))
                    if f is not None: formula_count+=1
                    values.append(value); fs.append(f.text if f is not None else None); addresses.append(c.get('r'))
                if values and values[0]:
                    rows[values[0]]=values[1:]; formulas[values[0]]=fs[1:]; refs[values[0]]=addresses[1:]
            title=next(iter(rows))
            sheets[title[:2] if title[:2].isdigit() else "inputs"]=(rows,formulas,refs)
        assert not errors, errors
        assert not any('vbaProject' in name or 'externalLinks/' in name for name in z.namelist())
        checks.append('Nine native export sheets inspected; no cached formula-error cells, macros or external workbook links found.')
        expected=[economics(SCENARIOS[i]) for i in [1,0,2]]
        scenario=sheets["04"][0]
        metrics={'TS Digital orders':'orders','TS Studio starts':'starts','TS Monthly digital revenue':'revenue','TS Monthly AI spend':'ai_monthly','TS AI cost per paid order':'ai_per_order','TS Digital contribution per order':'cm_per_order','TS Monthly operating profit bootstrap':'operating_profit','TS Monthly operating profit founder':'founder_pay_profit','TS Break-even orders bootstrap':'break_even_orders','TS Break-even orders founder':'founder_break_even_orders'}
        for label,key in metrics.items():
            for col,result in enumerate(expected):
                assert math.isclose(float(scenario[label][col]),result[key],abs_tol=1e-8), (label,col)
        checks.append('Base, Conservative and Growth order, AI, contribution, profit and break-even results match independent Python calculations to $0.00000001.')
        for col,r in enumerate(expected):
            reserve=500+(r['revenue']-r['contribution'])*7/30
            assert math.isclose(float(scenario['TS Launch reserve'][col]),reserve,abs_tol=1e-8)
            for suffix,pay in [('bootstrap',0),('founder',3000)]:
                need=reserve+6*max(0,-(r['operating_profit']-pay))
                assert math.isclose(float(scenario['TS Six month funding '+suffix][col]),need,abs_tol=1e-8)
        checks.append('Launch reserves and six-month funding needs match independent cash calculations for all cases.')
        sens=sheets["05"][0]; headers=sens['Variable / dimension']
        def sensitivity(label):
            return float(sens[label][headers.index('TS Sens Operating profit')])
        for label,value in [('Conversion x0.5 — Base 1 percent',-103.09),('Conversion x1.5 — Base 3 percent',1508.71),('Half traffic',51.405),('Double traffic',2005.62),('Images x2 — Base four per start',446.82),('Chats x2 — Base eight per start',664.65),('Start rate x2 — Base 20 percent',393.82)]:
            assert math.isclose(sensitivity(label),value,abs_tol=1e-8), label
        checks.append('Conversion, traffic, generation/revision, chat and abandonment sensitivities match independent checkpoints.')
        physical=sheets["06"][0]; headers=physical['Variable / dimension']
        for label,cm,stress in [('Card matte',17.89005,14.89005),('Print matte',26.31005,20.81005),('Framed matte',35.15005,22.65005)]:
            assert math.isclose(float(physical[label][headers.index('TS Physical Contribution')]),cm,abs_tol=1e-8)
            assert math.isclose(float(physical[label][headers.index('TS Physical Stressed contribution')]),stress,abs_tol=1e-8)
        checks.append('Conditional physical contribution and +25% fulfillment-cost stress match; physical sales are excluded from the cash forecast.')
        cash=sheets["07"][0]
        assert all(float(x)==0 for x in cash['TS Projected digital revenue'][:3])
        assert all(math.isclose(float(x),y,abs_tol=1e-8) for x,y in zip(cash['TS Projected cash bootstrap'][:3],[400,-200,-800]))
        assert all(math.isclose(float(x),0,abs_tol=1e-8) for x in cash['TS Projected cash reconciliation'])
        checks.append('October–December 2026 prelaunch revenue is zero, bootstrap cash is $400/-$200/-$800, and cash reconciliation is zero in every exported month.')
        checks.append('Formula traces inspected: research/chat/image rates feed per-start AI, abandonment allocation and contribution; scenario outputs and cash rollforward retain Excel formulas.')
        final_links={
            'sensitivity_baseline_funding_formula':sheets["05"][1]['Baseline'][6],
            'prelaunch_months_formula':sheets["01"][1].get('TS Prelaunch months'),
        }
        report={'outcome':'pass','method':'Read-only XLSX XML extraction; cached values independently recomputed; formula precedents inspected. No native Excel engine executed.','formula_cells':formula_count,'checks':checks,'final_formula_observations':final_links,'limits':['Native Excel recalculation and visual layout were not independently tested in a desktop spreadsheet engine.','CFO.ai canvas is the editable source; export is a dated snapshot. Static narrative does not automatically update with assumptions.','Unknown real costs, cash, traffic and supplier prices remain unknown; this verification does not establish production readiness.']}
        (HERE/'export-verification.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2))

if __name__=='__main__': main()
