import { useMemo } from 'react';
import { displayPath, formatBytes, formatMs, hostOf, shortFile, statusClass } from '../../shared/calls.js';
import { EmptyState, MethodTag, send, statusTone } from '../../ui/components.jsx';
import { Icon } from '../../ui/icons.jsx';
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

function Initiator({ c }) {
  const comp = c.click?.react?.chain?.[c.click.react.chain.length - 1];
  const where = comp
    ? { icon: 'atom', text: comp }
    : c.click?.liquid?.block
      ? { icon: 'droplet', text: `block ${c.click.liquid.block.handle || c.click.liquid.block.id}` }
      : c.click?.liquid?.section
        ? { icon: 'droplet', text: `section ${c.click.liquid.section.name}` }
        : null;
  if (c.click) {
    return (
      <span className="flex min-w-0 items-center gap-1.5" title={initiatorText(c)}>
        <Icon name="pointer" size={12} className="text-accent" />
        <span className="truncate">{c.click.text ? `"${c.click.text}"` : `<${c.click.tag}>`}</span>
        {where && (
          <span className="flex min-w-0 items-center gap-1 text-fg-3">
            <Icon name={where.icon} size={11} />
            <span className="truncate">{where.text}</span>
          </span>
        )}
      </span>
    );
  }
  if (c.source) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-fg-2" title={c.source.url}>
        <Icon name="fileCode" size={12} className="text-fg-3" />
        <span className="mono truncate">{shortFile(c.source.url)}:{c.source.line}</span>
      </span>
    );
  }
  return <span className="text-fg-3">—</span>;
}

function TimeBar({ ms, max, tone }) {
  if (ms == null) return null;
  const w = Math.max(4, Math.min(100, (ms / (max || 1)) * 100));
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span className={`block h-full rounded-full ${tone.bar}`} style={{ width: `${w}%` }} />
      </span>
      <span className="w-12 text-right tabular-nums text-fg-2">{formatMs(ms)}</span>
    </span>
  );
}

export default function CallsView({ calls, pageHost, selectedId, setSelectedId, tabId, onEdit, total }) {
  const selected = useMemo(() => calls.find((c) => c.id === selectedId), [calls, selectedId]);
  const maxMs = useMemo(() => Math.max(1, ...calls.map((c) => c.duration || 0)), [calls]);

  const onRow = (c) => {
    setSelectedId(c.id);
    if (c.click) send({ type: 'highlight', tabId, frameId: c.frameId, clickId: c.click.id, cssPath: c.click.cssPath });
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className={`min-h-0 overflow-auto ${selected ? 'w-[56%] border-r border-line' : 'w-full'}`}>
        <table className="w-full table-fixed border-collapse" data-testid="calls-table">
          <thead className="sticky top-0 z-10 bg-subtle text-left">
            <tr className="eyebrow border-b border-line">
              <th className="w-[58px] px-2 py-1.5 font-semibold">Method</th>
              <th className="px-2 py-1.5 font-semibold">Name</th>
              <th className="w-[68px] px-2 py-1.5 font-semibold">Status</th>
              <th className="w-[62px] px-2 py-1.5 font-semibold">Type</th>
              <th className={`${selected ? 'hidden' : 'w-[26%]'} px-2 py-1.5 font-semibold`}>Initiator</th>
              <th className={`${selected ? 'hidden' : 'w-[110px]'} px-2 py-1.5 font-semibold`}>Rules</th>
              <th className="w-[112px] px-2 py-1.5 text-right font-semibold">Time</th>
              <th className="w-[62px] px-2 py-1.5 text-right font-semibold">Size</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => {
              if (c.type === 'nav') {
                return (
                  <tr key={c.id} className="border-b border-line-2 bg-subtle">
                    <td colSpan={8} className="px-2 py-1 text-fg-2">
                      <span className="inline-flex items-center gap-1.5"><Icon name="globe" size={12} /> Navigated to <span className="mono text-fg">{c.url}</span></span>
                    </td>
                  </tr>
                );
              }
              const cls = statusClass(c);
              const tone = statusTone(cls);
              const isSel = c.id === selectedId;
              const otherHost = pageHost && hostOf(c.url) !== pageHost;
              return (
                <tr
                  key={c.id}
                  data-testid="call-row"
                  data-url={c.url}
                  data-method={c.method}
                  onClick={() => onRow(c)}
                  className={`h-[28px] cursor-pointer border-b border-line-2 ${isSel ? 'bg-accent-soft shadow-[inset_2px_0_0_var(--accent)]' : 'hover:bg-subtle'}`}
                >
                  <td className="px-2"><MethodTag method={c.method} /></td>
                  <td className="truncate px-2" title={c.url}>
                    <span className="mono">{displayPath(c.url, pageHost).replace(otherHost ? hostOf(c.url) : '', '') || '/'}</span>
                    {otherHost && <span className="mono ml-1.5 text-fg-3">{hostOf(c.url)}</span>}
                  </td>
                  <td className="px-2" data-testid="call-status">
                    <span className={`inline-flex items-center gap-1.5 tabular-nums ${tone.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                      {c.state === 'paused' ? 'paused' : c.state === 'pending' || (c.state === 'receiving' && !c.status) ? '…' : c.error ? 'failed' : c.status ?? '—'}
                    </span>
                  </td>
                  <td className="truncate px-2 text-fg-2">{c.type === 'network' ? c.resourceType || 'network' : c.type}</td>
                  <td className={`${selected ? 'hidden' : ''} px-2`}><Initiator c={c} /></td>
                  <td className={`${selected ? 'hidden' : ''} truncate px-2`} title={(c.rules || []).map((r) => r.name).join(', ')}>
                    {(c.rules || []).length > 0 && (
                      <span className="chip max-w-full bg-accent-soft text-accent-fg">
                        <Icon name="zap" size={10} /><span className="truncate">{c.rules.map((r) => r.name).join(', ')}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-2"><TimeBar ms={c.duration} max={maxMs} tone={tone} /></td>
                  <td className="px-2 text-right tabular-nums text-fg-2">{formatBytes(c.resBodySize)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!calls.length && (
          total ? (
            <EmptyState icon="filter" title="No calls match the filters">Change or clear the filters to see more.</EmptyState>
          ) : (
            <EmptyState icon="activity" title="Waiting for calls">Use the page: click buttons, load data. Each API call shows up here, with the button and code that made it.</EmptyState>
          )
        )}
      </div>
      {selected && (
        <div className="slide-in min-h-0 w-[44%] min-w-[340px]">
          <CallDetail summary={selected} tabId={tabId} pageHost={pageHost} onClose={() => setSelectedId(null)} onEdit={onEdit} />
        </div>
      )}
    </div>
  );
}
