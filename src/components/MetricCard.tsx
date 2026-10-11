import { useId } from 'react';
import { AmountText, type AmountDisplay } from './AmountText';
import { StateBadge, type BadgeState } from './StateBadge';
export function MetricCard({ title, amount, states = [], description }: { title: string; amount: AmountDisplay; states?: readonly BadgeState[]; description?: string }) {
  const id = useId();
  return <section className="td-metric" aria-labelledby={id}>
    <h3 id={id}>{title}</h3><AmountText amount={amount} />
    {amount.status !== 'restricted' && <><div className="td-badges">{states.map((state) => <StateBadge key={state} state={state} />)}</div>{description && <p>{description}</p>}</>}
  </section>;
}
