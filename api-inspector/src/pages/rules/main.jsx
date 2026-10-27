// Rules page (D2): create, edit, group, import and export rules.
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/styles.css';
import { applyTheme, download, send, Toggle, useStorage } from '../../ui/components.jsx';
import { RULE_TYPES, matchSummary, newRule, normalizeSite, uid } from '../../shared/rules.js';
import RuleEditor from './RuleEditor.jsx';

const ALL = '__all';
const NONE = '__none';

function UserScriptsBanner() {
  const [on, setOn] = useState(null);
  useEffect(() => {
    const check = () => send({ type: 'env-check' }).then((r) => setOn(!!r?.userScripts)).catch(() => {});
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);
  if (on === null) return null;
  if (on) return <div className="rounded bg-emerald-50 px-3 py-1.5 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" data-testid="us-banner">User scripts are on. Insert script works on every page.</div>;
  return (
    <div className="rounded bg-amber-50 px-3 py-1.5 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" data-testid="us-banner">
      <b>One-time setup:</b> turn on <b>Allow User Scripts</b> for API Inspector (chrome://extensions → API Inspector → Details).
      Without it, Insert script only works on pages that allow inline scripts, and JS in rules only works on pages that allow eval.
    </div>
  );
}

function RulesApp() {
  const data = useStorage(['rules', 'groups', 'settings', 'ruleErrors'], { rules: [], groups: [], settings: { enabled: true }, ruleErrors: {} });
  const [groupView, setGroupView] = useState(ALL);
  const [siteView, setSiteView] = useState(ALL);
  const [editing, setEditing] = useState(null); // rule being edited
  const [newType, setNewType] = useState('redirect');
  const [msg, setMsg] = useState('');

  const sites = useMemo(() => [...new Set((data?.rules || []).map((r) => normalizeSite(r.match?.site)).filter(Boolean))].sort(), [data]);
  if (!data) return <div className="p-4">Loading…</div>;
  const { rules, groups, settings, ruleErrors } = data;

  const saveRules = (next) => chrome.storage.local.set({ rules: next });
  const saveGroups = (next) => chrome.storage.local.set({ groups: next });

  const shown = rules.filter((r) => {
    if (groupView === NONE && r.groupId) return false;
    if (groupView !== ALL && groupView !== NONE && r.groupId !== groupView) return false;
    if (siteView === '' && r.match?.site) return false;
    if (siteView !== ALL && siteView !== '' && normalizeSite(r.match?.site) !== siteView) return false;
    return true;
  });

  const onSave = (saved) => {
    const { loopError, ...rule } = saved;
    const exists = rules.some((r) => r.id === rule.id);
    saveRules(exists ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule]);
    setEditing(null);
    setMsg(`Saved “${rule.name}”.`);
  };

  const move = (i, d) => {
    const idx = rules.indexOf(shown[i]);
    const j = rules.indexOf(shown[i + d]);
    if (idx < 0 || j < 0) return;
    const next = [...rules];
    [next[idx], next[j]] = [next[j], next[idx]];
    saveRules(next);
  };

  const addGroup = () => {
    const name = prompt('Group name, like "Cart Sync local"');
    if (name) saveGroups([...groups, { id: uid('g'), name, enabled: true }]);
  };
  const renameGroup = (g) => {
    const name = prompt('New name', g.name);
    if (name) saveGroups(groups.map((x) => (x.id === g.id ? { ...x, name } : x)));
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

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">API Inspector · Rules</h1>
        <Toggle testId="master-toggle" checked={settings.enabled !== false} onChange={(v) => chrome.storage.local.set({ settings: { ...settings, enabled: v } })} label={settings.enabled !== false ? 'All rules on' : 'All rules off'} />
        <div className="ml-auto flex items-center gap-1">
          <select data-testid="new-type" className="input" value={newType} onChange={(e) => setNewType(e.target.value)}>
            {Object.entries(RULE_TYPES).map(([k, t]) => <option key={k} value={k}>{t.id} · {t.label}</option>)}
          </select>
          <button
            type="button"
            className="btn-primary"
            data-testid="new-rule"
            onClick={() => setEditing(newRule(newType, { groupId: groupView !== ALL && groupView !== NONE ? groupView : null, match: { urlType: 'contains', url: '', methods: [], site: siteView !== ALL ? siteView : '' } }))}
          >
            + New rule
          </button>
          <button type="button" className="btn" data-testid="export-rules" onClick={exportRules}>Export</button>
          <label className="btn cursor-pointer">
            Import
            <input data-testid="import-rules" type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importRules(f); e.target.value = ''; }} />
          </label>
        </div>
      </div>
      <UserScriptsBanner />
      {msg && <div className="mt-2 text-slate-600 dark:text-zinc-300" data-testid="rules-msg">{msg}</div>}

      <div className="mt-3 flex gap-4">
        <aside className="w-56 shrink-0 space-y-3">
          <div>
            <div className="label mb-1">Groups</div>
            {[{ id: ALL, name: `All rules (${rules.length})` }, { id: NONE, name: 'No group' }].map((g) => (
              <button key={g.id} type="button" className={`block w-full rounded px-2 py-0.5 text-left ${groupView === g.id ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300' : 'hover:bg-slate-100 dark:hover:bg-zinc-800'}`} onClick={() => setGroupView(g.id)}>{g.name}</button>
            ))}
            {groups.map((g) => (
              <div key={g.id} className={`group flex items-center gap-1 rounded px-2 py-0.5 ${groupView === g.id ? 'bg-indigo-50 dark:bg-indigo-500/20' : 'hover:bg-slate-100 dark:hover:bg-zinc-800'}`} data-testid="group-item">
                <Toggle small testId={`group-toggle-${g.name}`} checked={g.enabled !== false} onChange={(v) => saveGroups(groups.map((x) => (x.id === g.id ? { ...x, enabled: v } : x)))} />
                <button type="button" className="flex-1 truncate text-left" onClick={() => setGroupView(g.id)}>{g.name} <span className="text-slate-400">({rules.filter((r) => r.groupId === g.id).length})</span></button>
                <button type="button" className="hidden text-slate-400 group-hover:inline" title="Rename" onClick={() => renameGroup(g)}>✎</button>
                <button type="button" className="hidden text-slate-400 group-hover:inline" title="Delete" onClick={() => deleteGroup(g)}>✕</button>
              </div>
            ))}
            <button type="button" className="btn mt-1" data-testid="new-group" onClick={addGroup}>+ New group</button>
          </div>
          <div>
            <div className="label mb-1">Site</div>
            <select data-testid="site-filter" className="input w-full" value={siteView} onChange={(e) => setSiteView(e.target.value)}>
              <option value={ALL}>All sites</option>
              <option value="">Every site (no site set)</option>
              {sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </aside>

        <main className="min-w-0 flex-1 space-y-2">
          {editing && (
            <RuleEditor key={editing.id} initial={editing} groups={groups} sites={sites} onSave={onSave} onCancel={() => setEditing(null)} />
          )}
          {!shown.length && !editing && <div className="p-6 text-center text-slate-400">No rules here yet. Pick a type and press “+ New rule”.</div>}
          {shown.map((r, i) => (
            <div key={r.id} data-testid="rule-row" data-name={r.name} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1.5 dark:border-zinc-700">
              <Toggle small testId={`rule-toggle-${r.name}`} checked={r.enabled} onChange={(v) => saveRules(rules.map((x) => (x.id === r.id ? { ...x, enabled: v, loopError: undefined } : x)))} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  <span className="chip bg-slate-100 text-slate-600 dark:bg-zinc-700 dark:text-zinc-300">{RULE_TYPES[r.type]?.id} {RULE_TYPES[r.type]?.label}</span>
                  {r.groupId && <span className="chip bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">{groups.find((g) => g.id === r.groupId)?.name}</span>}
                </div>
                <div className="mono truncate text-slate-500">{matchSummary(r)}</div>
                {ruleErrors?.[r.id] && <div className="text-rose-600" data-testid="rule-row-error">Chrome did not accept this rule: {ruleErrors[r.id]}</div>}
                {r.loopError && <div className="text-rose-600" data-testid="rule-row-loop">{r.loopError}</div>}
              </div>
              <button type="button" className="btn" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="btn" title="Move down" disabled={i === shown.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="btn" data-testid="rule-edit" onClick={() => setEditing(r)}>Edit</button>
              <button type="button" className="btn" onClick={() => setEditing({ ...r, id: uid('r'), name: `${r.name} (copy)` })}>Duplicate</button>
              <button type="button" className="btn" data-testid="rule-delete" onClick={() => confirm(`Delete “${r.name}”?`) && saveRules(rules.filter((x) => x.id !== r.id))}>Delete</button>
            </div>
          ))}
          <div className="pt-2 text-[11px] text-slate-400">Rules higher in the list win when two page rules of the same kind match one call. Rules are saved in this browser only.</div>
        </main>
      </div>
    </div>
  );
}

applyTheme();
createRoot(document.getElementById('root')).render(<RulesApp />);
