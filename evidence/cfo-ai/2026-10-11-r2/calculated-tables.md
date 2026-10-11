# Revision 2 recomputed planning tables

All amounts USD; all sales hypothetical. Fixed budgets include Open-Meteo API Standard EUR 29.00 = USD 32.4974 (ECB 2026-10-09, estimate) inside the data/API contingency.


| Scenario | Fixed budget | Orders/mo | Revenue | AI/order incl. abandonment | Contribution/order | Operating profit | With $3k founder pay | Break-even orders | Break-even incl. founder |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Conservative | 162.4974 | 50 | 450 | 6.0314 | 2.0276 | -161.1174 | -3,161.1174 | 130 | 1610 |
| Base | 300 | 200 | 1,800 | 1.545 | 6.5141 | 702.81 | -2,297.19 | 93 | 553 |
| Growth | 900 | 1,000 | 9,000 | 0.5886 | 7.4704 | 5,070.3688 | 2,070.3688 | 322 | 723 |


## Edge cases (Base inputs, $1,000 hypothetical opening cash)


| Case | Orders | AI spend | Contribution | Contribution/order | Operating profit | Break-even |
| --- | --- | --- | --- | --- | --- | --- |
| zero_conversion | 0 | 308.99 | -308.99 | n/a | -908.99 | n/a |
| zero_traffic | 0 | 0 | 0 | n/a | -600 | n/a |

| Case | Reserve | 6-mo need | Ramp need | Launch status |
| --- | --- | --- | --- | --- |
| zero_conversion | 572.0977 | 6,026.0377 | 7,826.0377 | Opening cash covers reserve only; ramp unfunded |
| zero_traffic | 500 | 4,100 | 5,900 | Opening cash covers reserve only; ramp unfunded |


## One-factor sensitivities vs Base


| Change | Orders | AI/order | Profit |
| --- | --- | --- | --- |
| Conversion 1% | 100 | 3.0899 | -103.09 |
| Conversion 3% | 300 | 1.03 | 1,508.71 |
| Half traffic | 100 | 1.545 | 51.405 |
| Double traffic | 400 | 1.545 | 2,005.62 |
| 4 images/start | 200 | 2.8249 | 446.82 |
| 8 chats/start | 200 | 1.7358 | 664.65 |
| 20% start rate | 200 | 3.0899 | 393.82 |
| Funding allowance 0% | 200 | 1.4575 | 720.3 |
| Funding allowance 5.5% | 200 | 1.5377 | 704.2675 |
| Funding allowance 10% | 200 | 1.6033 | 691.15 |
| Image output 2k tokens | 200 | 0.909 | 830.01 |
| Image output 8k tokens | 200 | 2.817 | 448.41 |
| True edit 4k input image tokens | 200 | 1.8841 | 634.97 |
| Billed retries 10% | 200 | 1.6994 | 671.911 |


## Conditional physical economics (excluded from revenue; variants not orderable)


| Tier | Item | Receipt incl $6 shipping | Contribution | Margin % | At +25% fulfillment |
| --- | --- | --- | --- | --- | --- |
| Card | 29 | 35 | 17.89 | 51.1144 | 14.89 |
| Print | 49 | 55 | 26.3101 | 47.8365 | 20.8101 |
| Framed | 89 | 95 | 35.1501 | 37.0001 | 22.6501 |


## Cash, reserve and funding (opening cash unknown / hypothetical alternatives)


| Scenario | Opening cash | Launch reserve | Launch status | Runway, no pay | Runway, $3k pay | 6-mo need | 3+6 mo ramp need | Ramp need with pay | Ramp gap | Dec-2026 cash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Conservative | unknown | 581.3447 | Opening cash unknown | Opening cash unknown | Opening cash unknown | 1,548.0491 | 2,335.5413 | 29,335.5413 | unknown | unknown |
| Conservative | 0 | 581.3447 | UNFUNDED LAUNCH | 0 | 0 | 1,548.0491 | 2,335.5413 | 29,335.5413 | 2,335.5413 | -787.4922 |
| Conservative | 1000 | 581.3447 | Opening cash covers reserve only; ramp unfunded | 2.5984 | 0.1324 | 1,548.0491 | 2,335.5413 | 29,335.5413 | 1,335.5413 | 212.5078 |
| Conservative | 5000 | 581.3447 | Reserve funded; ramp funded | 27.4251 | 1.3978 | 1,548.0491 | 2,335.5413 | 29,335.5413 | 0 | 4,212.5078 |
| Base | unknown | 616.011 | Opening cash unknown | Opening cash unknown | Opening cash unknown | 616.011 | 2,416.011 | 25,199.151 | unknown | unknown |
| Base | 0 | 616.011 | UNFUNDED LAUNCH | Cash-positive at steady state; reserve still required | 0 | 616.011 | 2,416.011 | 25,199.151 | 2,416.011 | -1,800 |
| Base | 1000 | 616.011 | Opening cash covers reserve only; ramp unfunded | Cash-positive at steady state; reserve still required | 0.1672 | 616.011 | 2,416.011 | 25,199.151 | 1,416.011 | -800 |
| Base | 5000 | 616.011 | Reserve funded; ramp funded | Cash-positive at steady state; reserve still required | 1.9084 | 616.011 | 2,416.011 | 25,199.151 | 0 | 3,200 |
| Growth | unknown | 856.914 | Opening cash unknown | Opening cash unknown | Opening cash unknown | 856.914 | 8,056.914 | 17,056.914 | unknown | unknown |
| Growth | 0 | 856.914 | UNFUNDED LAUNCH | Cash-positive at steady state; reserve still required | Cash-positive at steady state; reserve still required | 856.914 | 8,056.914 | 17,056.914 | 8,056.914 | -7,200 |
| Growth | 1000 | 856.914 | Opening cash covers reserve only; ramp unfunded | Cash-positive at steady state; reserve still required | Cash-positive at steady state; reserve still required | 856.914 | 8,056.914 | 17,056.914 | 7,056.914 | -6,200 |
| Growth | 5000 | 856.914 | Opening cash covers reserve only; ramp unfunded | Cash-positive at steady state; reserve still required | Cash-positive at steady state; reserve still required | 856.914 | 8,056.914 | 17,056.914 | 3,056.914 | -2,200 |
