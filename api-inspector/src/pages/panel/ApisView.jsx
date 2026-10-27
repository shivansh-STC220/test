// "APIs" view: how many APIs the site uses, grouped by endpoint, with filters.
import { useMemo } from 'react';
import { endpointMatchesFilter, formatMs, groupEndpoints } from '../../shared/calls.js';
import { METHOD_COLORS } from '../../ui/components.jsx';

export default function ApisView({ calls, filter, scan, onOpenEndpoint, onOpenSource }) {
  const all = useMemo(() => groupEndpoints(calls, scan?.endpoints || []), [calls, scan]);
  const shown = useMemo(() => all.filter((g) => endpointMatchesFilter(g, filter)), [all, filter]);
  const live = shown.filter((g) => g.live).length;
  const fromSource = shown.length - live;
  const totalCalls = shown.reduce((n, g) => n + g.count, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-baseline gap-3 px-3 py-2">
        <div className="text-2xl font-semibold" data-testid="api-count">{shown.length}</div>
        <div>
          <div className="font-medium">APIs used on this site{shown.length !== all.length ? ` (filtered from ${all.length})` : ''}</div>
          <div className="text-slate-500" data-testid="api-count-detail">
            {live} seen live · {totalCalls} calls{scan ? ` · ${fromSource} more found only in source` : ''}
          </div>
        </div>
        {!scan && <div className="text-slate-400">Tip: run “Scan source” in the Search tab to also count APIs that were not called yet.</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-collapse text-[11px]" data-testid="apis-table">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500 dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="w-14 px-1.5 py-1 font-medium">Method</th>
              <th className="px-1.5 py-1 font-medium">Endpoint</th>
              <th className="w-12 px-1.5 py-1 text-right font-medium">Calls</th>
              <th className="w-24 px-1.5 py-1 font-medium">Status</th>
              <th className="w-16 px-1.5 py-1 text-right font-medium">Avg time</th>
              <th className="w-20 px-1.5 py-1 font-medium">Type</th>
              <th className="w-[18%] px-1.5 py-1 font-medium">Buttons</th>
              <th className="w-[18%] px-1.5 py-1 font-medium">Code</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((g) => (
              <tr
                key={g.key}
                data-testid="api-row"
                data-key={g.key}
                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
                onClick={() => (g.live ? onOpenEndpoint(g.key) : onOpenSource(g.path))}
                title={g.live ? 'Show these calls' : 'Found in source only. Click to search for it.'}
              >
                <td className={`mono px-1.5 py-0.5 font-semibold ${METHOD_COLORS[g.method] || 'text-slate-400'}`}>{g.method}</td>
                <td className="mono truncate px-1.5 py-0.5" title={g.example}>
                  {g.host && <span className="text-slate-400">{g.host}</span>}{g.path}
                  {!g.live && <span className="chip ml-1 bg-slate-100 text-slate-500 dark:bg-zinc-700">source only</span>}
                </td>
                <td className="px-1.5 py-0.5 text-right">{g.count}</td>
                <td className="truncate px-1.5 py-0.5">{Object.entries(g.statuses).map(([s, n]) => `${s}×${n}`).join(' ')}</td>
                <td className="px-1.5 py-0.5 text-right">{formatMs(g.avgMs)}</td>
                <td className="truncate px-1.5 py-0.5">{g.types.join(', ')}</td>
                <td className="truncate px-1.5 py-0.5" title={g.buttons.join(', ')}>{g.buttons.join(', ')}</td>
                <td className="mono truncate px-1.5 py-0.5" title={g.sources.join(', ')}>{g.sources.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <div className="p-6 text-center text-slate-400">No APIs yet.</div>}
      </div>
    </div>
  );
}
