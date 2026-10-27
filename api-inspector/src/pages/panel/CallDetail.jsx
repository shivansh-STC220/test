import { useEffect, useState } from 'react';
import { BodyView, HeadersTable, send } from '../../ui/components.jsx';
import { callSentence, formatBytes, formatMs, shortFile } from '../../shared/calls.js';

function openSource(url, line) {
  if (chrome.devtools?.panels?.openResource) chrome.devtools.panels.openResource(url, Math.max(0, (line || 1) - 1), () => {});
}

function SourceLink({ src }) {
  if (!src || !src.url) return <span className="text-slate-400">unknown</span>;
  const text = `${shortFile(src.url)}:${src.line}${src.col ? `:${src.col}` : ''}`;
  return (
    <button type="button" className="mono text-left text-indigo-600 hover:underline dark:text-indigo-400" title={src.url} onClick={() => openSource(src.url, src.line)}>
      {src.fn ? `${src.fn} @ ` : ''}{text}
    </button>
  );
}

function Row({ label, children, testId }) {
  return (
    <div className="flex gap-2 py-0.5">
      <div className="label w-28 shrink-0 pt-px">{label}</div>
      <div className="min-w-0 flex-1 break-words" data-testid={testId}>{children}</div>
    </div>
  );
}

function Initiator({ call, tabId }) {
  const c = call.click;
  const [hl, setHl] = useState(null);
  const highlight = async () => {
    const r = await send({ type: 'highlight', tabId, frameId: call.frameId, clickId: c.id, cssPath: c.cssPath });
    setHl(r?.found ? 'Shown on the page.' : 'Element is not on the page anymore.');
  };
  return (
    <div className="space-y-2 p-2">
      <section>
        <h3 className="mb-1 font-semibold">Button</h3>
        {c ? (
          <>
            <Row label="Clicked" testId="init-text">{c.text || <i>(no text)</i>} <span className="text-slate-400">&lt;{c.tag}&gt;</span></Row>
            {Object.keys(c.attrs || {}).length > 0 && (
              <Row label="Attributes"><span className="mono">{Object.entries(c.attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}</span></Row>
            )}
            <Row label="CSS path" testId="init-css"><span className="mono">{c.cssPath}</span></Row>
            <Row label="Clicked at">{new Date(c.time).toLocaleTimeString()} ({call.start - c.time} ms before the call)</Row>
            <button type="button" className="btn mt-1" data-testid="btn-highlight" onClick={highlight}>Highlight on page</button>
            {hl && <span className="ml-2 text-slate-500">{hl}</span>}
          </>
        ) : (
          <div className="text-slate-400">No click just before this call (page load, timer or other code).</div>
        )}
      </section>
      {c?.react && (
        <section>
          <h3 className="mb-1 font-semibold">React components</h3>
          <Row label="Chain" testId="init-react"><span className="mono">{c.react.chain.join(' → ')}</span></Row>
          {c.react.source && <Row label="JSX written at" testId="init-react-src"><SourceLink src={c.react.source} /></Row>}
          {c.react.minified && <div className="text-amber-600">Names look scrambled (production build). Try the dev build.</div>}
        </section>
      )}
      {c?.liquid && (
        <section>
          <h3 className="mb-1 font-semibold">Liquid theme</h3>
          {c.liquid.section && <Row label="Section" testId="init-section"><span className="mono">{c.liquid.section.name}</span> <span className="text-slate-400">(id {c.liquid.section.id})</span></Row>}
          {c.liquid.block && (
            <Row label={c.liquid.block.appBlock ? 'App block' : 'Block'} testId="init-block">
              <span className="mono">{c.liquid.block.id}</span>
              {c.liquid.block.handle && <span className="text-slate-400"> ({c.liquid.block.handle})</span>}
            </Row>
          )}
        </section>
      )}
      <section>
        <h3 className="mb-1 font-semibold">Code that made the call</h3>
        <Row label="File and line" testId="init-source"><SourceLink src={call.source} /></Row>
        {call.stack?.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-slate-500">Call stack ({call.stack.length})</summary>
            <ol className="mt-1 space-y-0.5">
              {call.stack.map((f, i) => <li key={i}><SourceLink src={f} /></li>)}
            </ol>
          </details>
        )}
      </section>
    </div>
  );
}

export default function CallDetail({ summary, tabId, onClose, onEdit }) {
  const [call, setCall] = useState(null);
  const [tab, setTab] = useState('overview');
  const [replay, setReplay] = useState(null);

  // Load the full call (with bodies) again when it changes.
  useEffect(() => {
    let live = true;
    send({ type: 'get-call', tabId, id: summary.id }).then((c) => live && setCall(c || summary));
    return () => { live = false; };
  }, [summary, tabId]);

  if (!call) return null;
  const doReplay = async () => {
    setReplay('Sending…');
    const r = await send({ type: 'replay', tabId, id: call.id });
    setReplay(r?.ok ? `Replayed: ${r.status} ${r.statusText || ''} (${r.time ?? '?'} ms)` : `Failed: ${r?.error}`);
  };

  return (
    <div className="flex h-full min-w-0 flex-col border-l border-slate-200 dark:border-zinc-700" data-testid="call-detail">
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-zinc-700">
        <button type="button" className="px-2 text-slate-400 hover:text-slate-700" title="Close" onClick={onClose}>✕</button>
        {['overview', 'initiator', 'request', 'response'].map((t) => (
          <button key={t} type="button" data-testid={`detail-${t}`} className={`tab capitalize ${tab === t ? 'tab-on' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'overview' && (
          <div className="space-y-1 p-2">
            <div className="mono rounded bg-slate-50 p-1.5 dark:bg-zinc-800" data-testid="call-sentence">{callSentence(call)}</div>
            <Row label="URL"><span className="mono break-all">{call.url}</span></Row>
            {call.originalUrl && call.originalUrl !== call.url && <Row label="Original URL"><span className="mono break-all">{call.originalUrl}</span></Row>}
            {call.finalUrl && call.finalUrl !== call.url && <Row label="Final URL"><span className="mono break-all">{call.finalUrl}</span></Row>}
            <Row label="Method">{call.method}</Row>
            <Row label="Status" testId="detail-status">{call.status ?? '—'} {call.statusText} {call.mocked && <span className="chip bg-violet-100 text-violet-700">mocked</span>} {call.edited && <span className="chip bg-amber-100 text-amber-700">edited</span>}</Row>
            {call.error && <Row label="Error"><span className="text-rose-600">{call.error}</span></Row>}
            <Row label="Type">{call.type}{call.resourceType ? ` (${call.resourceType})` : ''}</Row>
            <Row label="Time">{formatMs(call.duration)} · started {new Date(call.start).toLocaleTimeString()}</Row>
            <Row label="Size">{formatBytes(call.resBodySize)}</Row>
            <Row label="Frame">{call.frame?.top ? 'Top page' : 'iframe'} <span className="mono text-slate-400">{call.frame?.url}</span></Row>
            <Row label="Rules" testId="detail-rules">
              {call.rules?.length ? call.rules.map((r) => (
                <span key={`${r.id}-${r.layer}`} className="chip mr-1 bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">{r.name} · {r.layer}</span>
              )) : <span className="text-slate-400">No rule changed this call</span>}
            </Row>
            {call.ruleErrors?.length > 0 && <Row label="Rule errors"><ul className="text-rose-600">{call.ruleErrors.map((e, i) => <li key={i}>{e}</li>)}</ul></Row>}
            <div className="flex flex-wrap gap-1 pt-2">
              {call.type !== 'nav' && call.type !== 'network' && <button type="button" className="btn" data-testid="btn-replay" onClick={doReplay}>Replay</button>}
              {call.type !== 'nav' && <button type="button" className="btn" data-testid="btn-edit-send" onClick={() => onEdit(call)}>Edit &amp; send</button>}
            </div>
            {replay && <div className="pt-1 text-slate-600 dark:text-zinc-300" data-testid="replay-result">{replay}</div>}
            <div className="pt-1 text-[11px] text-amber-600">On live stores, replayed calls are real.</div>
          </div>
        )}
        {tab === 'initiator' && <Initiator call={call} tabId={tabId} />}
        {tab === 'request' && (
          <div>
            <h3 className="px-2 pt-2 font-semibold">Headers</h3>
            <HeadersTable headers={call.reqHeaders} />
            <h3 className="px-2 pt-2 font-semibold">Body {call.reqBodySize ? `(${formatBytes(call.reqBodySize)})` : ''}</h3>
            <BodyView testId="req-body" text={call.reqBody} truncated={call.reqBodyTruncated} />
          </div>
        )}
        {tab === 'response' && (
          <div>
            <h3 className="px-2 pt-2 font-semibold">Headers</h3>
            <HeadersTable headers={call.resHeaders} />
            <h3 className="px-2 pt-2 font-semibold">Body {call.resBodySize ? `(${formatBytes(call.resBodySize)})` : ''}</h3>
            <BodyView testId="res-body" text={call.resBody} truncated={call.resBodyTruncated} empty={call.state === 'done' || call.state === 'error' ? 'No body' : 'Waiting…'} />
          </div>
        )}
      </div>
    </div>
  );
}
