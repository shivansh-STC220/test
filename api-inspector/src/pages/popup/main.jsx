// Popup (D1): quick on / off for rules and groups. The badge shows rule hits on this tab.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/styles.css';
import { applyTheme, queryParam, send, Toggle, useStorage } from '../../ui/components.jsx';
import { RULE_TYPES, isRuleActive, siteMatches } from '../../shared/rules.js';

function Popup() {
  const [tab, setTab] = useState(null);
  const [st, setSt] = useState({ hits: 0, debugger: false });
  const [note, setNote] = useState('');
  const data = useStorage(['rules', 'groups', 'settings'], { rules: [], groups: [], settings: { enabled: true } });

  useEffect(() => {
    const id = queryParam('tabId'); // used when the popup is opened as a page (tests)
    const get = id ? chrome.tabs.get(Number(id)) : chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t);
    get.then(setTab);
  }, []);

  useEffect(() => {
    if (!tab) return undefined;
    const load = () => send({ type: 'tab-state', tabId: tab.id }).then((s) => s && setSt(s));
    load();
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [tab]);

  if (!data || !tab) return <div className="p-3">Loading…</div>;
  const { rules, groups, settings } = data;
  let host = '';
  try { host = new URL(tab.url).hostname; } catch {}
  const enabled = settings.enabled !== false;
  const siteRules = rules.filter((r) => r.match?.site && siteMatches(r.match.site, host));
  const globalCount = rules.filter((r) => !r.match?.site).length;

  const setEnabled = (v) => chrome.storage.local.set({ settings: { ...settings, enabled: v } });
  const setGroup = (id, v) => chrome.storage.local.set({ groups: groups.map((g) => (g.id === id ? { ...g, enabled: v } : g)) });
  const setRule = (id, v) => chrome.storage.local.set({ rules: rules.map((r) => (r.id === id ? { ...r, enabled: v } : r)) });
  const setDebugger = async (on) => {
    const r = await send({ type: 'debugger', tabId: tab.id, on });
    setNote(r?.ok ? '' : r?.error || '');
    setSt((s) => ({ ...s, debugger: r?.on }));
  };

  return (
    <div className="w-[340px] p-3" data-testid="popup">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">API Inspector</div>
        <Toggle testId="master-toggle" checked={enabled} onChange={setEnabled} label={enabled ? 'Rules on' : 'Rules off'} />
      </div>
      <div className="mb-2 rounded bg-slate-50 px-2 py-1 dark:bg-zinc-800">
        <div className="mono truncate text-slate-500" title={tab.url}>{host || tab.url}</div>
        <div>Rule hits on this tab: <b data-testid="popup-hits">{st.hits}</b></div>
      </div>

      <div className="label mb-1">Groups</div>
      {groups.length === 0 && <div className="mb-2 text-slate-400">No groups yet.</div>}
      <div className="mb-2 space-y-1">
        {groups.map((g) => (
          <div key={g.id} className="flex items-center justify-between" data-testid="popup-group">
            <span className="truncate">{g.name} <span className="text-slate-400">({rules.filter((r) => r.groupId === g.id).length})</span></span>
            <Toggle small testId={`group-toggle-${g.name}`} checked={g.enabled !== false} onChange={(v) => setGroup(g.id, v)} />
          </div>
        ))}
      </div>

      <div className="label mb-1">Rules for this site</div>
      {siteRules.length === 0 && <div className="mb-1 text-slate-400">None. {globalCount} rule(s) work on every site.</div>}
      <div className="mb-2 max-h-40 space-y-1 overflow-auto">
        {siteRules.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2">
            <span className="truncate" title={r.name}>
              <span className={isRuleActive(r, groups, settings) ? '' : 'text-slate-400'}>{r.name}</span>{' '}
              <span className="text-slate-400">{RULE_TYPES[r.type]?.label}</span>
            </span>
            <Toggle small checked={r.enabled} onChange={(v) => setRule(r.id, v)} />
          </div>
        ))}
      </div>

      <div className="mb-2 flex items-center justify-between border-t border-slate-200 pt-2 dark:border-zinc-700">
        <Toggle small testId="popup-debugger" checked={!!st.debugger} onChange={setDebugger} label="Debugger mode on this tab" />
      </div>
      {note && <div className="mb-2 text-rose-600">{note}</div>}
      <div className="flex gap-1">
        <button type="button" className="btn-primary" onClick={() => chrome.runtime.openOptionsPage()}>Rules page</button>
        <button type="button" className="btn" data-testid="open-panel-tab" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL(`panel.html?tabId=${tab.id}`) })}>Open inspector in a tab</button>
      </div>
      <div className="mt-2 text-[11px] text-slate-400">Tip: the full inspector is in DevTools → “API Inspector”.</div>
    </div>
  );
}

applyTheme();
createRoot(document.getElementById('root')).render(<Popup />);
