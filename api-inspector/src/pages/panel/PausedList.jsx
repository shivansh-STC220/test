// Pause & edit (B12): calls waiting for Send or Drop.
import { useState } from 'react';
import { METHODS } from '../../shared/rules.js';
import { headersToText, send, textToHeaders } from '../../ui/components.jsx';

function PausedCard({ p, tabId }) {
  const [method, setMethod] = useState(p.request.method);
  const [url, setUrl] = useState(p.request.url);
  const [headers, setHeaders] = useState(headersToText(p.request.headers));
  const [body, setBody] = useState(p.request.body ?? '');
  const [busy, setBusy] = useState(false);

  const decide = async (action) => {
    setBusy(true);
    const request = { method, url, headers: textToHeaders(headers), body };
    // Keep headers exactly as they were if you did not touch them.
    if (headers === headersToText(p.request.headers)) request.headers = p.request.headers;
    await send({ type: 'pause-decision', tabId, id: p.id, action, request });
  };

  return (
    <div className="rounded border border-amber-300 bg-amber-50/60 p-2 dark:border-amber-500/40 dark:bg-amber-500/10" data-testid="paused-card">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-semibold">Paused</span>
        <span className="text-slate-500">by rule “{p.ruleName}”{p.source === 'debugger' ? ' (debugger mode)' : ''}</span>
      </div>
      <div className="flex items-center gap-1">
        <select data-testid="paused-method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
          {[...new Set([method, ...METHODS])].map((m) => <option key={m}>{m}</option>)}
        </select>
        <input data-testid="paused-url" className="input mono flex-1" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="label">Headers</span>
          <textarea data-testid="paused-headers" className="input mono h-24" value={headers} onChange={(e) => setHeaders(e.target.value)} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="label">Body</span>
          <textarea data-testid="paused-body" className="input mono h-24" value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
      </div>
      <div className="mt-1 flex gap-1">
        <button type="button" data-testid="paused-send" className="btn-primary" disabled={busy} onClick={() => decide('send')}>Send</button>
        <button type="button" data-testid="paused-drop" className="btn-danger" disabled={busy} onClick={() => decide('drop')}>Drop</button>
      </div>
    </div>
  );
}

export default function PausedList({ paused, tabId }) {
  if (!paused.length) return null;
  return (
    <div className="max-h-[50vh] space-y-2 overflow-auto border-b border-slate-200 p-2 dark:border-zinc-700" data-testid="paused-list">
      {paused.map((p) => <PausedCard key={p.key} p={p} tabId={tabId} />)}
    </div>
  );
}
