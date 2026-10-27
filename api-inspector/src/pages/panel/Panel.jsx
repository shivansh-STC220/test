// DevTools tab (D3): Calls, APIs, Search, API client.
import { useEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_FILTER, filterCalls, groupEndpoints, hostOf } from '../../shared/calls.js';
import { download, hostnameOf, send, SiteChip, Toggle } from '../../ui/components.jsx';
import { Icon, Logo } from '../../ui/icons.jsx';
import { usePanelData } from './usePanelData.js';
import FilterBar from './FilterBar.jsx';
import CallsView from './CallsView.jsx';
import ApisView from './ApisView.jsx';
import SearchView from './SearchView.jsx';
import ClientView from './ClientView.jsx';
import PausedList from './PausedList.jsx';

function ViewTab({ id, icon, label, badge, active, onClick }) {
  return (
    <button
      type="button"
      data-testid={`tab-${id}`}
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 font-medium transition-colors ${active ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-fg-2 hover:text-fg'}`}
    >
      <Icon name={icon} size={13} className={active ? 'text-accent' : ''} />
      {label}
      {badge != null && <span className={`rounded px-1 text-[10px] tabular-nums ${active ? 'bg-accent-soft text-accent-fg' : 'bg-muted text-fg-2'}`}>{badge}</span>}
    </button>
  );
}

export default function Panel({ tabId }) {
  const { calls, paused, tabState, setTabState, connected, pageUrl } = usePanelData(tabId);
  const [view, setView] = useState('calls');
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [selectedId, setSelectedId] = useState(null);
  const [term, setTerm] = useState('');
  const [scan, setScan] = useState(null);
  const [preset, setPreset] = useState(null);
  const [note, setNote] = useState(null);

  const list = useMemo(() => [...calls.values()].sort((a, b) => (a.start ?? 0) - (b.start ?? 0)), [calls]);
  const shown = useMemo(() => filterCalls(list, filter), [list, filter]);
  const hosts = useMemo(() => [...new Set(list.filter((c) => c.type !== 'nav').map((c) => hostOf(c.url)).filter(Boolean))].sort(), [list]);
  const apiCount = useMemo(() => groupEndpoints(list).length, [list]);
  const pageHost = hostOf(pageUrl);
  const site = hostnameOf(pageUrl);

  // A new website in this tab: forget what belonged to the old one
  // (scan results, search text, filters, selection), so nothing gets mixed.
  const lastSite = useRef('');
  useEffect(() => {
    if (!site) return;
    if (lastSite.current && lastSite.current !== site) {
      setScan(null);
      setTerm('');
      setFilter(EMPTY_FILTER);
      setSelectedId(null);
    }
    lastSite.current = site;
  }, [site]);

  if (!Number.isFinite(tabId)) {
    return <div className="p-6 text-fg-2">Open this page from DevTools, or from the extension popup (“Open inspector in a tab”).</div>;
  }

  const setPreserve = async (v) => {
    setTabState({ ...tabState, preserve: v });
    await send({ type: 'set-preserve', tabId, value: v });
  };
  const setDebugger = async (on) => {
    setNote(on ? { kind: 'info', text: 'Turning on debugger mode…' } : null);
    const r = await send({ type: 'debugger', tabId, on });
    if (!r?.ok) setNote({ kind: 'error', text: `Debugger mode: ${r?.error}` });
    else setNote(r.on ? { kind: 'info', text: 'Debugger mode is on. Chrome shows a yellow bar while it is on.' } : null);
  };
  const exportJson = async () => {
    const data = await send({ type: 'export', tabId });
    download(`api-calls-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, { exportedAt: new Date().toISOString(), page: pageUrl, calls: data });
  };

  const callCount = list.filter((c) => c.type !== 'nav').length;

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-subtle px-2 py-1">
        <div className="flex items-center gap-1.5 pr-1">
          <Logo size={18} />
          <span className="hidden font-semibold lg:inline">API Inspector</span>
        </div>
        <nav className="flex items-center gap-0.5 rounded-lg bg-muted/70 p-0.5">
          <ViewTab id="calls" icon="activity" label="Calls" badge={callCount} active={view === 'calls'} onClick={() => setView('calls')} />
          <ViewTab id="apis" icon="chart" label="APIs" badge={apiCount} active={view === 'apis'} onClick={() => setView('apis')} />
          <ViewTab id="search" icon="search" label="Search" active={view === 'search'} onClick={() => setView('search')} />
          <ViewTab id="client" icon="terminal" label="API client" active={view === 'client'} onClick={() => setView('client')} />
        </nav>
        <SiteChip host={pageHost} />
        {!connected && <span className="pill bg-amber-500/15 text-amber-700 dark:text-amber-300"><span className="h-1.5 w-1.5 rounded-full bg-amber-500 pulse" />Connecting</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <label className="btn-ghost cursor-pointer" title="Keep calls when the page reloads or changes">
            <input data-testid="preserve-log" type="checkbox" className="accent-[var(--accent)]" checked={tabState.preserve} onChange={(e) => setPreserve(e.target.checked)} />
            Preserve log
          </label>
          <span className="divider" />
          <span className="pill bg-accent-soft text-accent-fg" title="How many times a rule changed a call on this tab">
            <Icon name="zap" size={12} /> <b data-testid="hits" className="tabular-nums">{tabState.hits}</b> rule hits
          </span>
          <div className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 ${tabState.debugger ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : ''}`}>
            <Icon name="bug" size={13} className={tabState.debugger ? '' : 'text-fg-3'} />
            <Toggle testId="debugger-toggle" small checked={tabState.debugger} onChange={setDebugger} label="Debugger" title="Debugger mode: catch everything at network level, even plain form posts" />
          </div>
          <span className="divider" />
          <button type="button" className="icon-btn" data-testid="btn-clear" title="Clear" onClick={() => { setSelectedId(null); send({ type: 'clear', tabId }); }}><Icon name="trash" /></button>
          <button type="button" className="icon-btn" data-testid="btn-export" title="Export JSON" onClick={exportJson}><Icon name="download" /></button>
          <a className="icon-btn" href={`rules.html${site ? `?site=${encodeURIComponent(site)}` : ''}`} target="_blank" rel="noreferrer" title="Rules page"><Icon name="external" /></a>
        </div>
      </header>
      {note && (
        <div
          data-testid="note"
          className={`flex items-center gap-2 border-b border-line px-3 py-1.5 ${note.kind === 'error' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'bg-amber-500/10 text-amber-800 dark:text-amber-200'}`}
        >
          <Icon name={note.kind === 'error' ? 'alert' : 'bug'} size={13} />
          {note.text}
          <button type="button" className="icon-btn ml-auto h-5 w-5" title="Hide" onClick={() => setNote(null)}><Icon name="x" size={12} /></button>
        </div>
      )}
      <PausedList paused={paused} tabId={tabId} />
      {(view === 'calls' || view === 'apis') && <FilterBar filter={filter} setFilter={setFilter} hosts={hosts} />}
      {view === 'calls' && (
        <CallsView
          calls={shown}
          total={callCount}
          pageHost={pageHost}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          tabId={tabId}
          onEdit={(c) => { setPreset({ ...c, t: Date.now() }); setView('client'); }}
        />
      )}
      {view === 'apis' && (
        <ApisView
          calls={list}
          filter={filter}
          scan={scan}
          onScan={() => setView('search')}
          onOpenEndpoint={(key) => { setFilter({ ...EMPTY_FILTER, endpoint: key }); setView('calls'); }}
          onOpenSource={(path) => { setTerm(path); setView('search'); }}
        />
      )}
      {view === 'search' && (
        <SearchView
          calls={list}
          tabId={tabId}
          term={term}
          setTerm={setTerm}
          scan={scan}
          setScan={setScan}
          onOpenCall={(id) => { setSelectedId(id); setFilter(EMPTY_FILTER); setView('calls'); }}
        />
      )}
      {view === 'client' && <ClientView tabId={tabId} preset={preset} />}
    </div>
  );
}
