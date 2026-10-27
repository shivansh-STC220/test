// Small building blocks shared by the screens.
import { useEffect, useMemo, useState } from 'react';

export function applyTheme() {
  const devtoolsDark = typeof chrome !== 'undefined' && chrome.devtools?.panels?.themeName === 'dark';
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const set = () => document.documentElement.classList.toggle('dark', devtoolsDark || !!media?.matches);
  set();
  media?.addEventListener?.('change', set);
}

export function queryParam(name) {
  return new URLSearchParams(location.search).get(name);
}

export function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

// Read keys from chrome.storage.local and stay up to date.
export function useStorage(keys, defaults = {}) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    chrome.storage.local.get(keys).then((d) => live && setData({ ...defaults, ...d }));
    const onChange = (changes, area) => {
      if (area !== 'local') return;
      const upd = {};
      for (const k of keys) if (changes[k]) upd[k] = changes[k].newValue;
      if (Object.keys(upd).length) setData((d) => ({ ...(d || defaults), ...upd }));
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      live = false;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return data;
}

export function Toggle({ checked, onChange, label, title, testId, small }) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-1.5" title={title}>
      <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        aria-label={label || title}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex shrink-0 rounded-full transition-colors ${small ? 'h-3.5 w-6' : 'h-4 w-7'} ${checked ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-zinc-600'}`}
      >
        <span
          className={`absolute top-0.5 rounded-full bg-white shadow transition-transform ${small ? 'h-2.5 w-2.5' : 'h-3 w-3'} ${checked ? (small ? 'translate-x-3' : 'translate-x-3.5') : 'translate-x-0.5'}`}
        />
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}

export function Tabs({ tabs, value, onChange, right }) {
  return (
    <div className="flex items-center border-b border-slate-200 dark:border-zinc-700">
      {tabs.map((t) => (
        <button key={t.id} type="button" data-testid={`tab-${t.id}`} className={`tab ${value === t.id ? 'tab-on' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
          {t.badge != null && <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] dark:bg-zinc-700">{t.badge}</span>}
        </button>
      ))}
      <div className="ml-auto flex items-center gap-2 pr-2">{right}</div>
    </div>
  );
}

export function prettyBody(text) {
  if (text == null) return '';
  const t = String(text);
  const s = t.trim();
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch {}
  }
  return t;
}

export function BodyView({ text, truncated, empty = 'No body', testId }) {
  const pretty = useMemo(() => prettyBody(text), [text]);
  if (text == null || text === '') return <div className="p-2 italic text-slate-400">{empty}</div>;
  return (
    <div>
      {truncated && <div className="bg-amber-50 px-2 py-1 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Body was cut at 1 MB.</div>}
      <pre data-testid={testId} className="mono max-h-[60vh] overflow-auto whitespace-pre-wrap break-all p-2 text-[11px]">{pretty}</pre>
    </div>
  );
}

export function HeadersTable({ headers }) {
  const list = Object.entries(headers || {});
  if (!list.length) return <div className="p-2 italic text-slate-400">No headers</div>;
  return (
    <table className="w-full text-[11px]">
      <tbody>
        {list.map(([k, v]) => (
          <tr key={k} className="align-top">
            <td className="mono w-1/3 py-0.5 pl-2 pr-2 font-medium text-slate-500 dark:text-zinc-400">{k}</td>
            <td className="mono break-all py-0.5 pr-2">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Editable list of { name, value } (and an optional op). keyField can be "key" for query params.
export function KeyValueEditor({ rows, onChange, ops, keyField = 'name', namePlaceholder = 'Name', valuePlaceholder = 'Value', testId }) {
  const list = rows || [];
  const set = (i, patch) => onChange(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-1" data-testid={testId}>
      {list.map((r, i) => (
        <div key={i} className="flex items-center gap-1" data-testid={testId && `${testId}-row`}>
          {ops && (
            <select className="input" value={r.op || ops[0].value} onChange={(e) => set(i, { op: e.target.value })}>
              {ops.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          <input className="input mono w-40" placeholder={namePlaceholder} value={r[keyField] ?? ''} onChange={(e) => set(i, { [keyField]: e.target.value })} />
          {r.op !== 'remove' && (
            <input className="input mono flex-1" placeholder={valuePlaceholder} value={r.value ?? ''} onChange={(e) => set(i, { value: e.target.value })} />
          )}
          <button type="button" className="btn" title="Remove" onClick={() => onChange(list.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="btn" data-testid={testId && `${testId}-add`} onClick={() => onChange([...list, { ...(ops ? { op: ops[0].value } : {}), [keyField]: '', value: '' }])}>+ Add</button>
    </div>
  );
}

export function headersToText(h) {
  return Object.entries(h || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
}

export function textToHeaders(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export function download(name, data) {
  const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export const METHOD_COLORS = {
  GET: 'text-emerald-600 dark:text-emerald-400',
  POST: 'text-amber-600 dark:text-amber-400',
  PUT: 'text-sky-600 dark:text-sky-400',
  PATCH: 'text-violet-600 dark:text-violet-400',
  DELETE: 'text-rose-600 dark:text-rose-400',
};

export function statusColor(cls) {
  return {
    '2xx': 'text-emerald-600 dark:text-emerald-400',
    '3xx': 'text-sky-600 dark:text-sky-400',
    '4xx': 'text-amber-600 dark:text-amber-400',
    '5xx': 'text-rose-600 dark:text-rose-400',
    failed: 'text-rose-600 dark:text-rose-400',
    pending: 'text-slate-400',
  }[cls] || '';
}
