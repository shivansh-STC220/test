// "APIs" view: how many APIs the site uses, grouped by endpoint, with filters.
import { useMemo } from 'react';
import { endpointMatchesFilter, formatMs, groupEndpoints } from '../../shared/calls.js';
import { EmptyState, MethodTag } from '../../ui/components.jsx';
import { Icon } from '../../ui/icons.jsx';

function Stat({ label, value, hint, testId, accent }) {
  return (
    <div className={`card min-w-[120px] flex-1 px-3 py-2 ${accent ? 'border-accent/40 bg-accent-soft' : ''}`}>
      <div className="eyebrow">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${accent ? 'text-accent-fg' : ''}`} data-testid={testId}>{value}</div>
      {hint && <div className="text-[11px] text-fg-3">{hint}</div>}
    </div>
  );
}

function StatusList({ statuses }) {
  return (
    <span className="flex flex-wrap gap-1">
      {Object.entries(statuses).map(([s, n]) => {
        const code = Number(s);
        const tone = code >= 500 || s === 'failed' || s === 'error' ? 'bg-rose-500/12 text-rose-700 dark:text-rose-300'
          : code >= 400 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
            : code >= 200 ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-fg-2';
        return <span key={s} className={`chip tabular-nums ${tone}`}>{s}{n > 1 ? ` ×${n}` : ''}</span>;
      })}
    </span>
  );
}

export default function ApisView({ calls, filter, scan, onOpenEndpoint, onOpenSource, onScan }) {
  const all = useMemo(() => groupEndpoints(calls, scan?.endpoints || []), [calls, scan]);
  const shown = useMemo(() => all.filter((g) => endpointMatchesFilter(g, filter)), [all, filter]);
  const live = shown.filter((g) => g.live).length;
  const fromSource = shown.length - live;
  const totalCalls = shown.reduce((n, g) => n + g.count, 0);
  const hosts = new Set(shown.map((g) => g.host).filter(Boolean)).size;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-stretch gap-2 px-3 pt-3">
        <Stat label="APIs used on this site" value={shown.length} testId="api-count" accent hint={shown.length !== all.length ? `filtered from ${all.length}` : 'unique endpoints'} />
        <Stat label="Seen live" value={live} hint="called while you used the page" />
        <Stat label="Calls" value={totalCalls} hint={`to ${hosts} host${hosts === 1 ? '' : 's'}`} />
        <Stat label="Only in source" value={scan ? fromSource : '—'} hint={scan ? 'found by Scan source' : 'run Scan source'} />
      </div>
      <div className="flex items-center gap-2 px-3 py-2 text-fg-2">
        <span data-testid="api-count-detail">
          {live} seen live · {totalCalls} calls{scan ? ` · ${fromSource} more found only in source` : ''}
        </span>
        {!scan && (
          <button type="button" className="btn-ghost h-6 text-[11px] text-accent-fg" onClick={onScan}>
            <Icon name="scan" size={12} /> Scan source to find APIs not called yet
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto border-t border-line">
        <table className="w-full table-fixed border-collapse" data-testid="apis-table">
          <thead className="sticky top-0 bg-subtle text-left">
            <tr className="eyebrow border-b border-line">
              <th className="w-[58px] px-2 py-1.5 font-semibold">Method</th>
              <th className="px-2 py-1.5 font-semibold">Endpoint</th>
              <th className="w-14 px-2 py-1.5 text-right font-semibold">Calls</th>
              <th className="w-28 px-2 py-1.5 font-semibold">Status</th>
              <th className="w-20 px-2 py-1.5 text-right font-semibold">Avg time</th>
              <th className="w-24 px-2 py-1.5 font-semibold">Type</th>
              <th className="w-[17%] px-2 py-1.5 font-semibold">Buttons</th>
              <th className="w-[17%] px-2 py-1.5 font-semibold">Code</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((g) => (
              <tr
                key={g.key}
                data-testid="api-row"
                data-key={g.key}
                className={`h-[28px] cursor-pointer border-b border-line-2 hover:bg-subtle ${g.live ? '' : 'text-fg-2'}`}
                onClick={() => (g.live ? onOpenEndpoint(g.key) : onOpenSource(g.path))}
                title={g.live ? 'Show these calls' : 'Found in source only. Click to search for it.'}
              >
                <td className="px-2">{g.live ? <MethodTag method={g.method} /> : <span className="chip bg-muted text-fg-3">ANY</span>}</td>
                <td className="truncate px-2" title={g.example}>
                  {g.host && <span className="mono text-fg-3">{g.host}</span>}
                  <span className="mono font-medium">{g.path}</span>
                  {!g.live && <span className="chip ml-1.5 bg-muted text-fg-3"><Icon name="fileCode" size={10} />source only</span>}
                </td>
                <td className="px-2 text-right font-semibold tabular-nums">{g.count}</td>
                <td className="truncate px-2"><StatusList statuses={g.statuses} /></td>
                <td className="px-2 text-right tabular-nums text-fg-2">{formatMs(g.avgMs)}</td>
                <td className="truncate px-2 text-fg-2">{g.types.join(', ')}</td>
                <td className="truncate px-2" title={g.buttons.join(', ')}>{g.buttons.map((b) => `"${b}"`).join(', ')}</td>
                <td className="mono truncate px-2 text-fg-2" title={g.sources.join(', ')}>{g.sources.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <EmptyState icon="chart" title={all.length ? 'No APIs match the filters' : 'No APIs yet'}>{all.length ? 'Change or clear the filters.' : 'Use the page, or run Scan source to find APIs in the code.'}</EmptyState>}
      </div>
    </div>
  );
}
