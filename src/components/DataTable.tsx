import { TableScroll } from './TableScroll';
import { AmountText, type AmountDisplay } from './AmountText';
import { EvidenceLink, type EvidenceDisplay, type EvidencePolicy } from './EvidenceLink';
export type DisplayCell = Readonly<{ kind: 'text'; text: string }> | Readonly<{ kind: 'restricted' }> | Readonly<{ kind: 'amount'; amount: AmountDisplay }> | Readonly<{ kind: 'link'; evidence: EvidenceDisplay; id?: string }>;
export type DisplayRow = Readonly<{ id: string; cells: Readonly<Record<string, DisplayCell>> }>;
export type DisplayColumn = Readonly<{ key: string; label: string; rowHeader?: boolean; sortable?: boolean }>;
export type TableSort = Readonly<{ key: string; direction: 'ascending' | 'descending' }>;
export function DataTable({ caption, columns, rows, sort, onSort, linkPolicy, onNavigate }: {
  caption: string; columns: readonly DisplayColumn[]; rows: readonly DisplayRow[]; sort?: TableSort; onSort?: (sort: TableSort) => void; linkPolicy: EvidencePolicy; onNavigate?: (href: string) => void;
}) {
  function cellContent(cell: DisplayCell | undefined) {
    if (!cell) return 'Unavailable';
    if (cell.kind === 'restricted') return 'Restricted';
    if (cell.kind === 'amount') return <AmountText amount={cell.amount} />;
    if (cell.kind === 'link') return <EvidenceLink evidence={cell.evidence} policy={linkPolicy} {...(onNavigate ? { onNavigate } : {})} {...(cell.id ? { id: cell.id } : {})} />;
    return cell.text;
  }
  return <TableScroll caption={caption}>
    <table className="td-table" style={{ minWidth: `${Math.max(1, columns.length) * 22}rem`, width: `${Math.max(1, columns.length) * 22}rem` }}><colgroup>{columns.map((column, index) => <col key={column.key} style={{ width: columns.length === 1 ? '100%' : index === columns.length - 1 ? '18%' : `${82 / (columns.length - 1)}%` }} />)}</colgroup><caption>{caption}</caption>
      <thead><tr>{columns.map((column) => <th key={column.key} scope="col" aria-sort={sort?.key === column.key ? sort.direction : undefined}>
        {column.sortable && onSort ? <button type="button" onClick={() => onSort({ key: column.key, direction: sort?.key === column.key && sort.direction === 'ascending' ? 'descending' : 'ascending' })}>{column.label}<span className="td-sort-label">{sort?.key === column.key ? ` · ${sort.direction}` : ' · sort'}</span></button> : column.label}
      </th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}>{columns.map((column) => column.rowHeader ? <th key={column.key} scope="row">{cellContent(row.cells[column.key])}</th> : <td key={column.key}>{cellContent(row.cells[column.key])}</td>)}</tr>)}{rows.length === 0 && <tr><td colSpan={columns.length || 1}><p role="status">No rows to display.</p></td></tr>}</tbody>
    </table>
  </TableScroll>;
}
