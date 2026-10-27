// Side panel to create or edit one rule.
import { useEffect, useState } from 'react';
import { METHODS, RULE_TYPES, UA_PRESETS, defaultConfig, normalizeSite, validateRule } from '../../shared/rules.js';
import { KeyValueEditor } from '../../ui/components.jsx';
import { Icon } from '../../ui/icons.jsx';
import { TypeIcon } from '../../ui/ruleMeta.jsx';

function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-fg-3">{hint}</span>}
    </label>
  );
}

function Section({ title, children, hint }) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="eyebrow">{title}</h3>
        {hint && <p className="mt-0.5 text-[11px] text-fg-3">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Choice({ checked, onChange, children, testId }) {
  return (
    <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 ${checked ? 'border-accent/50 bg-accent-soft text-accent-fg' : 'border-line hover:bg-subtle'}`}>
      <input type="radio" data-testid={testId} className="accent-[var(--accent)]" checked={checked} onChange={onChange} />
      {children}
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
        <div className="space-y-3">
          <Field label="Request headers"><KeyValueEditor testId="cfg-req-headers" ops={HEADER_OPS} rows={c.request} onChange={(request) => set({ request })} /></Field>
          <Field label="Response headers"><KeyValueEditor testId="cfg-res-headers" ops={HEADER_OPS} rows={c.response} onChange={(response) => set({ response })} /></Field>
        </div>
      );
    case 'block':
      return <p className="text-fg-2">Matching calls fail and are never sent.</p>;
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
        <div className="space-y-2.5">
          <div className="flex gap-1.5">
            <Choice checked={c.mode !== 'js'} onChange={() => set({ mode: 'fixed' })}>Fixed body</Choice>
            <Choice testId="cfg-mode-js" checked={c.mode === 'js'} onChange={() => set({ mode: 'js' })}>JS function</Choice>
          </div>
          {c.mode === 'js' ? (
            <Field label="function (body, request) {" hint="body is the text. Return new text or an object (sent as JSON). Return nothing to keep it.">
              <textarea data-testid="cfg-code" className="input mono h-36" value={c.code || ''} onChange={(e) => set({ code: e.target.value })} />
            </Field>
          ) : (
            <Field label="New body"><textarea data-testid="cfg-value" className="input mono h-36" value={c.value || ''} onChange={(e) => set({ value: e.target.value })} placeholder='{"quantity": 999}' /></Field>
          )}
        </div>
      );
    case 'responseEdit':
      return (
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            <Choice checked={c.mode === 'merge' || !c.mode} onChange={() => set({ mode: 'merge' })}>Merge JSON</Choice>
            <Choice checked={c.mode === 'replace'} onChange={() => set({ mode: 'replace' })}>Replace body</Choice>
            <Choice testId="cfg-mode-js" checked={c.mode === 'js'} onChange={() => set({ mode: 'js' })}>JS function</Choice>
          </div>
          {c.mode === 'js' ? (
            <Field label="function (data, response, request) {" hint="data is the parsed JSON (or text). Return the new data.">
              <textarea data-testid="cfg-code" className="input mono h-36" value={c.code || ''} onChange={(e) => set({ code: e.target.value })} />
            </Field>
          ) : (
            <Field label={c.mode === 'replace' ? 'New body' : 'JSON to merge in'} hint={c.mode === 'replace' ? '' : 'Keys you give here replace the same keys in the real response.'}>
              <textarea data-testid="cfg-value" className="input mono h-36" value={c.value || ''} onChange={(e) => set({ value: e.target.value })} />
            </Field>
          )}
          <Field label="Status (optional)"><input data-testid="cfg-status" className="input w-28" value={c.status || ''} onChange={(e) => set({ status: e.target.value })} placeholder="keep" /></Field>
        </div>
      );
    case 'responseMock':
      return (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="label">Quick:</span>
            <button type="button" className="btn h-6 text-[11px]" onClick={() => set({ status: 500, body: '{"error":"Internal Server Error"}' })}>500 error</button>
            <button type="button" className="btn h-6 text-[11px]" onClick={() => set({ status: 429, body: '{"error":"Too Many Requests"}' })}>429 too many</button>
            <button type="button" className="btn h-6 text-[11px]" onClick={() => set({ status: 200, body: '{"items":[],"item_count":0,"total_price":0}' })}>Empty cart</button>
            <button type="button" className="btn h-6 text-[11px]" onClick={() => set({ status: 0 })}>Network error</button>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <Field label="Status" hint="0 = network error"><input data-testid="cfg-status" type="number" className="input" value={c.status ?? 200} onChange={(e) => set({ status: e.target.value === '' ? '' : Number(e.target.value) })} /></Field>
            <Field label="Content-Type"><input className="input mono" value={c.contentType || ''} onChange={(e) => set({ contentType: e.target.value })} /></Field>
          </div>
          <Field label="Extra headers"><KeyValueEditor rows={c.headers} onChange={(headers) => set({ headers })} /></Field>
          <Field label="Body"><textarea data-testid="cfg-body" className="input mono h-36" value={c.body ?? ''} onChange={(e) => set({ body: e.target.value })} /></Field>
        </div>
      );
    case 'delay':
      return <Field label="Wait (ms)"><input data-testid="cfg-ms" type="number" className="input w-36" value={c.ms ?? 1000} onChange={(e) => set({ ms: Number(e.target.value) })} /></Field>;
    case 'pause':
      return <p className="text-fg-2">Matching calls stop and wait. Edit them in DevTools → API Inspector (or the small window that opens), then Send or Drop.</p>;
    case 'insertScript':
      return (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Choice checked={c.kind !== 'css'} onChange={() => set({ kind: 'js' })}>JavaScript</Choice>
            <Choice testId="cfg-kind-css" checked={c.kind === 'css'} onChange={() => set({ kind: 'css' })}>CSS</Choice>
            <select className="input ml-auto" value={c.runAt || 'document_idle'} onChange={(e) => set({ runAt: e.target.value })}>
              <option value="document_start">Run at page start</option>
              <option value="document_end">Run when HTML is ready</option>
              <option value="document_idle">Run after load</option>
            </select>
          </div>
          <Field label={c.kind === 'css' ? 'CSS' : 'JavaScript'} hint="Uses the URL match on the page address.">
            <textarea data-testid="cfg-code" className="input mono h-44" value={c.code || ''} onChange={(e) => set({ code: e.target.value })} />
          </Field>
        </div>
      );
    case 'mapLocal':
      return (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line p-3">
            <Icon name="upload" size={16} className="text-fg-3" />
            <input
              type="file"
              data-testid="cfg-file"
              className="text-[11px] file:mr-2 file:rounded-md file:border file:border-line file:bg-surface file:px-2 file:py-1 file:text-fg"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const r = await fileToConfig(f);
                set({ ...r, fileName: f.name, contentType: f.type || guessType(f.name) });
              }}
            />
            {c.fileName && <span className="chip bg-muted text-fg-2">{c.fileName}{c.base64 ? ' (binary)' : ''}</span>}
            {c.base64 && <button type="button" className="btn-ghost h-6 text-[11px]" onClick={() => set({ base64: false, content: '', fileName: '' })}>Remove file</button>}
          </div>
          <Field label="Content-Type"><input data-testid="cfg-content-type" className="input mono w-64" value={c.contentType || ''} onChange={(e) => set({ contentType: e.target.value })} /></Field>
          {!c.base64 && (
            <Field label="…or paste the file content">
              <textarea data-testid="cfg-content" className="input mono h-44" value={c.content || ''} onChange={(e) => set({ content: e.target.value, fileName: '' })} />
            </Field>
          )}
        </div>
      );
    default:
      return null;
  }
}

export default function RuleEditor({ initial, groups, sites, currentSite, onSave, onCancel }) {
  const [rule, setRule] = useState(initial);
  const [error, setError] = useState('');
  const m = rule.match || {};
  const setMatch = (patch) => setRule({ ...rule, match: { ...m, ...patch } });
  const toggleMethod = (meth) => setMatch({ methods: m.methods?.includes(meth) ? m.methods.filter((x) => x !== meth) : [...(m.methods || []), meth] });
  const hideUrl = rule.type === 'mapRemote';
  const site = normalizeSite(m.site);
  const isNew = !initial.saved;

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const save = () => {
    const err = validateRule(rule);
    if (err) return setError(err);
    const { saved, ...clean } = rule;
    onSave(clean);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[1px]" onClick={onCancel} />
      <div className="slide-in relative flex h-full w-[620px] max-w-full flex-col border-l border-line bg-bg shadow-2xl" data-testid="rule-editor">
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <TypeIcon type={rule.type} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="eyebrow">{isNew ? 'New rule' : 'Edit rule'} · {RULE_TYPES[rule.type]?.id}</div>
            <div className="text-[15px] font-semibold">{RULE_TYPES[rule.type]?.label}</div>
            <div className="text-fg-2">{RULE_TYPES[rule.type]?.help}</div>
          </div>
          <button type="button" className="icon-btn" title="Close" onClick={onCancel}><Icon name="x" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-auto px-5 py-4">
          <Section title="Basics">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name" className="col-span-2"><input data-testid="rule-name" className="input" value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} /></Field>
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
          </Section>

          <Section title="Where it works" hint="A rule saved for a website only changes calls made by pages (or frames) on that website.">
            <div className="flex flex-wrap items-center gap-1.5">
              {currentSite && (
                <Choice testId="site-this" checked={site === currentSite} onChange={() => setMatch({ site: currentSite })}>
                  <Icon name="globe" size={12} /> Only on <span className="mono">{currentSite}</span>
                </Choice>
              )}
              <Choice testId="site-all" checked={!site} onChange={() => setMatch({ site: '' })}>All websites</Choice>
              <input
                data-testid="match-site"
                className="input mono w-56"
                list="known-sites"
                value={m.site || ''}
                onChange={(e) => setMatch({ site: e.target.value })}
                placeholder="or type a site, like mystore.myshopify.com"
              />
              <datalist id="known-sites">{sites.map((s) => <option key={s} value={s} />)}</datalist>
            </div>
            {!hideUrl && (
              <div className="flex items-end gap-2">
                <Field label="URL">
                  <select data-testid="match-type" className="input w-44" value={m.urlType || 'contains'} onChange={(e) => setMatch({ urlType: e.target.value })}>
                    <option value="contains">contains</option>
                    <option value="exact">is exactly</option>
                    <option value="wildcard">matches wildcard (*)</option>
                    <option value="regex">matches regex</option>
                  </select>
                </Field>
                <input data-testid="match-url" className="input mono min-w-0 flex-1" value={m.url || ''} onChange={(e) => setMatch({ url: e.target.value })} placeholder={rule.type === 'replace' ? '(optional) only URLs that contain this' : '/api/cart  —  empty = every URL'} />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1">
              <span className="label mr-1">Methods</span>
              {METHODS.map((meth) => {
                const on = !!m.methods?.includes(meth);
                return (
                  <label key={meth} className={`inline-flex cursor-pointer items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${on ? 'bg-accent-soft text-accent-fg ring-1 ring-accent/30' : 'text-fg-2 ring-1 ring-line hover:bg-subtle'}`}>
                    <input type="checkbox" className="sr-only" data-testid={`match-method-${meth}`} checked={on} onChange={() => toggleMethod(meth)} /> {meth}
                  </label>
                );
              })}
              <span className="ml-1 text-[11px] text-fg-3">(none = all)</span>
            </div>
          </Section>

          <Section title="What it does">
            <ConfigForm rule={rule} setConfig={(config) => setRule({ ...rule, config })} />
          </Section>
        </div>

        <div className="flex items-center gap-2 border-t border-line bg-subtle px-5 py-3">
          {error && <div className="flex min-w-0 flex-1 items-center gap-1.5 text-rose-600 dark:text-rose-400" data-testid="rule-error"><Icon name="alert" size={13} /><span>{error}</span></div>}
          <div className="ml-auto flex gap-1.5">
            <button type="button" className="btn" onClick={onCancel}>Cancel</button>
            <button type="button" className="btn-primary" data-testid="rule-save" onClick={save}><Icon name="check" size={13} /> Save rule</button>
          </div>
        </div>
      </div>
    </div>
  );
}
