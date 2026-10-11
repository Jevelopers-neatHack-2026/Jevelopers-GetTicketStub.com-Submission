import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir, rm, readFile, writeFile, symlink } from 'node:fs/promises';
const destination = '.fixture-package';
await rm(destination, { recursive: true, force: true });
await mkdir(destination);
const output = execFileSync('npm', ['pack', '--json', '--pack-destination', destination], { encoding: 'utf8' });
const [{ filename, files }] = JSON.parse(output);
if (files.some(({ path }) => /^(integration\/fixture-host|tests|node_modules)\//.test(path))) throw new Error('Fixture content leaked into package.');
execFileSync('tar', ['-xzf', `${destination}/${filename}`, '-C', destination]);
const pkg = JSON.parse(await readFile(`${destination}/package/package.json`, 'utf8'));
console.log(`Fixture consumes packed ${pkg.name}@${pkg.version}; ${files.length} package files.`);

await mkdir(`${destination}/node_modules/@jevelopers`, { recursive: true });
await symlink(resolve(destination, 'package'), `${destination}/node_modules/@jevelopers/team-dashboard`, 'dir');
await writeFile(`${destination}/consumer.ts`, `import { Dashboard, AmountText, MetricCard, StateBadge, FilterSelect, Pagination, DataTable, BreakdownChart, Tooltip, ScopeContext, EvidenceLink, ReturnToResults, type AmountDisplay, type EvidencePolicy, type DisplayColumn, type DisplayRow, type ChartItem, type TableSort, type HostAccess, type RouteProvider } from '@jevelopers/team-dashboard';
import { createElement } from 'react';
import { routeHref } from '@jevelopers/team-dashboard/integration';
import '@jevelopers/team-dashboard/style.css';
const access: HostAccess = { status: 'restricted' };
const provider: RouteProvider<string> = { mode: 'integrated', async readRoute() { return { status: 'unavailable' }; } };
Dashboard({ basePath: '/admin/finance', pathname: routeHref('/admin/finance', 'overview'), navigate() {}, access, provider });
const amount: AmountDisplay = { status: 'available', text: '0.000000137', currency: 'EUR' };
const policy: EvidencePolicy = { origin: 'https://host.example', allowedOrigins: [], allowedPathPrefixes: ['/admin/finance'] };
const columns: readonly DisplayColumn[] = [{ key: 'record', label: 'Record', rowHeader: true, sortable: true }];
const rows: readonly DisplayRow[] = [{ id: 'synthetic', cells: { record: { kind: 'amount', amount } } }];
const items: readonly ChartItem[] = [{ status: 'visible', id: 'synthetic', label: 'Synthetic', amount, position: .5, note: 'Synthetic note' }];
const sort: TableSort = { key: 'record', direction: 'ascending' };
const elements = [
  createElement(AmountText, { amount }), createElement(MetricCard, { title: 'Synthetic', amount }),
  createElement(StateBadge, { state: 'fixture' }), createElement(FilterSelect, { label: 'Synthetic filter', value: 'one', options: [{ value: 'one', label: 'One' }], onChange() {} }),
  createElement(Pagination, { pageLabel: 'Supplied label', hasPrevious: false, hasNext: false, onNavigate() {} }),
  createElement(DataTable, { caption: 'Synthetic', columns, rows, sort, onSort() {}, linkPolicy: policy }),
  createElement(BreakdownChart, { title: 'Synthetic', items }), createElement(Tooltip, { label: 'Details', text: 'Synthetic' }),
  createElement(ScopeContext, { scope: { status: 'restricted' } }),
  createElement(EvidenceLink, { evidence: { status: 'restricted' }, policy }),
  createElement(ReturnToResults, { href: '/admin/finance/transactions', policy, onNavigate() {} }),
];
void elements;
`);
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--ignoreConfig', '--noEmit', '--strict', '--moduleResolution', 'bundler', '--module', 'esnext', '--target', 'es2022', '--jsx', 'react-jsx', '--skipLibCheck', 'false', `${destination}/consumer.ts`], { stdio: 'inherit' });
console.log('Packed exports and declarations passed isolated TypeScript consumer compilation.');
