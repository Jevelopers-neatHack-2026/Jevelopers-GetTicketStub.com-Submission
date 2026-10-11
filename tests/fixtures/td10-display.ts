import type { AmountDisplay, ChartItem, DisplayColumn, DisplayRow } from '../../src';
export const syntheticNotice = 'Synthetic UI display samples. These are not producer-approved finance fixtures.';
export const exactSamples: Readonly<Record<string, AmountDisplay>> = {
  zero: { status: 'available', text: '0.000000000', currency: 'USD' },
  negative: { status: 'available', text: '-12345678901234567890.000000137', currency: 'USD' },
  subcent: { status: 'available', text: '0.000000137', currency: 'EUR' },
  unknown: { status: 'unknown' }, restricted: { status: 'restricted' },
};
export const sampleColumns: readonly DisplayColumn[] = [
  { key: 'record', label: 'Record', rowHeader: true, sortable: true },
  { key: 'amount', label: 'Exact amount' }, { key: 'state', label: 'State' }, { key: 'evidence', label: 'Evidence' },
];
export const sampleRows: readonly DisplayRow[] = [
  { id: 'negative', cells: { record: { kind: 'text', text: 'Synthetic negative example / record-with-a-deliberately-long-noncustomer-identifier' }, amount: { kind: 'amount', amount: exactSamples.negative! }, state: { kind: 'text', text: 'Estimated; reconciliation unresolved' }, evidence: { kind: 'link', id: 'td10-negative-link', evidence: { status: 'permitted', href: '/admin/finance/transactions/negative-ui-sample', label: 'Open synthetic negative record' } } } },
  { id: 'subcent', cells: { record: { kind: 'text', text: 'Synthetic sub-cent example' }, amount: { kind: 'amount', amount: exactSamples.subcent! }, state: { kind: 'text', text: 'Confirmed; reconciled' }, evidence: { kind: 'link', evidence: { status: 'permitted', href: '/admin/finance/transactions/subcent-ui-sample', label: 'Open synthetic sub-cent record' } } } },
  { id: 'restricted', cells: { record: { kind: 'text', text: 'Synthetic restricted record' }, amount: { kind: 'restricted' }, state: { kind: 'text', text: 'Restricted' }, evidence: { kind: 'link', evidence: { status: 'restricted' } } } },
  { id: 'zero', cells: { record: { kind: 'text', text: 'Synthetic exact zero example' }, amount: { kind: 'amount', amount: exactSamples.zero! }, state: { kind: 'text', text: 'Explicit supplied display value' }, evidence: { kind: 'link', evidence: { status: 'unavailable' } } } },
];
export const chartSamples: readonly ChartItem[] = [
  { status: 'visible', id: 'sample-positive', label: 'Synthetic positive', amount: exactSamples.subcent!, position: 0.6, note: 'Synthetic tooltip. The displayed precision is supplied unchanged.' },
  { status: 'visible', id: 'sample-negative', label: 'Synthetic negative', amount: exactSamples.negative!, position: -0.8, note: 'Synthetic negative display sample. No financial calculation is performed.' },
  { status: 'restricted', id: 'sample-restricted' },
];
