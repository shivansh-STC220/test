// Pause & edit (B12): calls waiting for Send or Drop.
import { useState } from 'react';
import { METHODS } from '../../shared/rules.js';
import { headersToText, send, textToHeaders } from '../../ui/components.jsx';
import { Icon } from '../../ui/icons.jsx';

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
    <div className="pop overflow-hidden rounded-lg border border-amber-400/60 bg-surface shadow-sm" data-testid="paused-card">
      <div className="flex items-center gap-2 bg-amber-500/12 px-3 py-1.5 text-amber-800 dark:text-amber-200">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-amber-500 text-white"><Icon name="pause" size={11} strokeWidth={2.6} /></span>
        <span className="font-semibold">Call paused</span>
        <span className="text-[11px] opacity-80">by rule “{p.ruleName}”{p.source === 'debugger' ? ' (debugger mode)' : ''}. Edit it, then Send or Drop.</span>
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-1.5">
          <select data-testid="paused-method" className="input w-24 font-semibold" value={method} onChange={(e) => setMethod(e.target.value)}>
            {[...new Set([method, ...METHODS])].map((m) => <option key={m}>{m}</option>)}
          </select>
          <input data-testid="paused-url" className="input mono min-w-0 flex-1" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="label">Headers</span>
            <textarea data-testid="paused-headers" className="input mono h-24" value={headers} onChange={(e) => setHeaders(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Body</span>
            <textarea data-testid="paused-body" className="input mono h-24" value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
        </div>
        <div className="flex gap-1.5">
          <button type="button" data-testid="paused-send" className="btn-primary" disabled={busy} onClick={() => decide('send')}><Icon name="play" size={12} /> Send</button>
          <button type="button" data-testid="paused-drop" className="btn-danger" disabled={busy} onClick={() => decide('drop')}><Icon name="ban" size={12} /> Drop</button>
        </div>
      </div>
    </div>
  );
}

export default function PausedList({ paused, tabId }) {
  if (!paused.length) return null;
  return (
    <div className="max-h-[55vh] space-y-2 overflow-auto border-b border-line bg-subtle p-2" data-testid="paused-list">
      {paused.map((p) => <PausedCard key={p.key} p={p} tabId={tabId} />)}
    </div>
  );
}
