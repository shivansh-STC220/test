// Search by endpoint (A8) and Scan source (A9).
import { useMemo, useState } from 'react';
import { shortFile, statusClass } from '../../shared/calls.js';
import { METHOD_COLORS, send, statusColor } from '../../ui/components.jsx';

function Mark({ text, term }) {
  if (!term) return text;
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-amber-200 dark:bg-amber-500/40">{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </>
  );
}

export default function SearchView({ calls, tabId, term, setTerm, scan, setScan, onOpenCall }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  const t = term.trim().toLowerCase();
  const matches = useMemo(
    () => (t ? calls.filter((c) => c.type !== 'nav' && (c.url || '').toLowerCase().includes(t)) : []),
    [calls, t],
  );

  const runScan = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await send({ type: 'scan', tabId, term: term.trim() });
      if (r && r.ok === false) setError(r.error);
      else setScan(r);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const endpoints = (scan?.endpoints || []).filter((e) => showAll || e.apiLike);
  const uniqueEndpoints = [...new Map(endpoints.map((e) => [e.value, e])).values()];

  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      <div className="flex items-center gap-2">
        <input
          data-testid="search-input"
          className="input w-96"
          placeholder="Type an endpoint, like /cart/add or api/settings"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runScan()}
        />
        <button type="button" className="btn-primary" data-testid="btn-scan" disabled={busy} onClick={runScan}>
          {busy ? 'Scanning…' : 'Scan source'}
        </button>
        {scan && <span className="text-slate-500" data-testid="scan-summary">Scanned {scan.files.length} files{scan.term ? ` for “${scan.term}”` : ''}.</span>}
      </div>
      {error && <div className="mt-2 text-rose-600">{error}</div>}

      <h3 className="mb-1 mt-3 font-semibold">Captured calls {t && `(${matches.length})`}</h3>
      {!t ? (
        <div className="text-slate-400">Type an endpoint to see every call to it, with the button, component and line.</div>
      ) : (
        <table className="w-full table-fixed text-[11px]" data-testid="search-table">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="w-14 py-1 font-medium">Method</th>
              <th className="py-1 font-medium">URL</th>
              <th className="w-12 py-1 font-medium">Status</th>
              <th className="w-[16%] py-1 font-medium">Button</th>
              <th className="w-[20%] py-1 font-medium">Component / section</th>
              <th className="w-[18%] py-1 font-medium">File and line</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((c) => (
              <tr key={c.id} data-testid="search-row" className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60" onClick={() => onOpenCall(c.id)}>
                <td className={`mono py-0.5 font-semibold ${METHOD_COLORS[c.method] || ''}`}>{c.method}</td>
                <td className="mono truncate py-0.5" title={c.url}><Mark text={c.url} term={term.trim()} /></td>
                <td className={`py-0.5 ${statusColor(statusClass(c))}`}>{c.error ? 'failed' : c.status ?? '…'}</td>
                <td className="truncate py-0.5">{c.click?.text || <span className="text-slate-400">—</span>}</td>
                <td className="truncate py-0.5" title={c.click?.react?.chain?.join(' → ')}>
                  {c.click?.react ? c.click.react.chain.slice(-2).join(' → ') : c.click?.liquid?.block ? `block ${c.click.liquid.block.handle || c.click.liquid.block.id}` : c.click?.liquid?.section ? `section ${c.click.liquid.section.name}` : <span className="text-slate-400">—</span>}
                </td>
                <td className="mono truncate py-0.5" title={c.source?.url}>{c.source ? `${shortFile(c.source.url)}:${c.source.line}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="mb-1 mt-4 font-semibold">Found in source</h3>
      {!scan ? (
        <div className="text-slate-400">Press “Scan source” to search the page's loaded JS files, even for buttons you haven't clicked.</div>
      ) : scan.term ? (
        <div data-testid="scan-results">
          <div className="mb-1 text-slate-500">{scan.occurrences.length} places</div>
          {scan.occurrences.map((o, i) => (
            <div key={i} data-testid="scan-hit" className="border-t border-slate-100 py-1 dark:border-zinc-800">
              <div className="mono text-indigo-600 dark:text-indigo-400" title={o.file}>{shortFile(o.file)}:{o.line}:{o.col}</div>
              <div className="mono break-all text-slate-600 dark:text-zinc-300"><Mark text={o.snippet} term={scan.term} /></div>
            </div>
          ))}
        </div>
      ) : (
        <div data-testid="scan-endpoints">
          <label className="mb-1 inline-flex items-center gap-1 text-slate-500">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all URL-like strings, not only API-like ones
          </label>
          <div className="mb-1 text-slate-500">{uniqueEndpoints.length} endpoints</div>
          {uniqueEndpoints.map((e, i) => (
            <div key={i} data-testid="scan-endpoint" className="flex gap-2 border-t border-slate-100 py-0.5 dark:border-zinc-800">
              <span className="mono w-1/2 truncate" title={e.value}>{e.value}</span>
              <span className="mono truncate text-slate-500" title={e.file}>{shortFile(e.file)}:{e.line}</span>
            </div>
          ))}
        </div>
      )}
      {scan?.files?.some((f) => f.error) && (
        <details className="mt-3 text-slate-500">
          <summary>Files that could not be read</summary>
          {scan.files.filter((f) => f.error).map((f) => <div key={f.url} className="mono">{f.url}: {f.error}</div>)}
        </details>
      )}
    </div>
  );
}
