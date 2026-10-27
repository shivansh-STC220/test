// Popup (D1): quick on / off for this website's rules and for groups.
// The toolbar badge shows how many rule hits this tab had.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/styles.css';
import { applyTheme, queryParam, send, Toggle, useStorage } from '../../ui/components.jsx';
import { Icon, Logo } from '../../ui/icons.jsx';
import { TypeIcon } from '../../ui/ruleMeta.jsx';
import { RULE_TYPES, isRuleActive, normalizeSite, siteMatches } from '../../shared/rules.js';

function RuleLine({ r, groups, settings, onToggle }) {
  const active = isRuleActive(r, groups, settings);
  return (
    <div className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-subtle" data-testid="popup-rule">
      <TypeIcon type={r.type} size="sm" />
      <div className="min-w-0 flex-1">
        <div className={`truncate font-medium ${active ? '' : 'text-fg-3'}`} title={r.name}>{r.name}</div>
        <div className="truncate text-[11px] text-fg-3">{RULE_TYPES[r.type]?.label}{r.enabled && !active ? ' · off by its group' : ''}</div>
      </div>
      <Toggle small testId={`popup-rule-toggle-${r.name}`} checked={r.enabled} onChange={onToggle} />
    </div>
  );
}

function Section({ title, count, children, right }) {
  return (
    <section className="px-3 pt-3">
      <div className="mb-1 flex items-center gap-1.5 px-1.5">
        <span className="eyebrow">{title}</span>
        {count != null && <span className="text-[11px] text-fg-3">{count}</span>}
        <span className="ml-auto">{right}</span>
      </div>
      {children}
    </section>
  );
}

function Popup() {
  const [tab, setTab] = useState(null);
  const [st, setSt] = useState({ hits: 0, debugger: false });
  const [note, setNote] = useState('');
  const [showAllGlobal, setShowAllGlobal] = useState(false);
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

  if (!data || !tab) return <div className="w-[360px] p-4 text-fg-2">Loading…</div>;
  const { rules, groups, settings } = data;
  let host = '';
  let hostPort = '';
  try {
    const u = new URL(st.url || tab.url);
    if (/^https?:$/.test(u.protocol)) { host = u.hostname; hostPort = u.host; }
  } catch {}
  const enabled = settings.enabled !== false;
  // Rules for this website, and rules for every website (they also work here).
  const siteRules = host ? rules.filter((r) => normalizeSite(r.match?.site) && siteMatches(r.match.site, host)) : [];
  const globalRules = rules.filter((r) => !normalizeSite(r.match?.site));
  const here = [...siteRules, ...globalRules];
  const hereGroups = groups.filter((g) => here.some((r) => r.groupId === g.id));
  const otherGroups = groups.filter((g) => !hereGroups.includes(g));

  const setEnabled = (v) => chrome.storage.local.set({ settings: { ...settings, enabled: v } });
  const setGroup = (id, v) => chrome.storage.local.set({ groups: groups.map((g) => (g.id === id ? { ...g, enabled: v } : g)) });
  const setRule = (id, v) => chrome.storage.local.set({ rules: rules.map((r) => (r.id === id ? { ...r, enabled: v, loopError: undefined } : r)) });
  const setDebugger = async (on) => {
    const r = await send({ type: 'debugger', tabId: tab.id, on });
    setNote(r?.ok ? '' : r?.error || '');
    setSt((s) => ({ ...s, debugger: r?.on }));
  };
  const openRules = (extra = '') => chrome.tabs.create({ url: chrome.runtime.getURL(`rules.html?${host ? `site=${encodeURIComponent(host)}` : ''}${extra}`) });

  const groupLine = (g) => (
    <div key={g.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-subtle" data-testid="popup-group">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-fg"><Icon name="layers" size={13} /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{g.name}</div>
        <div className="text-[11px] text-fg-3">{(() => { const n = rules.filter((r) => r.groupId === g.id).length; return `${n} rule${n === 1 ? '' : 's'}`; })()}</div>
      </div>
      <Toggle small testId={`group-toggle-${g.name}`} checked={g.enabled !== false} onChange={(v) => setGroup(g.id, v)} />
    </div>
  );
  const globalShown = showAllGlobal ? globalRules : globalRules.slice(0, 4);

  return (
    <div className="w-[360px] pb-3" data-testid="popup">
      <header className="flex items-center gap-2.5 border-b border-line bg-subtle px-4 py-3">
        <Logo size={26} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight">API Inspector</div>
          <div className="text-[11px] text-fg-3">{enabled ? 'Rules are on' : 'All rules are off'}</div>
        </div>
        <Toggle testId="master-toggle" checked={enabled} onChange={setEnabled} title="Turn all rules on or off" />
      </header>

      <div className="px-3 pt-3">
        <div className="card flex items-center gap-3 px-3 py-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-fg-2"><Icon name="globe" size={18} /></span>
          <div className="min-w-0 flex-1">
            <div className="mono truncate font-medium" title={tab.url} data-testid="popup-site">{hostPort || 'This page'}</div>
            <div className="text-[11px] text-fg-3">{siteRules.length} rule{siteRules.length === 1 ? '' : 's'} for this website</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums leading-none text-accent-fg" data-testid="popup-hits">{st.hits}</div>
            <div className="text-[10px] text-fg-3">rule hits</div>
          </div>
        </div>
      </div>

      <Section
        title="This website"
        count={host ? siteRules.length : null}
        right={host && (
          <button type="button" className="btn-ghost h-6 px-1.5 text-[11px] text-accent-fg" data-testid="popup-new-rule" onClick={() => openRules('&new=1')}>
            <Icon name="plus" size={12} /> New rule
          </button>
        )}
      >
        {!host && <div className="px-1.5 text-fg-3">Rules work on normal web pages (http and https).</div>}
        {host && !siteRules.length && <div className="px-1.5 text-fg-3">No rules just for {host} yet.</div>}
        <div className="max-h-44 space-y-0.5 overflow-auto">
          {siteRules.map((r) => <RuleLine key={r.id} r={r} groups={groups} settings={settings} onToggle={(v) => setRule(r.id, v)} />)}
        </div>
      </Section>

      {globalRules.length > 0 && (
        <Section title="All websites" count={globalRules.length}>
          <div className="space-y-0.5">
            {globalShown.map((r) => <RuleLine key={r.id} r={r} groups={groups} settings={settings} onToggle={(v) => setRule(r.id, v)} />)}
          </div>
          {globalRules.length > 4 && (
            <button type="button" className="btn-ghost h-6 px-1.5 text-[11px]" onClick={() => setShowAllGlobal(!showAllGlobal)}>
              {showAllGlobal ? 'Show less' : `Show ${globalRules.length - 4} more`}
            </button>
          )}
        </Section>
      )}

      {groups.length > 0 && (
        <Section title="Groups" count={groups.length}>
          <div className="space-y-0.5">{hereGroups.map(groupLine)}</div>
          {otherGroups.length > 0 && (
            <details className="mt-0.5">
              <summary className="cursor-pointer px-1.5 py-1 text-[11px] text-fg-3">Groups with no rules here ({otherGroups.length})</summary>
              <div className="space-y-0.5">{otherGroups.map(groupLine)}</div>
            </details>
          )}
        </Section>
      )}

      <div className="px-3 pt-3">
        <div className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${st.debugger ? 'border-amber-500/40 bg-amber-500/10' : 'border-line'}`}>
          <Icon name="bug" size={15} className={st.debugger ? 'text-amber-600' : 'text-fg-3'} />
          <div className="min-w-0 flex-1">
            <div className="font-medium">Debugger mode</div>
            <div className="text-[11px] text-fg-3">Changes even plain form posts on this tab.</div>
          </div>
          <Toggle small testId="popup-debugger" checked={!!st.debugger} onChange={setDebugger} />
        </div>
        {note && <div className="mt-1 text-rose-600">{note}</div>}
      </div>

      <div className="flex gap-1.5 px-3 pt-3">
        <button type="button" className="btn-primary flex-1 justify-center" onClick={() => openRules()}><Icon name="zap" size={13} /> Rules page</button>
        <button type="button" className="btn flex-1 justify-center" data-testid="open-panel-tab" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL(`panel.html?tabId=${tab.id}`) })}>
          <Icon name="activity" size={13} /> Inspector in a tab
        </button>
      </div>
      <div className="px-4 pt-2 text-center text-[11px] text-fg-3">The full inspector is in DevTools → “API Inspector”.</div>
    </div>
  );
}

applyTheme();
createRoot(document.getElementById('root')).render(<Popup />);
