// API client (C2): a small Postman-like tab.
import { useEffect, useRef, useState } from 'react';
import { METHODS } from '../../shared/rules.js';
import { BodyView, HeadersTable, headersToText, MethodTag, send, textToHeaders } from '../../ui/components.jsx';
import { Icon } from '../../ui/icons.jsx';
import { formatBytes } from '../../shared/calls.js';

const EMPTY = { method: 'GET', url: '', headers: '', body: '', from: 'extension' };

const fromCall = (c) => ({ method: c.method || 'GET', url: c.url || '', headers: headersToText(c.reqHeaders), body: c.reqBody || '', from: 'page' });

function FromOption({ value, current, onChange, title, hint, testId }) {
  const on = current === value;
  return (
    <label className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5 ${on ? 'border-accent/50 bg-accent-soft' : 'border-line hover:bg-subtle'}`}>
      <input type="radio" name="from" data-testid={testId} className="mt-0.5 accent-[var(--accent)]" checked={on} onChange={() => onChange(value)} />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-[11px] text-fg-2">{hint}</span>
      </span>
    </label>
  );
}

export default function ClientView({ tabId, preset }) {
  // Fill the form on the first draw, so "Edit & send" never shows an empty form first.
  const [req, setReq] = useState(() => (preset ? fromCall(preset) : EMPTY));
  const shownPreset = useRef(preset);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    chrome.storage.local.get('clientHistory').then((d) => setHistory(d.clientHistory || []));
  }, []);

  useEffect(() => {
    if (preset && preset !== shownPreset.current) {
      shownPreset.current = preset;
      setReq(fromCall(preset));
      setRes(null);
    }
  }, [preset]);

  const go = async () => {
    if (!req.url) return;
    setBusy(true);
    setRes(null);
    const request = { method: req.method, url: req.url, headers: textToHeaders(req.headers), body: req.body };
    const r = await send({ type: 'client-send', tabId, from: req.from, request }).catch((e) => ({ ok: false, error: e.message }));
    setRes(r);
    setBusy(false);
    const next = [{ ...req, time: Date.now() }, ...history.filter((h) => !(h.method === req.method && h.url === req.url))].slice(0, 30);
    setHistory(next);
    chrome.storage.local.set({ clientHistory: next });
  };

  const set = (patch) => setReq({ ...req, ...patch });
  const ok = res?.ok && res.status < 400;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        <div className="flex items-center gap-0 overflow-hidden rounded-lg border border-line bg-surface shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
          <select data-testid="client-method" className="h-9 border-0 border-r border-line bg-subtle px-2 font-semibold outline-none" value={req.method} onChange={(e) => set({ method: e.target.value })}>
            {METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
          <input data-testid="client-url" className="mono h-9 min-w-0 flex-1 bg-transparent px-3 text-[12.5px] outline-none placeholder:text-fg-3" placeholder="https://…" value={req.url} onChange={(e) => set({ url: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && go()} />
          <button type="button" data-testid="client-send" className="btn-primary m-1 h-7" disabled={busy || !req.url} onClick={go}>
            <Icon name="send" size={13} /> {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FromOption testId="client-from-extension" value="extension" current={req.from} onChange={(v) => set({ from: v })} title="Send from the extension" hint="No CORS limits. Cookies of the site are sent." />
          <FromOption testId="client-from-page" value="page" current={req.from} onChange={(v) => set({ from: v })} title="Send from the page" hint="Same as the page's own fetch: its cookies and CORS." />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="label">Headers <span className="text-fg-3">(one per line, Name: value)</span></span>
            <textarea data-testid="client-headers" className="input mono h-28" value={req.headers} onChange={(e) => set({ headers: e.target.value })} placeholder={'Content-Type: application/json'} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Body</span>
            <textarea data-testid="client-body" className="input mono h-28" value={req.body} onChange={(e) => set({ body: e.target.value })} placeholder={'{"key": "value"}'} />
          </label>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400"><Icon name="alert" size={12} /> On live stores, these calls are real.</div>
        {res && (
          <section className="card pop overflow-hidden" data-testid="client-response">
            {res.ok ? (
              <>
                <div className="flex items-center gap-3 border-b border-line-2 bg-subtle px-3 py-1.5">
                  <span className="font-semibold">Response</span>
                  <span data-testid="client-status" className={`pill ${ok ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/12 text-rose-700 dark:text-rose-300'}`}>{res.status} {res.statusText}</span>
                  <span className="text-fg-2 tabular-nums">{res.time} ms</span>
                  <span className="text-fg-2 tabular-nums">{formatBytes(res.size)}</span>
                </div>
                <details className="border-b border-line-2">
                  <summary className="cursor-pointer px-3 py-1.5 text-fg-2">Response headers</summary>
                  <HeadersTable headers={res.headers} />
                </details>
                <div className="py-1"><BodyView testId="client-body-view" text={res.body} truncated={res.truncated} /></div>
              </>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 text-rose-600 dark:text-rose-400" data-testid="client-error"><Icon name="alert" size={13} />{res.error}</div>
            )}
          </section>
        )}
      </div>
      <aside className="w-60 shrink-0 overflow-auto border-l border-line bg-subtle p-2">
        <div className="eyebrow mb-1.5 flex items-center gap-1.5 px-1"><Icon name="history" size={12} /> History</div>
        {history.map((h, i) => (
          <button key={i} type="button" className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-muted" title={h.url} onClick={() => setReq({ ...EMPTY, ...h })}>
            <MethodTag method={h.method} />
            <span className="mono truncate text-fg-2">{h.url.replace(/^https?:\/\//, '')}</span>
          </button>
        ))}
        {!history.length && <div className="px-1 text-fg-3">Nothing sent yet.</div>}
      </aside>
    </div>
  );
}
