// API client (C2): a small Postman-like tab.
import { useEffect, useRef, useState } from 'react';
import { METHODS } from '../../shared/rules.js';
import { BodyView, HeadersTable, headersToText, send, textToHeaders } from '../../ui/components.jsx';
import { formatBytes } from '../../shared/calls.js';

const EMPTY = { method: 'GET', url: '', headers: '', body: '', from: 'extension' };

const fromCall = (c) => ({ method: c.method || 'GET', url: c.url || '', headers: headersToText(c.reqHeaders), body: c.reqBody || '', from: 'page' });

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

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="flex items-center gap-1">
          <select data-testid="client-method" className="input" value={req.method} onChange={(e) => set({ method: e.target.value })}>
            {METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
          <input data-testid="client-url" className="input mono flex-1" placeholder="https://…" value={req.url} onChange={(e) => set({ url: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && go()} />
          <button type="button" data-testid="client-send" className="btn-primary" disabled={busy || !req.url} onClick={go}>{busy ? 'Sending…' : 'Send'}</button>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <span className="label">Send from</span>
          <label className="inline-flex items-center gap-1"><input type="radio" name="from" data-testid="client-from-extension" checked={req.from === 'extension'} onChange={() => set({ from: 'extension' })} /> Extension (no CORS limits)</label>
          <label className="inline-flex items-center gap-1"><input type="radio" name="from" data-testid="client-from-page" checked={req.from === 'page'} onChange={() => set({ from: 'page' })} /> Page (uses the page's cookies and CORS)</label>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="label">Headers (one per line, Name: value)</span>
            <textarea data-testid="client-headers" className="input mono h-28" value={req.headers} onChange={(e) => set({ headers: e.target.value })} placeholder={'Content-Type: application/json'} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Body</span>
            <textarea data-testid="client-body" className="input mono h-28" value={req.body} onChange={(e) => set({ body: e.target.value })} placeholder={'{"key": "value"}'} />
          </label>
        </div>
        <div className="mt-1 text-[11px] text-amber-600">On live stores, these calls are real.</div>
        {res && (
          <div className="mt-3 rounded border border-slate-200 dark:border-zinc-700" data-testid="client-response">
            {res.ok ? (
              <>
                <div className="flex gap-3 border-b border-slate-200 px-2 py-1 dark:border-zinc-700">
                  <span data-testid="client-status" className={res.status < 400 ? 'text-emerald-600' : 'text-rose-600'}>{res.status} {res.statusText}</span>
                  <span className="text-slate-500">{res.time} ms</span>
                  <span className="text-slate-500">{formatBytes(res.size)}</span>
                </div>
                <details>
                  <summary className="cursor-pointer px-2 py-1 text-slate-500">Response headers</summary>
                  <HeadersTable headers={res.headers} />
                </details>
                <BodyView testId="client-body-view" text={res.body} truncated={res.truncated} />
              </>
            ) : (
              <div className="p-2 text-rose-600" data-testid="client-error">{res.error}</div>
            )}
          </div>
        )}
      </div>
      <div className="w-56 shrink-0 overflow-auto border-l border-slate-200 p-2 dark:border-zinc-700">
        <div className="label mb-1">History</div>
        {history.map((h, i) => (
          <button key={i} type="button" className="block w-full truncate rounded px-1 py-0.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800" title={h.url} onClick={() => setReq({ ...EMPTY, ...h })}>
            <span className="mono font-semibold">{h.method}</span> <span className="mono">{h.url}</span>
          </button>
        ))}
        {!history.length && <div className="text-slate-400">Nothing sent yet.</div>}
      </div>
    </div>
  );
}
