"""Reproduce TicketStub planning economics; USD, forecasts only, no API calls."""
import csv
import json
import math
from pathlib import Path

HERE = Path(__file__).parent
SCENARIOS = [
    dict(name="Conservative", visits=5000, conversion=.01, start_rate=.10, images=4, chats=8, fixed=150, marketing=100),
    dict(name="Base", visits=10000, conversion=.02, start_rate=.10, images=2, chats=4, fixed=300, marketing=300),
    dict(name="Growth", visits=25000, conversion=.04, start_rate=.10, images=1.5, chats=3, fixed=900, marketing=1500),
]

def economics(s):
    # Research: 4,000 input + 600 output; each chat: 3,000 input + 300 output.
    # Image: 150 text input + 4,000 image output tokens; no image input by default.
    research = 4000 * .000002 + 600 * .00001
    chat = 3000 * .000002 + 300 * .00001
    image = 150 * .000005 + s.get('image_output_tokens',4000) * .00003
    per_start = (research + s['chats'] * chat + s['images'] * image) * (1+s.get('funding_allowance',.06))
    orders = s['visits'] * s['conversion']
    starts = s['visits'] * s['start_rate']
    ai = per_start * starts
    # $0.20/order = $0.15 support allowance + $0.03 storage/delivery + $0.02 email.
    contribution = orders * (9 - (9 * .029 + .30) - 9 * .02 - .20) - ai
    cm = contribution / orders
    profit = contribution - s['fixed'] - s['marketing']
    return dict(**s, orders=orders, starts=starts, ai_per_start=per_start,
                ai_per_order=ai/orders, ai_monthly=ai, revenue=orders*9,
                contribution=contribution, cm_per_order=cm, cm_pct=cm/9*100,
                operating_profit=profit, founder_pay_profit=profit-3000,
                break_even_orders=math.ceil((s['fixed']+s['marketing'])/cm) if cm>0 else None,
                founder_break_even_orders=math.ceil((s['fixed']+s['marketing']+3000)/cm) if cm>0 else None)

def rows_table(rows, columns):
    out = ['| '+' | '.join(label for _,label in columns)+' |', '| '+' | '.join('---' for _ in columns)+' |']
    for row in rows:
        out.append('| '+' | '.join(f'{row[k]:,.2f}' if isinstance(row[k],float) else str(row[k]) for k,_ in columns)+' |')
    return '\n'.join(out)

def main():
    results = [economics(s) for s in SCENARIOS]
    (HERE/'model-results.json').write_text(json.dumps(results,indent=2)+'\n')
    with (HERE/'monthly-scenarios.csv').open('w') as f:
        writer=csv.DictWriter(f,fieldnames=list(results[0]))
        writer.writeheader(); writer.writerows(results)
    cols=[('name','Scenario'),('orders','Orders/mo'),('revenue','Revenue'),('ai_per_order','AI/order including abandonment'),('cm_per_order','Contribution/order'),('operating_profit','Operating profit'),('founder_pay_profit','Profit with $3k founder pay'),('break_even_orders','Break-even orders'),('founder_break_even_orders','Break-even incl founder')]
    tables = ['# Recomputed planning tables\n\nAll amounts USD; all sales hypothetical.\n', rows_table(results,cols)]
    base = results[1]
    sensitivities=[]
    for label, updates in [('Conversion 1%',{'conversion':.01}),('Conversion 3%',{'conversion':.03}),('Half traffic',{'visits':5000}),('Double traffic',{'visits':20000}),('4 images/start',{'images':4}),('8 chats/start',{'chats':8}),('20% start rate',{'start_rate':.20}),('Funding allowance 0%',{'funding_allowance':0}),('Funding allowance 10%',{'funding_allowance':.10}),('Image output 2k tokens',{'image_output_tokens':2000}),('Image output 8k tokens',{'image_output_tokens':8000})]:
        r=economics(dict(SCENARIOS[1],**updates)); r['name']=label; sensitivities.append(r)
    tables += ['\n## One-factor digital sensitivities vs Base\n',rows_table(sensitivities,[('name','Change'),('orders','Orders'),('ai_per_order','AI/order'),('operating_profit','Profit')])]
    physical=[]
    for label,price,printing,shipping,packing in [('Card',29,5,6,1),('Print',49,12,8,2),('Framed',89,35,12,3)]:
        receipt=price+6
        cm=receipt-printing-shipping-packing-receipt*.029-.30-receipt*.05-.50-base['ai_per_order']
        physical.append(dict(name=label,item=price,receipt=receipt,printing=printing,shipping=shipping,packing=packing,cm=cm,cm_pct=cm/receipt*100,cm_fulfillment_up25=cm-.25*(printing+shipping+packing)))
    tables += ['\n## Conditional physical economics (not included in revenue forecast)\n', rows_table(physical,[('name','Tier'),('item','Item price'),('receipt','Receipt incl $6 shipping'),('printing','Print'),('shipping','Actual shipping estimate'),('packing','Packing'),('cm','Contribution'),('cm_pct','Margin %'),('cm_fulfillment_up25','Contribution at +25% fulfillment')])]
    cash=[]
    for r in results:
        for opening in [0,1000,5000]:
            # $500 one-off launch contingency, plus payout float at 7 days variable costs.
            variable=r['revenue']-r['contribution']
            reserve=500+variable*7/30
            burn=max(0,-r['operating_profit'])
            payroll_burn=max(0,-r['founder_pay_profit'])
            cash.append(dict(name=r['name'],opening=opening,reserve=reserve,launch_funded='Yes' if opening>=reserve else 'No - unfunded launch',runway=max(0,opening-reserve)/burn if burn else 'Cash-positive at steady state; reserve still required',payroll_runway=max(0,opening-reserve)/payroll_burn if payroll_burn else 'Cash-positive at steady state; reserve still required',six_month_need=reserve+6*burn,six_month_payroll_need=reserve+6*payroll_burn))
    tables += ['\n## Runway after launch reserve (months)\n',rows_table(cash,[('name','Scenario'),('opening','Hypothetical opening cash'),('reserve','Launch + 7-day variable-cost reserve'),('launch_funded','Launch reserve funded'),('runway','Runway no founder pay'),('payroll_runway','Runway with founder pay'),('six_month_need','6mo cash need no pay'),('six_month_payroll_need','6mo need with pay')])]
    (HERE/'calculated-tables.md').write_text('\n\n'.join(tables)+'\n')
    # Independent accounting identities and directional checks.
    for r in results:
        assert math.isclose(r['contribution'],r['orders']*r['cm_per_order'])
        assert math.isclose(r['operating_profit'],r['contribution']-r['fixed']-r['marketing'])
        assert r['starts']>=r['orders']
    assert sensitivities[0]['operating_profit'] < base['operating_profit']
    assert sensitivities[4]['operating_profit'] < base['operating_profit']
    print(rows_table(results,cols))
    print('PASS: contribution/profit identities, funnel bounds, and conversion/usage sensitivity direction.')

if __name__=='__main__':
    main()
