import { useMemo } from 'react';
import { displayPath, formatBytes, formatMs, shortFile, statusClass } from '../../shared/calls.js';
import { METHOD_COLORS, send, statusColor } from '../../ui/components.jsx';
import CallDetail from './CallDetail.jsx';

// Short "who made this call" text: button, then component / section, then file.
export function initiatorText(c) {
  const parts = [];
  if (c.click?.text) parts.push(`"${c.click.text}"`);
  const comp = c.click?.react?.chain?.[c.click.react.chain.length - 1];
  if (comp) parts.push(comp);
  else if (c.click?.liquid?.block) parts.push(`block ${c.click.liquid.block.handle || c.click.liquid.block.id}`);
  else if (c.click?.liquid?.section) parts.push(`section ${c.click.liquid.section.name}`);
  if (!parts.length && c.source) parts.push(`${shortFile(c.source.url)}:${c.source.line}`);
  return parts.join(' · ');
}

export default function CallsView({ calls, pageHost, selectedId, setSelectedId, tabId, onEdit, total }) {
  const selected = useMemo(() => calls.find((c) => c.id === selectedId), [calls, selectedId]);

  const onRow = (c) => {
    setSelectedId(c.id);
    if (c.click) send({ type: 'highlight', tabId, frameId: c.frameId, clickId: c.click.id, cssPath: c.click.cssPath });
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className={`min-h-0 overflow-auto ${selected ? 'w-[55%]' : 'w-full'}`}>
        <table className="w-full table-fixed border-collapse text-[11px]" data-testid="calls-table">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-slate-500 dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="w-14 px-1.5 py-1 font-medium">Method</th>
              <th className="px-1.5 py-1 font-medium">Name</th>
              <th className="w-14 px-1.5 py-1 font-medium">Status</th>
              <th className="w-14 px-1.5 py-1 font-medium">Type</th>
              <th className="w-[26%] px-1.5 py-1 font-medium">Initiator</th>
              <th className="w-20 px-1.5 py-1 font-medium">Rules</th>
              <th className="w-16 px-1.5 py-1 text-right font-medium">Time</th>
              <th className="w-16 px-1.5 py-1 text-right font-medium">Size</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => {
              if (c.type === 'nav') {
                return (
                  <tr key={c.id} className="bg-slate-100 dark:bg-zinc-800">
                    <td colSpan={8} className="px-2 py-0.5 text-slate-500">Navigated to <span className="mono">{c.url}</span></td>
                  </tr>
                );
              }
              const cls = statusClass(c);
              return (
                <tr
                  key={c.id}
                  data-testid="call-row"
                  data-url={c.url}
                  data-method={c.method}
                  onClick={() => onRow(c)}
                  className={`cursor-pointer border-b border-slate-100 dark:border-zinc-800 ${c.id === selectedId ? 'bg-indigo-50 dark:bg-indigo-500/15' : 'hover:bg-slate-50 dark:hover:bg-zinc-800/60'}`}
                >
                  <td className={`mono px-1.5 py-0.5 font-semibold ${METHOD_COLORS[c.method] || ''}`}>{c.method}</td>
                  <td className="mono truncate px-1.5 py-0.5" title={c.url}>{displayPath(c.url, pageHost)}</td>
                  <td className={`px-1.5 py-0.5 ${statusColor(cls)}`} data-testid="call-status">
                    {c.state === 'paused' ? 'paused' : c.state === 'pending' ? '…' : c.error ? 'failed' : c.status ?? ''}
                  </td>
                  <td className="px-1.5 py-0.5 text-slate-500">{c.type === 'network' ? c.resourceType || 'network' : c.type}</td>
                  <td className="truncate px-1.5 py-0.5" title={initiatorText(c)}>{initiatorText(c)}</td>
                  <td className="truncate px-1.5 py-0.5" title={(c.rules || []).map((r) => r.name).join(', ')}>
                    {(c.rules || []).length > 0 && <span className="chip bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">{c.rules.map((r) => r.name).join(', ')}</span>}
                  </td>
                  <td className="px-1.5 py-0.5 text-right text-slate-500">{formatMs(c.duration)}</td>
                  <td className="px-1.5 py-0.5 text-right text-slate-500">{formatBytes(c.resBodySize)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!calls.length && (
          <div className="p-6 text-center text-slate-400">
            {total ? 'No calls match the filters.' : 'No calls yet. Use the page: click buttons, load data. Calls show up here.'}
          </div>
        )}
      </div>
      {selected && (
        <div className="min-h-0 w-[45%]">
          <CallDetail summary={selected} tabId={tabId} onClose={() => setSelectedId(null)} onEdit={onEdit} />
        </div>
      )}
    </div>
  );
}
