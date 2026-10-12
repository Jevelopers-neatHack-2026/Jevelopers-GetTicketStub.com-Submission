import { useId, useState } from 'react';
import { FINANCE_V2_FORMAT_FILE, type FinanceV2ExportFormat } from './export-check';
import { FINANCE_V2_EXPORT_ERROR_COPY, FINANCE_V2_EXPORT_UNAVAILABLE_COPY, usePreparedExport, type FinanceV2PreparedExportOptions } from './export-port';

/**
 * Manual prepared CFO export (JSON or CSV), in explicit synthetic conformance mode. It prepares the producer's file through the host-injected port, shows only the manifest fields as
 * delivered, and hands bytes to the browser only on an explicit Download while the host's own access still holds. It never claims delivery: the honest status is `prepared` /
 * `manual_prepared` with no delivery reference. No file content, token, cursor or port message is rendered.
 */
const FORMATS: readonly Readonly<{ value: FinanceV2ExportFormat; label: string }>[] = [
  { value: 'json', label: 'JSON (summary.json)' },
  { value: 'csv', label: 'CSV (metrics.csv)' },
];

export function PreparedExportPanel(props: FinanceV2PreparedExportOptions) {
  const groupName = useId();
  const result = usePreparedExport(props);
  const [downloaded, setDownloaded] = useState<Readonly<{ exportId: string; fileName: string }> | null>(null);
  const [refusedDownload, setRefusedDownload] = useState(false);
  const { unavailable, state, format } = result;
  const preparing = state.phase === 'preparing';
  const note = <p role="note"><strong>SYNTHETIC_EXPORT_CONFORMANCE_ONLY</strong>: this prepares a file for manual handoff only. Nothing is sent to the CFO, delivery is not claimed, and the export is not an acceptance by Finance, the CFO or the host.</p>;
  if (unavailable !== null) {
    return <section className="td-example-section" aria-label="CFO export"><h3>CFO export</h3>{note}
      <p role="status">{FINANCE_V2_EXPORT_UNAVAILABLE_COPY[unavailable]}</p>
      <button type="button" disabled>Export unavailable</button>
    </section>;
  }
  const onPrepare = () => {
    if (preparing) return;
    setDownloaded(null); setRefusedDownload(false);
    result.prepare();
  };
  const onDownload = () => {
    const fileName = result.download();
    if (state.phase === 'prepared' && fileName !== null) { setRefusedDownload(false); setDownloaded({ exportId: state.manifest.exportId, fileName }); }
    else { setDownloaded(null); setRefusedDownload(true); }
  };
  const target = FINANCE_V2_FORMAT_FILE[format];
  return <section className="td-example-section" aria-label="CFO export"><h3>CFO export</h3>{note}
    <p>The export covers the whole original first snapshot page of this report, not the rows currently filtered on screen. Changing the filters, format, scope or access discards anything prepared.</p>
    <fieldset className="td-export-formats"><legend>Export format</legend>
      {FORMATS.map((option) => <label key={option.value}>
        <input type="radio" name={groupName} value={option.value} checked={format === option.value} onChange={() => result.setFormat(option.value)} />{option.label}
      </label>)}
    </fieldset>
    <div className="td-export-actions">
      <button type="button" aria-disabled={preparing} onClick={onPrepare}>Prepare manual export</button>
      {state.phase === 'prepared' && <button type="button" onClick={onDownload}>{`Download ${target}`}</button>}
    </div>
    {state.phase === 'idle' && <p role="status">Nothing is prepared yet. Preparing an export does not send anything to the CFO.</p>}
    {preparing && <p role="status" aria-busy="true">Preparing the export. Nothing is shown or downloaded until it is verified.</p>}
    {state.phase === 'prepared' && <>
      <p role="status">{downloaded !== null && downloaded.exportId === state.manifest.exportId ? `Download of ${downloaded.fileName} started. ` : ''}Prepared for manual handoff. It has not been delivered to the CFO and there is no delivery reference.</p>
      {refusedDownload && <p role="alert">The download was not started because the host access it needs is no longer confirmed. Nothing was downloaded.</p>}
      <dl>
        <div><dt>Export status</dt><dd>{state.manifest.status}</dd></div>
        <div><dt>Delivery</dt><dd>{state.manifest.delivery} (not delivered)</dd></div>
        <div><dt>Delivery reference</dt><dd>None</dd></div>
        <div><dt>Export id</dt><dd>{state.manifest.exportId}</dd></div>
        <div><dt>Prepared at (producer clock)</dt><dd>{state.manifest.createdAt}</dd></div>
        <div><dt>Requested format</dt><dd>{state.manifest.requestedFormat}</dd></div>
        <div><dt>Evidence mode (label only)</dt><dd>{state.manifest.evidenceMode}</dd></div>
        <div><dt>Currencies</dt><dd>{state.manifest.currencies.length === 0 ? 'None delivered' : state.manifest.currencies.join(', ')}</dd></div>
        <div><dt>Metric rows</dt><dd>{state.manifest.itemCount}</dd></div>
        {state.manifest.artifacts.map((artifact) => <div key={artifact.fileName}><dt>{artifact.fileName}</dt><dd>{`${artifact.byteLength} bytes, ${artifact.contentHash}`}</dd></div>)}
      </dl>
    </>}
    {state.phase === 'refused' && <section role="alert"><h4>Export refused</h4>
      <p>The prepared export failed the presentation check, so no file is available. No file was produced.</p>
      <dl><div><dt>Refusal code</dt><dd>{state.code}</dd></div><div><dt>Refusal path</dt><dd>{state.path}</dd></div></dl></section>}
    {state.phase === 'failed' && <p role="alert">{FINANCE_V2_EXPORT_ERROR_COPY[state.code]}</p>}
    {state.phase === 'discarded' && <p role="alert">{FINANCE_V2_EXPORT_UNAVAILABLE_COPY[state.reason]}</p>}
  </section>;
}
