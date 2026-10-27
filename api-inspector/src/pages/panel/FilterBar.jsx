import { EMPTY_FILTER, filterIsEmpty } from '../../shared/calls.js';
import { Icon } from '../../ui/icons.jsx';
import { statusTone } from '../../ui/components.jsx';

const METHOD_CHIPS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const STATUS_CHIPS = ['2xx', '3xx', '4xx', '5xx', 'failed', 'pending'];
const TYPE_CHIPS = ['fetch', 'xhr', 'beacon', 'network', 'replay', 'client'];

function Chip({ on, onClick, children, testId, dot }) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors ${on ? 'bg-accent-soft text-accent-fg ring-1 ring-accent/30' : 'text-fg-2 hover:bg-muted hover:text-fg'}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
      {children}
    </button>
  );
}

export default function FilterBar({ filter, setFilter, hosts }) {
  const toggle = (key, v) => {
    const list = filter[key];
    setFilter({ ...filter, [key]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] });
  };
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-bg px-2 py-1.5">
      <div className="relative">
        <Icon name="search" size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-3" />
        <input
          data-testid="filter-text"
          className="input w-64 pl-7"
          placeholder="Filter URL, button, component… or /regex/"
          value={filter.text}
          onChange={(e) => setFilter({ ...filter, text: e.target.value })}
        />
      </div>
      <div className="flex items-center gap-0.5">
        {METHOD_CHIPS.map((m) => <Chip key={m} testId={`f-method-${m}`} on={filter.methods.includes(m)} onClick={() => toggle('methods', m)}>{m}</Chip>)}
      </div>
      <span className="divider" />
      <div className="flex items-center gap-0.5">
        {STATUS_CHIPS.map((s) => <Chip key={s} testId={`f-status-${s}`} dot={statusTone(s).dot.replace(' pulse', '')} on={filter.statuses.includes(s)} onClick={() => toggle('statuses', s)}>{s}</Chip>)}
      </div>
      <span className="divider" />
      <div className="flex items-center gap-0.5">
        {TYPE_CHIPS.map((t) => <Chip key={t} testId={`f-type-${t}`} on={filter.types.includes(t)} onClick={() => toggle('types', t)}>{t}</Chip>)}
      </div>
      <span className="divider" />
      <select data-testid="f-host" className="input h-6 max-w-44 text-[11px]" value={filter.hosts[0] || ''} onChange={(e) => setFilter({ ...filter, hosts: e.target.value ? [e.target.value] : [] })}>
        <option value="">All hosts</option>
        {hosts.map((h) => <option key={h} value={h}>{h}</option>)}
        {filter.hosts[0] && !hosts.includes(filter.hosts[0]) && <option value={filter.hosts[0]}>{filter.hosts[0]}</option>}
      </select>
      <select data-testid="f-frame" className="input h-6 text-[11px]" value={filter.frame} onChange={(e) => setFilter({ ...filter, frame: e.target.value })}>
        <option value="all">All frames</option>
        <option value="top">Top page only</option>
        <option value="iframe">iframes only</option>
      </select>
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-fg-2">
        <input data-testid="f-rule" type="checkbox" className="accent-[var(--accent)]" checked={filter.ruleOnly} onChange={(e) => setFilter({ ...filter, ruleOnly: e.target.checked })} />
        Changed by a rule
      </label>
      {filter.endpoint && (
        <span className="chip bg-accent-soft text-accent-fg">
          API: <span className="mono">{filter.endpoint}</span>
          <button type="button" title="Remove" onClick={() => setFilter({ ...filter, endpoint: '' })}><Icon name="x" size={11} /></button>
        </span>
      )}
      {!filterIsEmpty(filter) && (
        <button type="button" data-testid="f-clear" className="btn-ghost h-6 text-[11px] text-accent-fg" onClick={() => setFilter(EMPTY_FILTER)}>
          <Icon name="x" size={12} /> Clear filters
        </button>
      )}
    </div>
  );
}
