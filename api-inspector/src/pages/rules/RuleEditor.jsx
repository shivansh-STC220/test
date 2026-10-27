// Form to create or edit one rule.
import { useState } from 'react';
import { METHODS, RULE_TYPES, UA_PRESETS, defaultConfig, validateRule } from '../../shared/rules.js';
import { KeyValueEditor } from '../../ui/components.jsx';

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

const HEADER_OPS = [{ value: 'set', label: 'Set' }, { value: 'append', label: 'Append' }, { value: 'remove', label: 'Remove' }];
const QUERY_OPS = [{ value: 'add', label: 'Add or set' }, { value: 'set', label: 'Change only' }, { value: 'remove', label: 'Remove' }];

function fileToConfig(file) {
  return new Promise((resolve) => {
    const textish = /^text\/|json|javascript|xml|svg|css/.test(file.type) || /\.(js|mjs|css|json|html?|txt|svg|xml|liquid)$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (textish) resolve({ content: reader.result, base64: false });
      else resolve({ content: String(reader.result).split(',')[1] || '', base64: true });
    };
    if (textish) reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

function guessType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return { js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', html: 'text/html', htm: 'text/html', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain' }[ext] || 'application/octet-stream';
}

function ConfigForm({ rule, setConfig }) {
  const c = rule.config || {};
  const set = (patch) => setConfig({ ...c, ...patch });
  switch (rule.type) {
    case 'redirect':
      return (
        <Field label="Redirect to" hint="Full URL. With a regex match you can use $1 or \1 for groups.">
          <input data-testid="cfg-target" className="input mono" value={c.target || ''} onChange={(e) => set({ target: e.target.value })} placeholder="https://staging.example.com/api/x" />
        </Field>
      );
    case 'replace':
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Replace this text in the URL"><input data-testid="cfg-from" className="input mono" value={c.from || ''} onChange={(e) => set({ from: e.target.value })} placeholder="api.live.com" /></Field>
          <Field label="With"><input data-testid="cfg-to" className="input mono" value={c.to || ''} onChange={(e) => set({ to: e.target.value })} placeholder="api.staging.com" /></Field>
        </div>
      );
    case 'query':
      return <Field label="Query params"><KeyValueEditor testId="cfg-params" keyField="key" ops={QUERY_OPS} rows={c.params} onChange={(params) => set({ params })} namePlaceholder="param" /></Field>;
    case 'headers':
      return (
        <div className="space-y-2">
          <Field label="Request headers"><KeyValueEditor testId="cfg-req-headers" ops={HEADER_OPS} rows={c.request} onChange={(request) => set({ request })} /></Field>
          <Field label="Response headers"><KeyValueEditor testId="cfg-res-headers" ops={HEADER_OPS} rows={c.response} onChange={(response) => set({ response })} /></Field>
        </div>
      );
    case 'block':
      return <div className="text-slate-500">Matching calls fail and are never sent.</div>;
    case 'userAgent':
      return (
        <div className="space-y-2">
          <Field label="Device">
            <select className="input" value={c.preset || 'custom'} onChange={(e) => set({ preset: e.target.value, value: UA_PRESETS[e.target.value] || c.value })}>
              <option value="iphone">iPhone</option>
              <option value="android">Android phone</option>
              <option value="ipad">iPad</option>
              <option value="chromeDesktop">Chrome desktop</option>
              <option value="firefoxDesktop">Firefox desktop</option>
              <option value="safariMac">Safari Mac</option>
              <option value="custom">Custom</option>
            </select>
          </Field>
          <Field label="User agent" hint="Sent as the User-Agent header. navigator.userAgent changes too, in pages that match.">
            <textarea data-testid="cfg-ua" className="input mono h-16" value={c.value || ''} onChange={(e) => set({ value: e.target.value, preset: 'custom' })} />
          </Field>
        </div>
      );
    case 'mapRemote':
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="From (URL start)" hint="Every URL that starts with this…"><input data-testid="cfg-map-from" className="input mono" value={c.from || ''} onChange={(e) => set({ from: e.target.value })} placeholder="https://mystore.com/apps/stock/" /></Field>
          <Field label="To" hint="…goes here instead. Chrome may ask before a live site loads from localhost."><input data-testid="cfg-map-to" className="input mono" value={c.to || ''} onChange={(e) => set({ to: e.target.value })} placeholder="http://localhost:3000/apps/stock/" /></Field>
        </div>
      );
    case 'requestBody':
      return (
        <div className="space-y-2">
          <div className="flex gap-3">
            <label className="inline-flex items-center gap-1"><input type="radio" checked={c.mode !== 'js'} onChange={() => set({ mode: 'fixed' })} /> Fixed body</label>
            <label className="inline-flex items-center gap-1"><input type="radio" data-testid="cfg-mode-js" checked={c.mode === 'js'} onChange={() => set({ mode: 'js' })} /> JS function</label>
          </div>
          {c.mode === 'js' ? (
            <Field label="function (body, request) {" hint="body is the text. Return new text or an object (sent as JSON). Return nothing to keep it.">
              <textarea data-testid="cfg-code" className="input mono h-32" value={c.code || ''} onChange={(e) => set({ code: e.target.value })} />
            </Field>
          ) : (
            <Field label="New body"><textarea data-testid="cfg-value" className="input mono h-32" value={c.value || ''} onChange={(e) => set({ value: e.target.value })} placeholder='{"quantity": 999}' /></Field>
          )}
        </div>
      );
    case 'responseEdit':
      return (
        <div className="space-y-2">
          <div className="flex gap-3">
            <label className="inline-flex items-center gap-1"><input type="radio" checked={c.mode === 'merge' || !c.mode} onChange={() => set({ mode: 'merge' })} /> Merge JSON</label>
            <label className="inline-flex items-center gap-1"><input type="radio" checked={c.mode === 'replace'} onChange={() => set({ mode: 'replace' })} /> Replace body</label>
            <label className="inline-flex items-center gap-1"><input type="radio" data-testid="cfg-mode-js" checked={c.mode === 'js'} onChange={() => set({ mode: 'js' })} /> JS function</label>
          </div>
          {c.mode === 'js' ? (
            <Field label="function (data, response, request) {" hint="data is the parsed JSON (or text). Return the new data.">
              <textarea data-testid="cfg-code" className="input mono h-32" value={c.code || ''} onChange={(e) => set({ code: e.target.value })} />
            </Field>
          ) : (
            <Field label={c.mode === 'replace' ? 'New body' : 'JSON to merge in'} hint={c.mode === 'replace' ? '' : 'Keys you give here replace the same keys in the real response.'}>
              <textarea data-testid="cfg-value" className="input mono h-32" value={c.value || ''} onChange={(e) => set({ value: e.target.value })} />
            </Field>
          )}
          <Field label="Status (optional)"><input data-testid="cfg-status" className="input w-24" value={c.status || ''} onChange={(e) => set({ status: e.target.value })} placeholder="keep" /></Field>
        </div>
      );
    case 'responseMock':
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            <span className="label pt-1">Quick:</span>
            <button type="button" className="btn" onClick={() => set({ status: 500, body: '{"error":"Internal Server Error"}' })}>500</button>
            <button type="button" className="btn" onClick={() => set({ status: 429, body: '{"error":"Too Many Requests"}' })}>429</button>
            <button type="button" className="btn" onClick={() => set({ status: 200, body: '{"items":[],"item_count":0,"total_price":0}' })}>Empty cart</button>
            <button type="button" className="btn" onClick={() => set({ status: 0 })}>Network error</button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Status" hint="0 = network error"><input data-testid="cfg-status" type="number" className="input" value={c.status ?? 200} onChange={(e) => set({ status: e.target.value === '' ? '' : Number(e.target.value) })} /></Field>
            <Field label="Content-Type"><input className="input mono" value={c.contentType || ''} onChange={(e) => set({ contentType: e.target.value })} /></Field>
          </div>
          <Field label="Extra headers"><KeyValueEditor rows={c.headers} onChange={(headers) => set({ headers })} /></Field>
          <Field label="Body"><textarea data-testid="cfg-body" className="input mono h-32" value={c.body ?? ''} onChange={(e) => set({ body: e.target.value })} /></Field>
        </div>
      );
    case 'delay':
      return <Field label="Wait (ms)"><input data-testid="cfg-ms" type="number" className="input w-32" value={c.ms ?? 1000} onChange={(e) => set({ ms: Number(e.target.value) })} /></Field>;
    case 'pause':
      return <div className="text-slate-500">Matching calls stop and wait. Edit them in DevTools → API Inspector (or the window that opens), then Send or Drop.</div>;
    case 'insertScript':
      return (
        <div className="space-y-2">
          <div className="flex gap-3">
            <label className="inline-flex items-center gap-1"><input type="radio" checked={c.kind !== 'css'} onChange={() => set({ kind: 'js' })} /> JavaScript</label>
            <label className="inline-flex items-center gap-1"><input type="radio" data-testid="cfg-kind-css" checked={c.kind === 'css'} onChange={() => set({ kind: 'css' })} /> CSS</label>
            <select className="input" value={c.runAt || 'document_idle'} onChange={(e) => set({ runAt: e.target.value })}>
              <option value="document_start">Run at page start</option>
              <option value="document_end">Run when HTML is ready</option>
              <option value="document_idle">Run after load</option>
            </select>
          </div>
          <Field label={c.kind === 'css' ? 'CSS' : 'JavaScript'} hint="Uses the URL match on the page address.">
            <textarea data-testid="cfg-code" className="input mono h-40" value={c.code || ''} onChange={(e) => set({ code: e.target.value })} />
          </Field>
        </div>
      );
    case 'mapLocal':
      return (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <Field label="Upload a file">
              <input
                type="file"
                data-testid="cfg-file"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const r = await fileToConfig(f);
                  set({ ...r, fileName: f.name, contentType: f.type || guessType(f.name) });
                }}
              />
            </Field>
            {c.fileName && <span className="text-slate-500">{c.fileName}{c.base64 ? ' (binary)' : ''}</span>}
          </div>
          <Field label="Content-Type"><input data-testid="cfg-content-type" className="input mono w-64" value={c.contentType || ''} onChange={(e) => set({ contentType: e.target.value })} /></Field>
          {!c.base64 && (
            <Field label="…or paste the file content">
              <textarea data-testid="cfg-content" className="input mono h-40" value={c.content || ''} onChange={(e) => set({ content: e.target.value, fileName: '' })} />
            </Field>
          )}
          {c.base64 && <button type="button" className="btn" onClick={() => set({ base64: false, content: '', fileName: '' })}>Remove file</button>}
        </div>
      );
    default:
      return null;
  }
}

export default function RuleEditor({ initial, groups, sites, onSave, onCancel }) {
  const [rule, setRule] = useState(initial);
  const [error, setError] = useState('');
  const m = rule.match || {};
  const setMatch = (patch) => setRule({ ...rule, match: { ...m, ...patch } });
  const toggleMethod = (meth) => setMatch({ methods: m.methods?.includes(meth) ? m.methods.filter((x) => x !== meth) : [...(m.methods || []), meth] });
  const hideUrl = rule.type === 'mapRemote';

  const save = () => {
    const err = validateRule(rule);
    if (err) return setError(err);
    onSave(rule);
  };

  return (
    <div className="space-y-3 rounded border border-slate-200 p-3 dark:border-zinc-700" data-testid="rule-editor">
      <div className="grid grid-cols-3 gap-2">
        <Field label="Name"><input data-testid="rule-name" className="input" value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} /></Field>
        <Field label="Type">
          <select data-testid="rule-type" className="input" value={rule.type} onChange={(e) => setRule({ ...rule, type: e.target.value, config: defaultConfig(e.target.value) })}>
            {Object.entries(RULE_TYPES).map(([k, t]) => <option key={k} value={k}>{t.id} · {t.label}</option>)}
          </select>
        </Field>
        <Field label="Group">
          <select data-testid="rule-group" className="input" value={rule.groupId || ''} onChange={(e) => setRule({ ...rule, groupId: e.target.value || null })}>
            <option value="">No group</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="text-slate-500">{RULE_TYPES[rule.type]?.help}</div>

      <fieldset className="space-y-2 rounded border border-slate-200 p-2 dark:border-zinc-700">
        <legend className="label px-1">Match</legend>
        {!hideUrl && (
          <div className="flex items-end gap-2">
            <Field label="URL">
              <select data-testid="match-type" className="input" value={m.urlType || 'contains'} onChange={(e) => setMatch({ urlType: e.target.value })}>
                <option value="contains">contains</option>
                <option value="exact">is exactly</option>
                <option value="wildcard">matches wildcard (*)</option>
                <option value="regex">matches regex</option>
              </select>
            </Field>
            <input data-testid="match-url" className="input mono flex-1" value={m.url || ''} onChange={(e) => setMatch({ url: e.target.value })} placeholder={rule.type === 'replace' ? '(optional) only URLs that contain this' : '/api/cart  —  empty = every URL'} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="label">Methods</span>
          {METHODS.map((meth) => (
            <label key={meth} className="inline-flex items-center gap-0.5">
              <input type="checkbox" data-testid={`match-method-${meth}`} checked={!!m.methods?.includes(meth)} onChange={() => toggleMethod(meth)} /> {meth}
            </label>
          ))}
          <span className="text-slate-400">(none checked = all)</span>
        </div>
        <Field label="Site" hint="Only calls made by pages (or frames) on this domain. Empty = every site.">
          <input data-testid="match-site" className="input mono w-72" list="known-sites" value={m.site || ''} onChange={(e) => setMatch({ site: e.target.value })} placeholder="mystore.myshopify.com" />
          <datalist id="known-sites">{sites.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
      </fieldset>

      <fieldset className="rounded border border-slate-200 p-2 dark:border-zinc-700">
        <legend className="label px-1">{RULE_TYPES[rule.type]?.label}</legend>
        <ConfigForm rule={rule} setConfig={(config) => setRule({ ...rule, config })} />
      </fieldset>

      {error && <div className="text-rose-600" data-testid="rule-error">{error}</div>}
      <div className="flex gap-1">
        <button type="button" className="btn-primary" data-testid="rule-save" onClick={save}>Save rule</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
