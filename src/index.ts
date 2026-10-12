'use client';
export { Dashboard, type DashboardProps } from './Dashboard';
export { BoundaryState } from './components/BoundaryState';
export { ReportsUnavailable } from './reports/ReportsRoute';
export type { HostAccess, HostScope } from './access/host';
export type { RouteProvider, RouteRequest, RouteState } from './data/boundary';
export type { RouteRenderer, RouteViewContext } from './views/RouteView';
export { AmountText, type AmountDisplay } from './components/AmountText';
export { StateBadge, type BadgeState } from './components/StateBadge';
export { MetricCard } from './components/MetricCard';
export { FilterSelect, type FilterOption } from './components/FilterSelect';
export { Pagination } from './components/Pagination';
export { DataTable, type DisplayColumn, type DisplayRow, type DisplayCell, type TableSort } from './components/DataTable';
export { BreakdownChart, type ChartItem } from './components/BreakdownChart';
export { Tooltip } from './components/Tooltip';
export { EvidenceLink, type EvidenceDisplay, type EvidencePolicy } from './components/EvidenceLink';
export { ScopeContext, type ScopeDisplay } from './components/ScopeContext';
export { ReturnToResults } from './components/ReturnToResults';
export {
  FinancialSummaryView, evaluateFinancePacket, readFinancePage, projectWrapperMetadata,
  type FinancialSummaryViewProps, type FinancePacketReferences, type TrustedPacketExpectation, type PacketMode, type PacketOutcome,
  type FinanceWrapperMetadata, type FinancePageRequest, type FinancePageRead, type WrapperMetadataDisplay, type WrapperMetadataKey,
} from './views/financial-summary';
export type { ProjectionResult, SummaryProjection, MetricProjection } from './data/shared-contracts-adapter';
export {
  FinanceV2View, checkFinanceV2Page, FinanceV2ConnectedView, useFinanceV2Read, resolveFinanceV2Port, classifyFinanceV2Fault, FINANCE_V2_FAULT_COPY, FINANCE_V2_PAGINATION,
  type FinanceV2ConnectedViewProps, type FinanceV2Authorization, type FinanceV2HostAvailability, type FinanceV2ReadRequest, type FinanceV2SyntheticReadPort, type FinanceV2DataMode,
  type FinanceV2Fault, type FinanceV2FaultKind, type FinanceV2ReadOptions, type FinanceV2ReadState, type FinanceV2ReadResult, type FinanceV2PortResolution,
  type FinanceV2ViewProps, type FinanceV2ViewName, type FinanceV2TransactionFilters,type FinanceV2Page, type FinanceV2TrustedReferences, type FinanceV2CanonicalReference, type FinanceV2ExpectedHashes, type FinanceV2Input, type FinanceV2Mode, type FinanceV2Result, type FinanceV2Check, type FinanceV2RefusalCode, type OpaqueProductScope,
} from './views/finance-v2';
