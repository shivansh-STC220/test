// Search by endpoint (A8) and Scan source (A9).
import { useMemo, useState } from 'react';
import { shortFile, statusClass } from '../../shared/calls.js';
import { EmptyState, MethodTag, send, statusTone } from '../../ui/components.jsx';
import { Icon } from '../../ui/icons.jsx';

function Mark({ text, term }) {
  if (!term) return text;
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-amber-300/60 px-px text-inherit dark:bg-amber-400/30">{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </>
  );
}

function Card({ icon, title, count, children, right }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line-2 bg-subtle px-3 py-1.5">
        <Icon name={icon} size={13} className="text-accent" />
        <h3 className="font-semibold">{title}</h3>
        {count != null && <span className="chip bg-muted text-fg-2 tabular-nums">{count}</span>}
        <div className="ml-auto">{right}</div>
      </div>
      {children}
    </section>
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
    <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[280px] flex-1 lg:max-w-xl">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3" />
          <input
            data-testid="search-input"
            className="input h-8 w-full pl-8 text-[13px]"
            placeholder="Type an endpoint, like /cart/add or api/settings"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runScan()}
          />
        </div>
        <button type="button" className="btn-primary h-8" data-testid="btn-scan" disabled={busy} onClick={runScan}>
          <Icon name="scan" size={14} className={busy ? 'pulse' : ''} />
          {busy ? 'Scanning…' : 'Scan source'}
        </button>
        {scan && (
          <span className="pill bg-muted text-fg-2" data-testid="scan-summary">
            <Icon name="fileCode" size={12} /> Scanned {scan.files.length} files{scan.term ? ` for “${scan.term}”` : ''}.
          </span>
        )}
      </div>
      {error && <div className="flex items-center gap-1.5 text-rose-600"><Icon name="alert" size={13} />{error}</div>}

      <Card icon="activity" title="Captured calls" count={t ? matches.length : null}>
        {!t ? (
          <div className="px-3 py-3 text-fg-2">Type an endpoint to see every call to it, with the button, component and line.</div>
        ) : !matches.length ? (
          <div className="px-3 py-3 text-fg-2">No captured call has this text. Try “Scan source” to look in the code.</div>
        ) : (
          <table className="w-full table-fixed" data-testid="search-table">
            <thead className="text-left">
              <tr className="eyebrow border-b border-line-2">
                <th className="w-[58px] px-2 py-1.5 font-semibold">Method</th>
                <th className="px-2 py-1.5 font-semibold">URL</th>
                <th className="w-14 px-2 py-1.5 font-semibold">Status</th>
                <th className="w-[16%] px-2 py-1.5 font-semibold">Button</th>
                <th className="w-[20%] px-2 py-1.5 font-semibold">Component / section</th>
                <th className="w-[18%] px-2 py-1.5 font-semibold">File and line</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((c) => {
                const tone = statusTone(statusClass(c));
                return (
                  <tr key={c.id} data-testid="search-row" className="h-[28px] cursor-pointer border-t border-line-2 hover:bg-subtle" onClick={() => onOpenCall(c.id)}>
                    <td className="px-2"><MethodTag method={c.method} /></td>
                    <td className="mono truncate px-2" title={c.url}><Mark text={c.url} term={term.trim()} /></td>
                    <td className={`px-2 tabular-nums ${tone.text}`}>{c.error ? 'failed' : c.status ?? '…'}</td>
                    <td className="truncate px-2">{c.click?.text || <span className="text-fg-3">—</span>}</td>
                    <td className="truncate px-2" title={c.click?.react?.chain?.join(' → ')}>
                      {c.click?.react ? c.click.react.chain.slice(-2).join(' → ') : c.click?.liquid?.block ? `block ${c.click.liquid.block.handle || c.click.liquid.block.id}` : c.click?.liquid?.section ? `section ${c.click.liquid.section.name}` : <span className="text-fg-3">—</span>}
                    </td>
                    <td className="mono truncate px-2 text-accent-fg" title={c.source?.url}>{c.source ? `${shortFile(c.source.url)}:${c.source.line}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        icon="fileCode"
        title="Found in source"
        count={scan ? (scan.term ? scan.occurrences.length : uniqueEndpoints.length) : null}
        right={scan && !scan.term && (
          <label className="inline-flex items-center gap-1.5 text-[11px] text-fg-2">
            <input type="checkbox" className="accent-[var(--accent)]" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all URL-like strings
          </label>
        )}
      >
        {!scan ? (
          <EmptyState icon="scan" title="Search the page's code">Press “Scan source” to look through the loaded JS files, even for buttons you haven't clicked.</EmptyState>
        ) : scan.term ? (
          <div data-testid="scan-results" className="divide-y divide-line-2">
            {!scan.occurrences.length && <div className="px-3 py-3 text-fg-2">Not found in any loaded file.</div>}
            {scan.occurrences.map((o, i) => (
              <div key={i} data-testid="scan-hit" className="px-3 py-1.5">
                <div className="mono font-medium text-accent-fg" title={o.file}>{shortFile(o.file)}:{o.line}:{o.col}</div>
                <div className="mono break-all text-fg-2"><Mark text={o.snippet} term={scan.term} /></div>
              </div>
            ))}
          </div>
        ) : (
          <div data-testid="scan-endpoints" className="divide-y divide-line-2">
            {uniqueEndpoints.map((e, i) => (
              <div key={i} data-testid="scan-endpoint" className="flex gap-3 px-3 py-1">
                <span className="mono w-1/2 truncate font-medium" title={e.value}>{e.value}</span>
                <span className="mono truncate text-fg-3" title={e.file}>{shortFile(e.file)}:{e.line}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      {scan?.files?.some((f) => f.error) && (
        <details className="text-fg-2">
          <summary className="cursor-pointer">Files that could not be read</summary>
          {scan.files.filter((f) => f.error).map((f) => <div key={f.url} className="mono">{f.url}: {f.error}</div>)}
        </details>
      )}
    </div>
  );
}
