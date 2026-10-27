// Small building blocks shared by the screens.
import { useEffect, useMemo, useState } from 'react';
import { Icon } from './icons.jsx';

// Light or dark: inside DevTools follow the DevTools theme, elsewhere follow Chrome / the OS.
export function applyTheme() {
  const panels = typeof chrome !== 'undefined' ? chrome.devtools?.panels : null;
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const set = () => {
    const dark = panels ? panels.themeName === 'dark' : !!media?.matches;
    document.documentElement.classList.toggle('dark', dark);
  };
  set();
  if (!panels) media?.addEventListener?.('change', set);
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

export function Toggle({ checked, onChange, label, title, testId, small, disabled }) {
  return (
    <label className={`inline-flex select-none items-center gap-2 ${disabled ? 'opacity-50' : 'cursor-pointer'}`} title={title}>
      <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        aria-label={label || title}
        data-testid={testId}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
        className={`relative inline-flex shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${small ? 'h-4 w-7' : 'h-5 w-9'} ${checked ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-600'}`}
      >
        <span
          className={`absolute top-0.5 rounded-full bg-white shadow-sm transition-transform ${small ? 'h-3 w-3' : 'h-4 w-4'} ${checked ? (small ? 'translate-x-3.5' : 'translate-x-4.5') : 'translate-x-0.5'}`}
        />
      </button>
      {label && <span>{label}</span>}
    </label>
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

const JSON_TOKEN = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

// Colors for JSON (only for bodies that are not huge, to stay fast).
function highlight(pretty) {
  if (pretty.length > 200000) return pretty;
  const out = [];
  let last = 0;
  let i = 0;
  for (const m of pretty.matchAll(JSON_TOKEN)) {
    if (m.index > last) out.push(pretty.slice(last, m.index));
    const tok = m[0];
    const cls = tok.startsWith('"') ? (m[2] ? 'j-key' : 'j-str') : tok === 'null' ? 'j-null' : tok === 'true' || tok === 'false' ? 'j-bool' : 'j-num';
    out.push(<span key={i++} className={cls}>{tok}</span>);
    last = m.index + tok.length;
  }
  out.push(pretty.slice(last));
  return out;
}

export function CopyButton({ text, label, className = '' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={label ? `btn-ghost h-6 px-1.5 text-[11px] ${className}` : `icon-btn h-6 w-6 ${className}`}
      title="Copy"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(String(text ?? '')).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={13} className={done ? 'text-emerald-500' : ''} />
      {label && (done ? 'Copied' : label)}
    </button>
  );
}

export function BodyView({ text, truncated, empty = 'No body', testId }) {
  const pretty = useMemo(() => prettyBody(text), [text]);
  const isJson = pretty !== String(text ?? '') || /^\s*[[{]/.test(String(text ?? ''));
  const content = useMemo(() => (isJson ? highlight(pretty) : pretty), [pretty, isJson]);
  if (text == null || text === '') return <div className="px-3 py-2 text-fg-3">{empty}</div>;
  return (
    <div className="relative">
      {truncated && (
        <div className="mx-3 mb-1 flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-300">
          <Icon name="info" size={13} /> Body was cut at 1 MB.
        </div>
      )}
      <div className="absolute right-2 top-1"><CopyButton text={text} /></div>
      <pre data-testid={testId} className="mono max-h-[60vh] overflow-auto whitespace-pre-wrap break-all px-3 py-2 pr-9 leading-relaxed">{content}</pre>
    </div>
  );
}

export function HeadersTable({ headers }) {
  const list = Object.entries(headers || {});
  if (!list.length) return <div className="px-3 py-2 text-fg-3">No headers</div>;
  return (
    <dl className="grid grid-cols-[minmax(110px,32%)_1fr] gap-x-3 gap-y-1 px-3 py-1.5">
      {list.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="mono truncate text-fg-2" title={k}>{k}</dt>
          <dd className="mono break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// Editable list of { name, value } (and an optional op). keyField can be "key" for query params.
export function KeyValueEditor({ rows, onChange, ops, keyField = 'name', namePlaceholder = 'Name', valuePlaceholder = 'Value', testId }) {
  const list = rows || [];
  const set = (i, patch) => onChange(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-1.5" data-testid={testId}>
      {list.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5" data-testid={testId && `${testId}-row`}>
          {ops && (
            <select className="input w-28" value={r.op || ops[0].value} onChange={(e) => set(i, { op: e.target.value })}>
              {ops.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          <input className="input mono w-40" placeholder={namePlaceholder} value={r[keyField] ?? ''} onChange={(e) => set(i, { [keyField]: e.target.value })} />
          {r.op !== 'remove' && (
            <input className="input mono min-w-0 flex-1" placeholder={valuePlaceholder} value={r.value ?? ''} onChange={(e) => set(i, { value: e.target.value })} />
          )}
          <button type="button" className="icon-btn" title="Remove" onClick={() => onChange(list.filter((_, j) => j !== i))}><Icon name="trash" size={13} /></button>
        </div>
      ))}
      <button type="button" className="btn-ghost -ml-1 text-accent-fg" data-testid={testId && `${testId}-add`} onClick={() => onChange([...list, { ...(ops ? { op: ops[0].value } : {}), [keyField]: '', value: '' }])}>
        <Icon name="plus" size={13} /> Add
      </button>
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

const METHOD_TONES = {
  GET: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  POST: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  PUT: 'bg-sky-500/12 text-sky-700 dark:text-sky-300',
  PATCH: 'bg-violet-500/12 text-violet-700 dark:text-violet-300',
  DELETE: 'bg-rose-500/12 text-rose-700 dark:text-rose-300',
};

export function MethodTag({ method, className = '' }) {
  return (
    <span className={`mono inline-flex h-[18px] min-w-[38px] items-center justify-center rounded px-1 text-[10px] font-semibold tracking-wide ${METHOD_TONES[method] || 'bg-zinc-500/12 text-fg-2'} ${className}`}>
      {method === 'DELETE' ? 'DEL' : method}
    </span>
  );
}

export const STATUS_TONES = {
  '2xx': { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', bar: 'bg-emerald-500/60' },
  '3xx': { dot: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-300', bar: 'bg-sky-500/60' },
  '4xx': { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', bar: 'bg-amber-500/60' },
  '5xx': { dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300', bar: 'bg-rose-500/60' },
  failed: { dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300', bar: 'bg-rose-500/60' },
  pending: { dot: 'bg-zinc-400 pulse', text: 'text-fg-3', bar: 'bg-zinc-400/50' },
  '': { dot: 'bg-zinc-300 dark:bg-zinc-600', text: 'text-fg-3', bar: 'bg-zinc-400/40' },
};

export function statusTone(cls) {
  return STATUS_TONES[cls] || STATUS_TONES[''];
}

export function EmptyState({ icon = 'activity', title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent-fg">
        <Icon name={icon} size={20} />
      </div>
      <div className="text-[13px] font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-sm text-fg-2">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function SiteChip({ host, className = '' }) {
  if (!host) return null;
  return (
    <span className={`pill max-w-[220px] bg-muted text-fg-2 ${className}`} title={`Website: ${host}`} data-testid="site-chip">
      <Icon name="globe" size={12} />
      <span className="mono truncate">{host}</span>
    </span>
  );
}

export function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}
