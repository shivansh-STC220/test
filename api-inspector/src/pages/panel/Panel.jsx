// DevTools tab (D3): Calls, APIs, Search, API client.
import { useEffect, useMemo, useState } from 'react';
import { EMPTY_FILTER, filterCalls, hostOf } from '../../shared/calls.js';
import { download, send, Tabs, Toggle } from '../../ui/components.jsx';
import { usePanelData } from './usePanelData.js';
import FilterBar from './FilterBar.jsx';
import CallsView from './CallsView.jsx';
import ApisView from './ApisView.jsx';
import SearchView from './SearchView.jsx';
import ClientView from './ClientView.jsx';
import PausedList from './PausedList.jsx';

export default function Panel({ tabId }) {
  const { calls, paused, tabState, setTabState, connected } = usePanelData(tabId);
  const [view, setView] = useState('calls');
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [selectedId, setSelectedId] = useState(null);
  const [term, setTerm] = useState('');
  const [scan, setScan] = useState(null);
  const [preset, setPreset] = useState(null);
  const [tabUrl, setTabUrl] = useState('');
  const [note, setNote] = useState('');

  const list = useMemo(() => [...calls.values()].sort((a, b) => (a.start ?? 0) - (b.start ?? 0)), [calls]);
  const shown = useMemo(() => filterCalls(list, filter), [list, filter]);
  const hosts = useMemo(() => [...new Set(list.filter((c) => c.type !== 'nav').map((c) => hostOf(c.url)).filter(Boolean))].sort(), [list]);
  const pageHost = hostOf(tabUrl);

  useEffect(() => {
    if (!Number.isFinite(tabId)) return;
    send({ type: 'tab-state', tabId }).then((s) => s && setTabUrl(s.url || ''));
  }, [tabId, calls.size === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!Number.isFinite(tabId)) {
    return <div className="p-4">Open this page from DevTools, or from the extension popup (“Open in a tab”).</div>;
  }

  const setPreserve = async (v) => {
    setTabState({ ...tabState, preserve: v });
    await send({ type: 'set-preserve', tabId, value: v });
  };
  const setDebugger = async (on) => {
    setNote(on ? 'Turning on debugger mode…' : '');
    const r = await send({ type: 'debugger', tabId, on });
    setNote(r?.ok ? (r.on ? 'Debugger mode is on. Chrome shows a yellow bar while it is on.' : '') : `Debugger mode: ${r?.error}`);
  };
  const exportJson = async () => {
    const data = await send({ type: 'export', tabId });
    download(`api-calls-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, { exportedAt: new Date().toISOString(), page: tabUrl, calls: data });
  };

  const views = [
    { id: 'calls', label: 'Calls', badge: list.filter((c) => c.type !== 'nav').length },
    { id: 'apis', label: 'APIs' },
    { id: 'search', label: 'Search' },
    { id: 'client', label: 'API client' },
  ];

  return (
    <div className="flex h-full flex-col">
      <Tabs
        tabs={views}
        value={view}
        onChange={setView}
        right={(
          <>
            {!connected && <span className="text-amber-600">Connecting…</span>}
            <label className="inline-flex items-center gap-1" title="Keep calls when the page reloads or changes">
              <input data-testid="preserve-log" type="checkbox" checked={tabState.preserve} onChange={(e) => setPreserve(e.target.checked)} /> Preserve log
            </label>
            <button type="button" className="btn" data-testid="btn-clear" onClick={() => { setSelectedId(null); send({ type: 'clear', tabId }); }}>Clear</button>
            <button type="button" className="btn" data-testid="btn-export" onClick={exportJson}>Export JSON</button>
            <Toggle testId="debugger-toggle" small checked={tabState.debugger} onChange={setDebugger} label="Debugger mode" title="Catch everything at network level, even plain form posts" />
            <span className="text-slate-500" title="Rule hits on this tab">Rule hits: <b data-testid="hits">{tabState.hits}</b></span>
            <a className="text-indigo-600 hover:underline dark:text-indigo-400" href="rules.html" target="_blank" rel="noreferrer">Rules ↗</a>
          </>
        )}
      />
      {note && <div className="border-b border-slate-200 bg-amber-50 px-2 py-1 text-amber-800 dark:border-zinc-700 dark:bg-amber-500/10 dark:text-amber-300" data-testid="note">{note}</div>}
      <PausedList paused={paused} tabId={tabId} />
      {(view === 'calls' || view === 'apis') && <FilterBar filter={filter} setFilter={setFilter} hosts={hosts} />}
      {view === 'calls' && (
        <CallsView
          calls={shown}
          total={list.length}
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
