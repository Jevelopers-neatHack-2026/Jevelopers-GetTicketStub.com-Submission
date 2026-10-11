import { AmountText, type AmountDisplay } from './AmountText';
import { Tooltip } from './Tooltip';
export type ChartItem = Readonly<{ status: 'visible'; id: string; label: string; amount: AmountDisplay; position: number; note: string }> | Readonly<{ status: 'restricted'; id: string }>;
/** Positions are normalized visual coordinates supplied by the host, not money. */
export function BreakdownChart({ title, items }: { title: string; items: readonly ChartItem[] }) {
  return <section className="td-chart" aria-label={title}>
    <h3>{title}</h3><p>Negative values extend left; positive values extend right. Exact values are in the table.</p>
    <ul className="td-chart-bars">{items.map((item) => {
      const drawable = item.status === 'visible' && item.amount.status === 'available' && Number.isFinite(item.position) && Math.abs(item.position) <= 1;
      return <li key={item.id}>{item.status === 'restricted' ? <span>Restricted category</span> : <><span>{item.label}</span>
        {drawable ? <span className="td-bar-track" aria-hidden="true"><span className="td-bar" style={{ width: `${Math.abs(item.position) * 50}%`, left: `${item.position < 0 ? 50 - Math.abs(item.position) * 50 : 50}%` }} /></span> : <span>Chart position unavailable</span>}
        {drawable && <Tooltip label={`Details for ${item.label}`} text={item.note} />}
      </>}</li>;
    })}</ul>
    <table className="td-table"><caption>{title} — exact data alternative</caption><thead><tr><th scope="col">Category</th><th scope="col">Exact value and currency</th><th scope="col">Access</th></tr></thead>
      <tbody>{items.map((item) => <tr key={item.id}><th scope="row">{item.status === 'restricted' ? 'Restricted category' : item.label}</th><td><AmountText amount={item.status === 'restricted' ? { status: 'restricted' } : item.amount} /></td><td>{item.status === 'restricted' ? 'Restricted' : 'Visible'}</td></tr>)}{items.length === 0 && <tr><td colSpan={3}><p role="status">No categories to display.</p></td></tr>}</tbody>
    </table>
  </section>;
}
