export type AmountDisplay =
  | Readonly<{ status: 'available'; text: string; currency: string }>
  | Readonly<{ status: 'unknown' | 'restricted' | 'unavailable' }>;
/** Exact host-supplied display strings; never parses, rounds or aggregates money. */
export function AmountText({ amount }: { amount: AmountDisplay }) {
  if (amount.status !== 'available') return <span className="td-amount td-amount-state">{amount.status === 'restricted' ? 'Amount restricted' : amount.status === 'unavailable' ? 'Amount unavailable' : 'Amount unknown'}</span>;
  if (typeof amount.text !== 'string' || !amount.text.trim() || typeof amount.currency !== 'string' || !amount.currency.trim()) return <span className="td-amount td-amount-state">Amount unknown</span>;
  return <span className="td-amount"><span>{amount.text}</span>{' '}<span className="td-currency">{amount.currency}</span></span>;
}
