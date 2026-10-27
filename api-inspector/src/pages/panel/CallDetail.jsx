import { useEffect, useState } from 'react';
import { BodyView, CopyButton, HeadersTable, MethodTag, send, statusTone } from '../../ui/components.jsx';
import { Icon } from '../../ui/icons.jsx';
import { callSentence, displayPath, formatBytes, formatMs, shortFile, statusClass } from '../../shared/calls.js';

function openSource(url, line) {
  if (chrome.devtools?.panels?.openResource) chrome.devtools.panels.openResource(url, Math.max(0, (line || 1) - 1), () => {});
}

function SourceLink({ src }) {
  if (!src || !src.url) return <span className="text-fg-3">unknown</span>;
  const text = `${shortFile(src.url)}:${src.line}${src.col ? `:${src.col}` : ''}`;
  return (
    <button type="button" className="mono text-left text-accent-fg hover:underline" title={`${src.url}\nOpen in Sources`} onClick={() => openSource(src.url, src.line)}>
      {src.fn ? <span className="text-fg-2">{src.fn} </span> : null}{text}
    </button>
  );
}

function Row({ label, children, testId }) {
  return (
    <div className="contents">
      <dt className="pt-px text-fg-2">{label}</dt>
      <dd className="min-w-0 break-words" data-testid={testId}>{children}</dd>
    </div>
  );
}

function Section({ icon, title, children, right, tone = 'text-fg-2' }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line-2 bg-subtle px-3 py-1.5">
        <Icon name={icon} size={13} className={tone} />
        <h3 className="font-semibold">{title}</h3>
        <div className="ml-auto">{right}</div>
      </div>
      <div className="px-3 py-2">{children}</div>
    </section>
  );
}

function Grid({ children }) {
  return <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5">{children}</dl>;
}

function Initiator({ call, tabId }) {
  const c = call.click;
  const [hl, setHl] = useState(null);
  const highlight = async () => {
    const r = await send({ type: 'highlight', tabId, frameId: call.frameId, clickId: c.id, cssPath: c.cssPath });
    setHl(r?.found ? 'Shown on the page.' : 'This element is not on the page anymore.');
  };
  return (
    <div className="space-y-2.5 p-3">
      <Section
        icon="pointer"
        title="Button"
        tone="text-accent"
        right={c && <button type="button" className="btn h-6 px-2 text-[11px]" data-testid="btn-highlight" onClick={highlight}><Icon name="eye" size={12} /> Highlight</button>}
      >
        {c ? (
          <Grid>
            <Row label="Clicked" testId="init-text">{c.text || <i className="text-fg-3">(no text)</i>} <span className="mono text-fg-3">&lt;{c.tag}&gt;</span></Row>
            {Object.keys(c.attrs || {}).length > 0 && <Row label="Attributes"><span className="mono">{Object.entries(c.attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}</span></Row>}
            <Row label="CSS path" testId="init-css"><span className="mono">{c.cssPath}</span> <CopyButton text={c.cssPath} className="inline-grid align-middle" /></Row>
            <Row label="Clicked at">{new Date(c.time).toLocaleTimeString()} <span className="text-fg-3">({call.start - c.time} ms before the call)</span></Row>
            {hl && <Row label="">{hl}</Row>}
          </Grid>
        ) : (
          <div className="text-fg-2">No click just before this call. It came from page load, a timer or other code.</div>
        )}
      </Section>
      {c?.react && (
        <Section icon="atom" title="React components" tone="text-sky-500">
          <div className="mb-2 flex flex-wrap items-center gap-1" data-testid="init-react">
            {c.react.chain.map((n, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                {i > 0 && <Icon name="chevronRight" size={11} className="text-fg-3" />}
                <span className={`mono rounded px-1 py-px ${i === c.react.chain.length - 1 ? 'bg-sky-500/15 font-semibold text-sky-700 dark:text-sky-300' : 'text-fg-2'}`}>{n}</span>
              </span>
            ))}
          </div>
          {c.react.source && <Grid><Row label="JSX written at" testId="init-react-src"><SourceLink src={c.react.source} /></Row></Grid>}
          {c.react.minified && <div className="mt-1 flex items-center gap-1.5 text-amber-600"><Icon name="info" size={12} /> Names look scrambled (production build). Try the dev build.</div>}
        </Section>
      )}
      {c?.liquid && (
        <Section icon="droplet" title="Liquid theme" tone="text-emerald-500">
          <Grid>
            {c.liquid.section && <Row label="Section" testId="init-section"><span className="mono font-semibold">{c.liquid.section.name}</span> <span className="text-fg-3">id {c.liquid.section.id}</span></Row>}
            {c.liquid.block && (
              <Row label={c.liquid.block.appBlock ? 'App block' : 'Block'} testId="init-block">
                <span className="mono font-semibold">{c.liquid.block.id}</span>
                {c.liquid.block.handle && <span className="text-fg-3"> ({c.liquid.block.handle})</span>}
              </Row>
            )}
          </Grid>
        </Section>
      )}
      <Section icon="fileCode" title="Code that made the call" tone="text-violet-500">
        <Grid><Row label="File and line" testId="init-source"><SourceLink src={call.source} /></Row></Grid>
        {call.stack?.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-fg-2">Call stack ({call.stack.length})</summary>
            <ol className="mt-1 space-y-0.5 border-l border-line pl-3">
              {call.stack.map((f, i) => <li key={i}><SourceLink src={f} /></li>)}
            </ol>
          </details>
        )}
      </Section>
    </div>
  );
}

export default function CallDetail({ summary, tabId, pageHost, onClose, onEdit }) {
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
  const tone = statusTone(statusClass(call));
  const doReplay = async () => {
    setReplay({ busy: true, text: 'Sending…' });
    const r = await send({ type: 'replay', tabId, id: call.id });
    setReplay(r?.ok ? { ok: true, text: `Replayed: ${r.status} ${r.statusText || ''} (${r.time ?? '?'} ms)` } : { ok: false, text: `Failed: ${r?.error}` });
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-bg" data-testid="call-detail">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <MethodTag method={call.method} />
        <span className="mono min-w-0 flex-1 truncate font-medium" title={call.url}>{displayPath(call.url, pageHost)}</span>
        <span className={`pill bg-muted ${tone.text}`}><span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />{call.error ? 'failed' : call.status ?? '…'}</span>
        <button type="button" className="icon-btn h-6 w-6" title="Close" onClick={onClose}><Icon name="x" size={13} /></button>
      </div>
      <div className="flex gap-1 border-b border-line px-2">
        {['overview', 'initiator', 'request', 'response'].map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`detail-${t}`}
            className={`-mb-px border-b-2 px-2 py-1.5 font-medium capitalize ${tab === t ? 'border-accent text-fg' : 'border-transparent text-fg-2 hover:text-fg'}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'overview' && (
          <div className="space-y-2.5 p-3">
            <div className="flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2 text-accent-fg">
              <Icon name={call.click ? 'pointer' : 'activity'} size={14} className="mt-px" />
              <span className="mono" data-testid="call-sentence">{callSentence(call)}</span>
            </div>
            <Section icon="info" title="General">
              <Grid>
                <Row label="URL"><span className="mono break-all">{call.url}</span> <CopyButton text={call.url} className="inline-grid align-middle" /></Row>
                {call.originalUrl && call.originalUrl !== call.url && <Row label="Original URL"><span className="mono break-all">{call.originalUrl}</span></Row>}
                {call.finalUrl && call.finalUrl !== call.url && <Row label="Final URL"><span className="mono break-all">{call.finalUrl}</span></Row>}
                <Row label="Method">{call.method}</Row>
                <Row label="Status" testId="detail-status">
                  <span className={tone.text}>{call.status ?? '—'} {call.statusText}</span>{' '}
                  {call.mocked && <span className="chip bg-violet-500/15 text-violet-700 dark:text-violet-300">mocked</span>}{' '}
                  {call.edited && <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300">edited</span>}
                </Row>
                {call.error && <Row label="Error"><span className="text-rose-600 dark:text-rose-400">{call.error}</span></Row>}
                <Row label="Type">{call.type}{call.resourceType ? ` (${call.resourceType})` : ''}</Row>
                <Row label="Time">{formatMs(call.duration) || '—'} <span className="text-fg-3">· started {new Date(call.start).toLocaleTimeString()}</span></Row>
                <Row label="Size">{formatBytes(call.resBodySize) || '—'}</Row>
                <Row label="Frame">{call.frame?.top ? 'Top page' : 'iframe'} <span className="mono text-fg-3">{call.frame?.url}</span></Row>
              </Grid>
            </Section>
            <Section icon="zap" title="Rules" tone="text-accent">
              <div data-testid="detail-rules" className="flex flex-wrap gap-1">
                {call.rules?.length ? call.rules.map((r) => (
                  <span key={`${r.id}-${r.layer}`} className="chip bg-accent-soft text-accent-fg">{r.name} <span className="opacity-70">· {r.layer}</span></span>
                )) : <span className="text-fg-3">No rule changed this call</span>}
              </div>
              {call.ruleErrors?.length > 0 && (
                <ul className="mt-2 space-y-1 text-rose-600 dark:text-rose-400">
                  {call.ruleErrors.map((e, i) => <li key={i} className="flex gap-1.5"><Icon name="alert" size={12} className="mt-0.5" />{e}</li>)}
                </ul>
              )}
            </Section>
            <div className="flex flex-wrap items-center gap-1.5">
              {call.type !== 'nav' && call.type !== 'network' && (
                <button type="button" className="btn" data-testid="btn-replay" onClick={doReplay} disabled={replay?.busy}><Icon name="history" size={13} /> Replay</button>
              )}
              {call.type !== 'nav' && <button type="button" className="btn" data-testid="btn-edit-send" onClick={() => onEdit(call)}><Icon name="send" size={13} /> Edit &amp; send</button>}
              {replay && <span className={replay.ok === false ? 'text-rose-600' : 'text-fg-2'} data-testid="replay-result">{replay.text}</span>}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400"><Icon name="alert" size={12} /> On live stores, replayed calls are real.</div>
          </div>
        )}
        {tab === 'initiator' && <Initiator call={call} tabId={tabId} />}
        {tab === 'request' && (
          <div className="space-y-2.5 p-3">
            <Section icon="heading" title="Headers"><div className="-mx-3 -my-2"><HeadersTable headers={call.reqHeaders} /></div></Section>
            <Section icon="upload" title={`Body${call.reqBodySize ? ` · ${formatBytes(call.reqBodySize)}` : ''}`}>
              <div className="-mx-3 -my-2"><BodyView testId="req-body" text={call.reqBody} truncated={call.reqBodyTruncated} /></div>
            </Section>
          </div>
        )}
        {tab === 'response' && (
          <div className="space-y-2.5 p-3">
            <Section icon="heading" title="Headers"><div className="-mx-3 -my-2"><HeadersTable headers={call.resHeaders} /></div></Section>
            <Section icon="download" title={`Body${call.resBodySize ? ` · ${formatBytes(call.resBodySize)}` : ''}`}>
              <div className="-mx-3 -my-2"><BodyView testId="res-body" text={call.resBody} truncated={call.resBodyTruncated} empty={call.state === 'done' || call.state === 'error' ? 'No body' : 'Waiting…'} /></div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
