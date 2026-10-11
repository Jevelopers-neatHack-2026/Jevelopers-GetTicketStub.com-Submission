"""Revision 2 of the independent TicketStub planning model; USD forecasts only, no API calls.

Changes from 2026-10-11/model.py:
- Aggregates are computed directly, so zero orders or zero traffic stay numeric (CFO-001);
  per-order metrics are None (n/a) when orders <= 0.
- Unknown opening cash (None) propagates as unknown; explicit 0 is a valid unfunded case (CFO-003).
- Open-Meteo API Standard (owner-confirmed EUR 29.00/month) is the first identified commitment
  inside the data/API licensing contingency, converted at the ECB 2026-10-09 reference rate.
"""
import csv
import json
import math
from pathlib import Path

HERE = Path(__file__).parent
EUR_USD_ECB_2026_10_09 = 1.1206          # ecb-eurofxref-2026-10-09.xml
OPEN_METEO_EUR = 29.00                    # owner-confirmed; receipt not independently verified
OPEN_METEO_USD = round(OPEN_METEO_EUR * EUR_USD_ECB_2026_10_09, 4)  # 32.4974, estimate
FOUNDER_PAY = 3000
PRELAUNCH_MONTHS = 3                      # Oct-Dec 2026 hypothetical; launch 2027-01-01
POSTLAUNCH_FUNDING_MONTHS = 6

def fixed_budget(other_fixed, data_contingency):
    """Open-Meteo consumes the existing data/API contingency; any excess raises the budget."""
    other_data = max(0.0, data_contingency - OPEN_METEO_USD)
    return dict(open_meteo=OPEN_METEO_USD, other_data_contingency=round(other_data, 4),
                fixed=round(other_fixed + OPEN_METEO_USD + other_data, 4))

# other_fixed = all fixed buckets except the data/API licensing contingency (unchanged from r1).
SCENARIOS = [
    dict(name="Conservative", visits=5000, conversion=.01, start_rate=.10, images=4, chats=8, marketing=100, **fixed_budget(130, 20)),
    dict(name="Base", visits=10000, conversion=.02, start_rate=.10, images=2, chats=4, marketing=300, **fixed_budget(260, 40)),
    dict(name="Growth", visits=25000, conversion=.04, start_rate=.10, images=1.5, chats=3, marketing=1500, **fixed_budget(750, 150)),
]

PRICE = 9
NET_BEFORE_AI = PRICE - (PRICE * .029 + .30) - PRICE * .02 - .20   # $8.059 per order

def economics(s):
    research = 4000 * .000002 + 600 * .00001
    chat = 3000 * .000002 + 300 * .00001
    image = 150 * .000005 + s.get('image_output_tokens', 4000) * .00003 + s.get('image_input_tokens', 0) * .000008
    per_start = (research + s['chats'] * chat + s['images'] * image) * (1 + s.get('funding_allowance', .06)) * (1 + s.get('retry_rate', 0))
    orders = s['visits'] * s['conversion']
    starts = s['visits'] * s['start_rate']
    ai = per_start * starts
    contribution = orders * NET_BEFORE_AI - ai                    # aggregate, valid at zero orders
    variable = orders * (PRICE * .029 + .30 + PRICE * .02 + .20) + ai
    cm = contribution / orders if orders > 0 else None
    profit = contribution - s['fixed'] - s['marketing']
    def be(extra):
        return math.ceil((s['fixed'] + s['marketing'] + extra) / cm) if cm is not None and cm > 0 else None
    return dict(**s, orders=orders, starts=starts, ai_per_start=per_start,
                ai_per_order=ai / orders if orders > 0 else None, ai_monthly=ai, revenue=orders * PRICE,
                variable_costs=variable, contribution=contribution, cm_per_order=cm,
                cm_pct=cm / PRICE * 100 if cm is not None else None,
                operating_profit=profit, founder_pay_profit=profit - FOUNDER_PAY,
                break_even_orders=be(0), founder_break_even_orders=be(FOUNDER_PAY))

def cash(r, opening):
    reserve = 500 + r['variable_costs'] * 7 / 30
    burn = max(0, -r['operating_profit']); pburn = max(0, -r['founder_pay_profit'])
    pre = r['fixed'] + r['marketing']; ppre = pre + FOUNDER_PAY
    six = reserve + POSTLAUNCH_FUNDING_MONTHS * burn; psix = reserve + POSTLAUNCH_FUNDING_MONTHS * pburn
    ramp = PRELAUNCH_MONTHS * pre + six; pramp = PRELAUNCH_MONTHS * ppre + psix
    known = opening is not None
    def runway(b):
        if not known: return 'Opening cash unknown'
        return max(0, opening - reserve) / b if b else 'Cash-positive at steady state; reserve still required'
    return dict(name=r['name'], opening='unknown' if not known else opening, reserve=reserve,
                launch_status=('Opening cash unknown' if not known else 'UNFUNDED LAUNCH' if opening < reserve
                               else 'Reserve funded; ramp funded' if opening >= ramp else 'Opening cash covers reserve only; ramp unfunded'),
                runway=runway(burn), payroll_runway=runway(pburn), six_month_need=six, six_month_payroll_need=psix,
                ramp_need=ramp, ramp_payroll_need=pramp,
                ramp_gap=max(0, ramp - opening) if known else 'unknown', ramp_payroll_gap=max(0, pramp - opening) if known else 'unknown',
                december_2026_cash=opening - PRELAUNCH_MONTHS * pre if known else 'unknown')

def fmt(v):
    return f'{v:,.4f}'.rstrip('0').rstrip('.') if isinstance(v, float) else ('n/a' if v is None else str(v))

def rows_table(rows, columns):
    out = ['| ' + ' | '.join(l for _, l in columns) + ' |', '| ' + ' | '.join('---' for _ in columns) + ' |']
    out += ['| ' + ' | '.join(fmt(r[k]) for k, _ in columns) + ' |' for r in rows]
    return '\n'.join(out)

def main():
    results = [economics(s) for s in SCENARIOS]
    base = results[1]
    edge = {
        'zero_conversion': economics(dict(SCENARIOS[1], conversion=0)),
        'zero_traffic': economics(dict(SCENARIOS[1], visits=0)),
    }
    edge_cash = {k: cash(v, 1000) for k, v in edge.items()}
    cash_rows = [cash(r, o) for r in results for o in (None, 0, 1000, 5000)]
    sens = []
    for label, upd in [('Conversion 1%', {'conversion': .01}), ('Conversion 3%', {'conversion': .03}), ('Half traffic', {'visits': 5000}),
                       ('Double traffic', {'visits': 20000}), ('4 images/start', {'images': 4}), ('8 chats/start', {'chats': 8}),
                       ('20% start rate', {'start_rate': .20}), ('Funding allowance 0%', {'funding_allowance': 0}),
                       ('Funding allowance 5.5%', {'funding_allowance': .055}), ('Funding allowance 10%', {'funding_allowance': .10}),
                       ('Image output 2k tokens', {'image_output_tokens': 2000}), ('Image output 8k tokens', {'image_output_tokens': 8000}),
                       ('True edit 4k input image tokens', {'image_input_tokens': 4000}), ('Billed retries 10%', {'retry_rate': .10})]:
        r = economics(dict(SCENARIOS[1], **upd)); r['name'] = label; sens.append(r)
    physical = []
    for label, price, printing, shipping, packing in [('Card', 29, 5, 6, 1), ('Print', 49, 12, 8, 2), ('Framed', 89, 35, 12, 3)]:
        receipt = price + 6
        cm = receipt - printing - shipping - packing - receipt * .029 - .30 - receipt * .05 - .50 - base['ai_per_order']
        physical.append(dict(name=label, item=price, receipt=receipt, cm=cm, cm_pct=cm / receipt * 100,
                             cm_fulfillment_up25=cm - .25 * (printing + shipping + packing)))

    # Identities, edge cases and directional checks.
    for r in results:
        if r['orders'] > 0: assert math.isclose(r['contribution'], r['orders'] * r['cm_per_order'])
        assert math.isclose(r['revenue'] - r['variable_costs'], r['contribution'])
        assert math.isclose(r['operating_profit'], r['contribution'] - r['fixed'] - r['marketing'])
    zc, zcc = edge['zero_conversion'], edge_cash['zero_conversion']
    assert zc['cm_per_order'] is None and zc['break_even_orders'] is None
    assert math.isclose(zc['contribution'], -308.99) and math.isclose(zc['operating_profit'], -908.99)
    assert math.isclose(zcc['reserve'], 572.0976666666667) and math.isclose(zcc['six_month_need'], 6026.037666666667)
    unknown = cash(base, None)
    assert unknown['launch_status'] == 'Opening cash unknown' and unknown['ramp_gap'] == 'unknown'
    assert cash(base, 0)['launch_status'] == 'UNFUNDED LAUNCH'
    assert cash(base, 1000)['launch_status'] == 'Opening cash covers reserve only; ramp unfunded'
    assert cash(base, 10000)['launch_status'] == 'Reserve funded; ramp funded'
    assert math.isclose(base['fixed'], 300) and math.isclose(results[2]['fixed'], 900)
    assert math.isclose(results[0]['fixed'], 162.4974)
    assert sens[0]['operating_profit'] < base['operating_profit'] and sens[4]['operating_profit'] < base['operating_profit']

    out = dict(fx=dict(source='ECB euro foreign exchange reference rates', date='2026-10-09', eur_usd=EUR_USD_ECB_2026_10_09,
                       open_meteo_eur=OPEN_METEO_EUR, open_meteo_usd_estimate=OPEN_METEO_USD),
               scenarios=results, cash=cash_rows, edge_cases=dict(economics=edge, cash=edge_cash),
               sensitivities=sens, physical=physical)
    (HERE / 'model-results.json').write_text(json.dumps(out, indent=2) + '\n')
    with (HERE / 'monthly-scenarios.csv').open('w') as f:
        w = csv.DictWriter(f, fieldnames=list(results[0]), lineterminator='\n'); w.writeheader(); w.writerows(results)
    cols = [('name', 'Scenario'), ('fixed', 'Fixed budget'), ('orders', 'Orders/mo'), ('revenue', 'Revenue'), ('ai_per_order', 'AI/order incl. abandonment'),
            ('cm_per_order', 'Contribution/order'), ('operating_profit', 'Operating profit'), ('founder_pay_profit', 'With $3k founder pay'),
            ('break_even_orders', 'Break-even orders'), ('founder_break_even_orders', 'Break-even incl. founder')]
    md = ['# Revision 2 recomputed planning tables\n\nAll amounts USD; all sales hypothetical. Fixed budgets include Open-Meteo API Standard '
          f'EUR {OPEN_METEO_EUR:.2f} = USD {OPEN_METEO_USD} (ECB 2026-10-09, estimate) inside the data/API contingency.\n',
          rows_table(results, cols),
          '\n## Edge cases (Base inputs, $1,000 hypothetical opening cash)\n',
          rows_table([dict(edge[k], name=k) for k in edge], [('name', 'Case'), ('orders', 'Orders'), ('ai_monthly', 'AI spend'), ('contribution', 'Contribution'),
                                                              ('cm_per_order', 'Contribution/order'), ('operating_profit', 'Operating profit'), ('break_even_orders', 'Break-even')]),
          rows_table([dict(edge_cash[k], name=k) for k in edge_cash], [('name', 'Case'), ('reserve', 'Reserve'), ('six_month_need', '6-mo need'), ('ramp_need', 'Ramp need'), ('launch_status', 'Launch status')]),
          '\n## One-factor sensitivities vs Base\n',
          rows_table(sens, [('name', 'Change'), ('orders', 'Orders'), ('ai_per_order', 'AI/order'), ('operating_profit', 'Profit')]),
          '\n## Conditional physical economics (excluded from revenue; variants not orderable)\n',
          rows_table(physical, [('name', 'Tier'), ('item', 'Item'), ('receipt', 'Receipt incl $6 shipping'), ('cm', 'Contribution'), ('cm_pct', 'Margin %'), ('cm_fulfillment_up25', 'At +25% fulfillment')]),
          '\n## Cash, reserve and funding (opening cash unknown / hypothetical alternatives)\n',
          rows_table(cash_rows, [('name', 'Scenario'), ('opening', 'Opening cash'), ('reserve', 'Launch reserve'), ('launch_status', 'Launch status'),
                                 ('runway', 'Runway, no pay'), ('payroll_runway', 'Runway, $3k pay'), ('six_month_need', '6-mo need'),
                                 ('ramp_need', '3+6 mo ramp need'), ('ramp_payroll_need', 'Ramp need with pay'), ('ramp_gap', 'Ramp gap'), ('december_2026_cash', 'Dec-2026 cash')])]
    (HERE / 'calculated-tables.md').write_text('\n\n'.join(md) + '\n')
    print(rows_table(results, cols))
    print('PASS: identities, zero-order/zero-traffic aggregates, unknown vs zero opening cash, Open-Meteo budget split, sensitivity direction.')

if __name__ == '__main__':
    main()
