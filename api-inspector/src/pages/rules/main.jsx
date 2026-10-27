// Rules page (D2): create, edit, group, import and export rules, saved per website.
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/styles.css';
import { applyTheme, download, EmptyState, queryParam, send, Toggle, useStorage } from '../../ui/components.jsx';
import { Icon, Logo } from '../../ui/icons.jsx';
import { TYPE_GROUPS, TypeIcon } from '../../ui/ruleMeta.jsx';
import { RULE_TYPES, matchSummary, newRule, normalizeSite, siteMatches, uid } from '../../shared/rules.js';
import RuleEditor from './RuleEditor.jsx';

const ALL = '__all';
const NONE = '__none';
const EVERY = '__every';

function UserScriptsBanner() {
  const [on, setOn] = useState(null);
  useEffect(() => {
    const check = () => send({ type: 'env-check' }).then((r) => setOn(!!r?.userScripts)).catch(() => {});
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);
  if (on === null) return null;
  if (on) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/8 px-3 py-2 text-emerald-800 dark:text-emerald-300" data-testid="us-banner">
        <Icon name="check" size={14} /> User scripts are on. Insert script works on every page.
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-amber-900 dark:text-amber-200" data-testid="us-banner">
      <Icon name="info" size={14} className="mt-0.5" />
      <div>
        <b>One-time setup:</b> turn on <b>Allow User Scripts</b> for API Inspector (chrome://extensions → API Inspector → Details).
        <div className="text-[11px] opacity-80">Without it, Insert script only works on pages that allow inline scripts, and JS in rules only works on pages that allow eval.</div>
      </div>
    </div>
  );
}

function TypePicker({ onPick, onClose, site }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <div className="pop relative max-h-full w-[760px] max-w-full overflow-auto rounded-xl border border-line bg-bg shadow-2xl" data-testid="type-picker">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <div className="flex-1">
            <div className="text-[15px] font-semibold">New rule</div>
            <div className="text-fg-2">Pick what the rule should do{site ? <> on <span className="mono">{site}</span></> : ''}.</div>
          </div>
          <button type="button" className="icon-btn" title="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="space-y-5 p-5">
          {TYPE_GROUPS.map((g) => (
            <section key={g.id}>
              <div className="mb-2">
                <h3 className="eyebrow">{g.title}</h3>
                <p className="text-[11px] text-fg-3">{g.help}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {g.types.map((t) => (
                  <button
                    key={t}
                    type="button"
                    data-testid={`type-${t}`}
                    onClick={() => onPick(t)}
                    className="card flex items-start gap-2.5 p-2.5 text-left transition hover:-translate-y-px hover:border-accent/50 hover:shadow-md"
                  >
                    <TypeIcon type={t} />
                    <span className="min-w-0">
                      <span className="block font-semibold">{RULE_TYPES[t].label} <span className="font-normal text-fg-3">{RULE_TYPES[t].id}</span></span>
                      <span className="block text-[11px] leading-snug text-fg-2">{RULE_TYPES[t].help}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function NavItem({ active, onClick, icon, label, count, testId, children }) {
  return (
    <div
      data-testid={testId}
      className={`group flex h-8 items-center gap-2 rounded-md px-2 ${active ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-fg-2 hover:bg-muted hover:text-fg'}`}
    >
      {children}
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onClick}>
        {icon && <Icon name={icon} size={14} className={active ? 'text-accent' : ''} />}
        <span className="truncate">{label}</span>
        {count != null && <span className="ml-auto text-[11px] tabular-nums text-fg-3">{count}</span>}
      </button>
    </div>
  );
}

function RuleCard({ r, groups, error, first, last, onToggle, onEdit, onCopy, onDelete, onMove }) {
  const group = groups.find((g) => g.id === r.groupId);
  const site = normalizeSite(r.match?.site);
  return (
    <div
      data-testid="rule-row"
      data-name={r.name}
      className={`card group flex items-center gap-3 px-3 py-2.5 transition hover:border-accent/40 hover:shadow-sm ${r.enabled ? '' : 'bg-subtle'}`}
    >
      <Toggle small testId={`rule-toggle-${r.name}`} checked={r.enabled} onChange={onToggle} />
      <TypeIcon type={r.type} />
      <div className={`min-w-0 flex-1 ${r.enabled ? '' : 'opacity-60'}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="font-semibold hover:underline" onClick={onEdit}>{r.name}</button>
          <span className="chip bg-muted text-fg-2">{RULE_TYPES[r.type]?.id} · {RULE_TYPES[r.type]?.label}</span>
          {site ? (
            <span className="chip bg-sky-500/12 text-sky-700 dark:text-sky-300" data-testid="rule-site"><Icon name="globe" size={10} />{site}</span>
          ) : (
            <span className="chip bg-muted text-fg-3" data-testid="rule-site"><Icon name="globe" size={10} />All websites</span>
          )}
          {group && <span className="chip bg-accent-soft text-accent-fg"><Icon name="layers" size={10} />{group.name}</span>}
        </div>
        <div className="mono mt-0.5 truncate text-fg-2" title={matchSummary(r)}>{matchSummary(r)}</div>
        {error && <div className="mt-1 flex items-center gap-1.5 text-rose-600 dark:text-rose-400" data-testid="rule-row-error"><Icon name="alert" size={12} />Chrome did not accept this rule: {error}</div>}
        {r.loopError && <div className="mt-1 flex items-center gap-1.5 text-rose-600 dark:text-rose-400" data-testid="rule-row-loop"><Icon name="alert" size={12} />{r.loopError}</div>}
      </div>
      <div className="flex items-center gap-0.5 opacity-70 transition group-hover:opacity-100">
        <button type="button" className="icon-btn" title="Move up" disabled={first} onClick={() => onMove(-1)}><Icon name="arrowUp" size={13} /></button>
        <button type="button" className="icon-btn" title="Move down" disabled={last} onClick={() => onMove(1)}><Icon name="arrowDown" size={13} /></button>
        <button type="button" className="icon-btn" title="Edit" data-testid="rule-edit" onClick={onEdit}><Icon name="pencil" size={13} /></button>
        <button type="button" className="icon-btn" title="Duplicate" onClick={onCopy}><Icon name="copy" size={13} /></button>
        <button type="button" className="icon-btn hover:text-rose-600" title="Delete" data-testid="rule-delete" onClick={onDelete}><Icon name="trash" size={13} /></button>
      </div>
    </div>
  );
}

function RulesApp() {
  const pageSite = normalizeSite(queryParam('site') || '');
  const data = useStorage(['rules', 'groups', 'settings', 'ruleErrors'], { rules: [], groups: [], settings: { enabled: true }, ruleErrors: {} });
  const [groupView, setGroupView] = useState(ALL);
  const [siteView, setSiteView] = useState(pageSite || ALL);
  const [editing, setEditing] = useState(null);
  const [picking, setPicking] = useState(queryParam('new') === '1');
  const [query, setQuery] = useState('');
  const [msg, setMsg] = useState('');
  const [newGroup, setNewGroup] = useState(null);
  const [renaming, setRenaming] = useState(null);

  const sites = useMemo(() => {
    const s = new Set((data?.rules || []).map((r) => normalizeSite(r.match?.site)).filter(Boolean));
    if (pageSite) s.add(pageSite);
    return [...s].sort();
  }, [data, pageSite]);

  if (!data) return <div className="p-6 text-fg-2">Loading…</div>;
  const { rules, groups, settings, ruleErrors } = data;
  const viewingSite = siteView !== ALL && siteView !== EVERY ? siteView : '';
  // The site new rules are made for: the site you look at, or the one you came from.
  const currentSite = viewingSite || (siteView === EVERY ? '' : pageSite);

  const saveRules = (next) => chrome.storage.local.set({ rules: next });
  const saveGroups = (next) => chrome.storage.local.set({ groups: next });

  const inGroup = (r) => (groupView === ALL ? true : groupView === NONE ? !r.groupId : r.groupId === groupView);
  const inQuery = (r) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [r.name, RULE_TYPES[r.type]?.label, r.match?.url, r.match?.site, r.config?.target, r.config?.from, r.config?.to].some((v) => v && String(v).toLowerCase().includes(q));
  };
  const base = rules.filter((r) => inGroup(r) && inQuery(r));
  let primary;
  let alsoHere = [];
  if (viewingSite) {
    primary = base.filter((r) => normalizeSite(r.match?.site) && siteMatches(r.match.site, viewingSite));
    alsoHere = base.filter((r) => !normalizeSite(r.match?.site));
  } else if (siteView === EVERY) {
    primary = base.filter((r) => !normalizeSite(r.match?.site));
  } else {
    primary = base;
  }

  const onSave = (saved) => {
    const { loopError, ...rule } = saved;
    const exists = rules.some((r) => r.id === rule.id);
    saveRules(exists ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule]);
    setEditing(null);
    setMsg(`Saved “${rule.name}”.`);
  };

  const startNew = (type) => {
    setPicking(false);
    setEditing(newRule(type, {
      groupId: groupView !== ALL && groupView !== NONE ? groupView : null,
      match: { urlType: 'contains', url: '', methods: [], site: currentSite },
    }));
  };

  const move = (list, i, d) => {
    const a = rules.indexOf(list[i]);
    const b = rules.indexOf(list[i + d]);
    if (a < 0 || b < 0) return;
    const next = [...rules];
    [next[a], next[b]] = [next[b], next[a]];
    saveRules(next);
  };

  const addGroup = (name) => {
    if (name.trim()) saveGroups([...groups, { id: uid('g'), name: name.trim(), enabled: true }]);
    setNewGroup(null);
  };
  const renameGroup = (id, name) => {
    if (name.trim()) saveGroups(groups.map((x) => (x.id === id ? { ...x, name: name.trim() } : x)));
    setRenaming(null);
  };
  const deleteGroup = (g) => {
    if (!confirm(`Delete group “${g.name}”? Its rules stay, with no group.`)) return;
    chrome.storage.local.set({ groups: groups.filter((x) => x.id !== g.id), rules: rules.map((r) => (r.groupId === g.id ? { ...r, groupId: null } : r)) });
    setGroupView(ALL);
  };

  const exportRules = () => download('api-inspector-rules.json', { app: 'api-inspector', version: 1, exportedAt: new Date().toISOString(), groups, rules });

  const importRules = async (file) => {
    try {
      const json = JSON.parse(await file.text());
      const inGroups = Array.isArray(json.groups) ? json.groups : [];
      const inRules = Array.isArray(json.rules) ? json.rules : Array.isArray(json) ? json : null;
      if (!inRules) throw new Error('No "rules" list in this file.');
      // New ids, so importing twice never mixes up rules.
      const groupIds = {};
      const newGroups = inGroups.map((g) => {
        const existing = groups.find((x) => x.name === g.name);
        groupIds[g.id] = existing ? existing.id : uid('g');
        return existing ? null : { id: groupIds[g.id], name: g.name, enabled: g.enabled !== false };
      }).filter(Boolean);
      const newRules = inRules.filter((r) => r && RULE_TYPES[r.type]).map((r) => ({
        ...newRule(r.type),
        ...r,
        id: uid('r'),
        groupId: r.groupId ? groupIds[r.groupId] || null : null,
      }));
      await chrome.storage.local.set({ groups: [...groups, ...newGroups], rules: [...rules, ...newRules] });
      setMsg(`Imported ${newRules.length} rule(s) and ${newGroups.length} group(s).`);
    } catch (e) {
      setMsg(`Import failed: ${e.message}`);
    }
  };

  const ruleCards = (list) => list.map((r, i) => (
    <RuleCard
      key={r.id}
      r={r}
      groups={groups}
      error={ruleErrors?.[r.id]}
      first={i === 0}
      last={i === list.length - 1}
      onToggle={(v) => saveRules(rules.map((x) => (x.id === r.id ? { ...x, enabled: v, loopError: undefined } : x)))}
      onEdit={() => setEditing({ ...r, saved: true })}
      onCopy={() => setEditing({ ...r, id: uid('r'), name: `${r.name} (copy)` })}
      onDelete={() => confirm(`Delete “${r.name}”?`) && saveRules(rules.filter((x) => x.id !== r.id))}
      onMove={(d) => move(list, i, d)}
    />
  ));

  const groupName = groups.find((g) => g.id === groupView)?.name;
  const title = viewingSite ? <>Rules for <span className="mono">{viewingSite}</span></> : siteView === EVERY ? 'Rules for all websites' : groupView === NONE ? 'Rules with no group' : groupName ? `Group: ${groupName}` : 'All rules';
  const enabled = settings.enabled !== false;
  const siteCount = (s) => rules.filter((r) => normalizeSite(r.match?.site) && siteMatches(r.match.site, s)).length;

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-subtle">
        <div className="flex items-center gap-2 px-4 py-3.5">
          <Logo size={24} />
          <div>
            <div className="font-semibold leading-tight">API Inspector</div>
            <div className="text-[11px] text-fg-3">Rules</div>
          </div>
        </div>
        <div className="mx-3 mb-3 flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2">
          <div>
            <div className="font-medium">{enabled ? 'All rules on' : 'All rules off'}</div>
            <div className="text-[11px] text-fg-3">Main switch</div>
          </div>
          <Toggle testId="master-toggle" checked={enabled} onChange={(v) => chrome.storage.local.set({ settings: { ...settings, enabled: v } })} />
        </div>
        <nav className="min-h-0 flex-1 space-y-4 overflow-auto px-3 pb-3">
          <div className="space-y-0.5">
            <NavItem icon="list" label="All rules" count={rules.length} active={groupView === ALL && siteView === ALL} onClick={() => { setGroupView(ALL); setSiteView(ALL); }} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between px-2">
              <span className="eyebrow">Websites</span>
            </div>
            <div className="space-y-0.5">
              {sites.map((s) => (
                <NavItem key={s} testId="site-item" icon="globe" label={s} count={siteCount(s)} active={siteView === s} onClick={() => setSiteView(s)}>
                  {s === pageSite && <span className="sr-only">current</span>}
                </NavItem>
              ))}
              <NavItem testId="site-item" icon="globe" label="All websites" count={rules.filter((r) => !normalizeSite(r.match?.site)).length} active={siteView === EVERY} onClick={() => setSiteView(EVERY)} />
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between px-2">
              <span className="eyebrow">Groups</span>
              <button type="button" className="icon-btn h-6 w-6" title="New group" data-testid="new-group" onClick={() => setNewGroup('')}><Icon name="plus" size={13} /></button>
            </div>
            <div className="space-y-0.5">
              {newGroup !== null && (
                <form className="px-1 pb-1" onSubmit={(e) => { e.preventDefault(); addGroup(newGroup); }}>
                  <input
                    autoFocus
                    data-testid="new-group-input"
                    className="input w-full"
                    placeholder='Like "Cart Sync local"'
                    value={newGroup}
                    onChange={(e) => setNewGroup(e.target.value)}
                    onBlur={() => addGroup(newGroup)}
                    onKeyDown={(e) => e.key === 'Escape' && setNewGroup(null)}
                  />
                </form>
              )}
              {groups.map((g) => (renaming?.id === g.id ? (
                <form key={g.id} className="px-1" onSubmit={(e) => { e.preventDefault(); renameGroup(g.id, renaming.name); }}>
                  <input autoFocus className="input w-full" value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} onBlur={() => renameGroup(g.id, renaming.name)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} />
                </form>
              ) : (
                <NavItem key={g.id} testId="group-item" label={g.name} count={rules.filter((r) => r.groupId === g.id).length} active={groupView === g.id} onClick={() => setGroupView(g.id)}>
                  <Toggle small testId={`group-toggle-${g.name}`} checked={g.enabled !== false} onChange={(v) => saveGroups(groups.map((x) => (x.id === g.id ? { ...x, enabled: v } : x)))} />
                  <span className="order-last hidden items-center group-hover:flex">
                    <button type="button" className="icon-btn h-6 w-6" title="Rename" onClick={() => setRenaming({ id: g.id, name: g.name })}><Icon name="pencil" size={12} /></button>
                    <button type="button" className="icon-btn h-6 w-6" title="Delete" onClick={() => deleteGroup(g)}><Icon name="trash" size={12} /></button>
                  </span>
                </NavItem>
              )))}
              <NavItem icon="folder" label="No group" count={rules.filter((r) => !r.groupId).length} active={groupView === NONE} onClick={() => setGroupView(NONE)} />
              {!groups.length && newGroup === null && <div className="px-2 text-[11px] text-fg-3">Groups let you turn many rules on or off at once.</div>}
            </div>
          </div>
        </nav>
        <div className="flex gap-1.5 border-t border-line p-3">
          <button type="button" className="btn flex-1 justify-center" data-testid="export-rules" onClick={exportRules}><Icon name="download" size={13} /> Export</button>
          <label className="btn flex-1 cursor-pointer justify-center">
            <Icon name="upload" size={13} /> Import
            <input data-testid="import-rules" type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importRules(f); e.target.value = ''; }} />
          </label>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        <div className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-3.5">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[17px] font-semibold" data-testid="rules-title">{title}</h1>
              <div className="text-fg-2">
                {primary.length} rule{primary.length === 1 ? '' : 's'}
                {viewingSite && alsoHere.length > 0 && ` · plus ${alsoHere.length} for all websites`}
                {groupView !== ALL && viewingSite ? ` · in ${groupView === NONE ? 'no group' : groupName}` : ''}
              </div>
            </div>
            <div className="relative">
              <Icon name="search" size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-3" />
              <input data-testid="rules-search" className="input w-56 pl-7" placeholder="Search rules" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <button type="button" className="btn-primary h-8 px-3" data-testid="new-rule" onClick={() => setPicking(true)}>
              <Icon name="plus" size={14} /> New rule
            </button>
          </div>
        </div>

        <div className="mx-auto max-w-5xl space-y-3 px-6 py-4">
          <UserScriptsBanner />
          {msg && (
            <div className="pop flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-accent-fg" data-testid="rules-msg">
              <Icon name="check" size={14} /> {msg}
              <button type="button" className="icon-btn ml-auto h-5 w-5" onClick={() => setMsg('')}><Icon name="x" size={12} /></button>
            </div>
          )}
          {primary.length ? (
            <div className="space-y-2">{ruleCards(primary)}</div>
          ) : (
            <div className="card">
              <EmptyState
                icon="zap"
                title={viewingSite ? `No rules for ${viewingSite} yet` : 'No rules here yet'}
                action={<button type="button" className="btn-primary" onClick={() => setPicking(true)}><Icon name="plus" size={13} /> New rule</button>}
              >
                Rules change or fake requests: redirect, mock, delay, pause and more.
              </EmptyState>
            </div>
          )}
          {viewingSite && alsoHere.length > 0 && (
            <section className="pt-3">
              <div className="mb-2 flex items-center gap-2">
                <Icon name="globe" size={13} className="text-fg-3" />
                <h2 className="font-semibold">Rules for all websites</h2>
                <span className="text-fg-3">— these also work on {viewingSite}</span>
              </div>
              <div className="space-y-2">{ruleCards(alsoHere)}</div>
            </section>
          )}
          <p className="pt-2 text-[11px] text-fg-3">Rules higher in the list win when two page rules of the same kind match one call. Rules are saved in this browser only.</p>
        </div>
      </main>

      {picking && <TypePicker site={currentSite} onPick={startNew} onClose={() => setPicking(false)} />}
      {editing && (
        <RuleEditor key={editing.id} initial={editing} groups={groups} sites={sites} currentSite={currentSite || normalizeSite(editing.match?.site)} onSave={onSave} onCancel={() => setEditing(null)} />
      )}
    </div>
  );
}

applyTheme();
createRoot(document.getElementById('root')).render(<RulesApp />);
