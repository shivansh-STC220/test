import { EMPTY_FILTER, filterIsEmpty } from '../../shared/calls.js';

const METHOD_CHIPS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const STATUS_CHIPS = ['2xx', '3xx', '4xx', '5xx', 'failed', 'pending'];
const TYPE_CHIPS = ['fetch', 'xhr', 'beacon', 'network', 'replay', 'client'];

function Chip({ on, onClick, children, testId }) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={on}
      onClick={onClick}
      className={`rounded border px-1.5 py-px text-[11px] ${on ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800'}`}
    >
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 px-2 py-1 dark:border-zinc-700">
      <input
        data-testid="filter-text"
        className="input w-60"
        placeholder="Filter URL, button, component… or /regex/"
        value={filter.text}
        onChange={(e) => setFilter({ ...filter, text: e.target.value })}
      />
      <div className="flex items-center gap-1">
        {METHOD_CHIPS.map((m) => <Chip key={m} testId={`f-method-${m}`} on={filter.methods.includes(m)} onClick={() => toggle('methods', m)}>{m}</Chip>)}
      </div>
      <div className="flex items-center gap-1">
        {STATUS_CHIPS.map((s) => <Chip key={s} testId={`f-status-${s}`} on={filter.statuses.includes(s)} onClick={() => toggle('statuses', s)}>{s}</Chip>)}
      </div>
      <div className="flex items-center gap-1">
        {TYPE_CHIPS.map((t) => <Chip key={t} testId={`f-type-${t}`} on={filter.types.includes(t)} onClick={() => toggle('types', t)}>{t}</Chip>)}
      </div>
      <select data-testid="f-host" className="input" value={filter.hosts[0] || ''} onChange={(e) => setFilter({ ...filter, hosts: e.target.value ? [e.target.value] : [] })}>
        <option value="">All hosts</option>
        {hosts.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <select data-testid="f-frame" className="input" value={filter.frame} onChange={(e) => setFilter({ ...filter, frame: e.target.value })}>
        <option value="all">All frames</option>
        <option value="top">Top page only</option>
        <option value="iframe">iframes only</option>
      </select>
      <label className="inline-flex items-center gap-1">
        <input data-testid="f-rule" type="checkbox" checked={filter.ruleOnly} onChange={(e) => setFilter({ ...filter, ruleOnly: e.target.checked })} />
        Changed by a rule
      </label>
      {filter.endpoint && (
        <span className="chip bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
          API: {filter.endpoint}
          <button type="button" className="ml-1" onClick={() => setFilter({ ...filter, endpoint: '' })}>✕</button>
        </span>
      )}
      {!filterIsEmpty(filter) && (
        <button type="button" data-testid="f-clear" className="btn" onClick={() => setFilter(EMPTY_FILTER)}>Clear filters</button>
      )}
    </div>
  );
}
