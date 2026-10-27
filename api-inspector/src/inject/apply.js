// Call records and page rules (request body, response edit / mock, delay, pause, map local).
import { deepMerge, ruleMatchesRequest, STATUS_TEXT } from '../shared/rules.js';
import { FNS_KEY } from '../shared/bridge.js';
import { b64ToBytes, capText, isBinaryType, pickSource, restoreBody, resolveUrl, sleep, uid } from './util.js';
import { post, state } from './state.js';

const frame = () => ({ url: location.href, top: window === window.top });

export function newCall(type, method, url, headers, stack, click) {
  return {
    id: uid(),
    type,
    method,
    url,
    start: Date.now(),
    state: 'pending',
    reqHeaders: headers || {},
    stack,
    source: pickSource(stack),
    click,
    frame: frame(),
    rules: [],
    ruleErrors: [],
  };
}

export function send(call, data) {
  post({ type: 'call', id: call.id, data });
}

export function emitStart(call) {
  send(call, { ...call });
}

export function update(call, data) {
  Object.assign(call, data);
  send(call, data);
}

export function setReqBody(call, text) {
  const b = capText(text);
  call.reqBody = b.text;
  call.reqBodySize = b.size;
  call.reqBodyTruncated = b.truncated;
}

export function finish(call, data = {}) {
  const end = Date.now();
  update(call, { state: 'done', end, duration: end - call.start, ...data });
}

export function finishError(call, err) {
  const end = Date.now();
  const msg = typeof err === 'string' ? err : (err && (err.name === 'AbortError' ? 'Aborted' : err.message)) || String(err);
  update(call, { state: 'error', error: msg, end, duration: end - call.start });
}

export function markRule(call, rule) {
  if (call.rules.some((r) => r.id === rule.id)) return;
  call.rules.push({ id: rule.id, name: rule.name, type: rule.type, layer: 'page' });
  send(call, { rules: call.rules });
  post({ type: 'rule-hit', ruleId: rule.id, name: rule.name, url: call.url });
}

export function ruleError(call, rule, e) {
  call.ruleErrors.push(`${rule.name}: ${e && e.message ? e.message : e}`);
  send(call, { ruleErrors: call.ruleErrors });
}

export function matchingRules(url, method) {
  return state.rules.filter((r) => r.type !== 'userAgent' && ruleMatchesRequest(r, url, method, location.hostname));
}

const fnCache = new Map();

// Turn the code you typed into a function. If the page's CSP blocks that,
// use the copy the extension added with user scripts.
function compileFn(rule, params, code) {
  const key = rule.id + '\u0000' + code;
  if (fnCache.has(key)) return fnCache.get(key);
  let fn;
  try {
    fn = new Function(...params, code); // eslint-disable-line no-new-func
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error(`Code error: ${e.message}`);
    const reg = window[Symbol.for(FNS_KEY)];
    fn = reg && reg[rule.id];
    if (typeof fn !== 'function') {
      throw new Error('This page blocks JS code (CSP). Turn on "Allow User Scripts" for API Inspector, then reload.');
    }
  }
  fnCache.set(key, fn);
  return fn;
}

export async function runBodyRule(rule, req) {
  const c = rule.config || {};
  if (c.mode === 'js') {
    const fn = compileFn(rule, ['body', 'request'], c.code || '');
    return fn(req.bodyText ?? '', { url: req.url, method: req.method, headers: { ...req.headers } });
  }
  return c.value ?? '';
}

export function runBodyRuleSync(rule, req) {
  const c = rule.config || {};
  if (c.mode === 'js') {
    const fn = compileFn(rule, ['body', 'request'], c.code || '');
    const out = fn(req.bodyText ?? '', { url: req.url, method: req.method, headers: { ...req.headers } });
    if (out && typeof out.then === 'function') throw new Error('Beacons can not wait for async code.');
    return out;
  }
  return c.value ?? '';
}

export async function runEditRule(rule, text, res, req) {
  const c = rule.config || {};
  const status = c.status ? Number(c.status) : res.status;
  let out = text;
  if (c.mode === 'replace') {
    out = c.value ?? '';
  } else if (c.mode === 'js') {
    let data = text;
    try { data = JSON.parse(text); } catch {}
    const fn = compileFn(rule, ['data', 'response', 'request'], c.code || '');
    const r = await fn(data, { status: res.status, headers: res.headers, url: res.url, text }, { url: req.url, method: req.method, headers: req.headers, body: req.bodyText });
    if (r !== undefined) out = typeof r === 'string' ? r : JSON.stringify(r);
  } else {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('Response is not JSON, so merge was skipped.'); }
    out = JSON.stringify(deepMerge(data, JSON.parse(c.value || '{}')));
  }
  return { text: out, status };
}

// Fake response data for "Response - mock" and "Map local".
export function mockData(rule) {
  const c = rule.config || {};
  if (rule.type === 'mapLocal') {
    const ct = c.contentType || 'text/plain';
    const headers = { 'content-type': ct };
    if (c.base64) {
      const bytes = b64ToBytes(c.content);
      return { status: 200, statusText: 'OK', headers, bytes, text: isBinaryType(ct) ? `[binary ${bytes.length} B]` : new TextDecoder().decode(bytes) };
    }
    return { status: 200, statusText: 'OK', headers, text: c.content || '' };
  }
  const s = Number(c.status);
  if (s === 0) return { networkError: true };
  const headers = { 'content-type': c.contentType || 'application/json' };
  for (const h of c.headers || []) if (h.name) headers[h.name.toLowerCase()] = String(h.value ?? '');
  return { status: s, statusText: STATUS_TEXT[s] || '', headers, text: c.body ?? '' };
}

export function finishFromData(call, data, extra = {}) {
  const b = capText(data.text);
  finish(call, {
    status: data.status,
    statusText: data.statusText,
    finalUrl: data.url || call.url,
    resHeaders: data.headers,
    resBody: b.text,
    resBodySize: data.bytes ? data.bytes.length : b.size,
    resBodyTruncated: b.truncated,
    ...extra,
  });
}

// Pause & edit: wait for Send or Drop from the extension.
const pauses = new Map();

const PAUSE_LIMIT = 5 * 60 * 1000 + 5000;

export function pauseCall(call, req, rule) {
  return new Promise((resolve) => {
    pauses.set(call.id, resolve);
    // Safety net if the extension never answers (for example, it was reloaded): send as is.
    setTimeout(() => resolvePause(call.id, { action: 'send' }), PAUSE_LIMIT);
    post({
      type: 'pause',
      id: call.id,
      ruleName: rule.name,
      request: { method: req.method, url: req.url, headers: req.headers, body: req.bodyText ?? '' },
    });
  });
}

export function resolvePause(id, decision) {
  const r = pauses.get(id);
  if (r) {
    pauses.delete(id);
    r(decision || { action: 'send' });
  }
}

// Steps that run before the call goes out: pause, request body, delay.
// Changes "req" in place. Returns { changed, dropped }.
export async function applyBefore(call, req, matched) {
  let changed = false;
  const pauseRule = matched.find((r) => r.type === 'pause');
  if (pauseRule) {
    markRule(call, pauseRule);
    update(call, { state: 'paused' });
    const d = await pauseCall(call, req, pauseRule);
    if (d.action === 'drop') return { dropped: true, changed };
    const e = d.request || {};
    if (e.url && resolveUrl(e.url) !== req.url) { req.url = resolveUrl(e.url); changed = true; }
    if (e.method && e.method.toUpperCase() !== req.method) { req.method = e.method.toUpperCase(); changed = true; }
    if (e.headers && JSON.stringify(e.headers) !== JSON.stringify(req.headers)) { req.headers = { ...e.headers }; changed = true; }
    if (typeof e.body === 'string' && e.body !== (req.bodyText ?? '')) {
      req.body = restoreBody(e.body, req.body);
      req.bodyText = e.body;
      changed = true;
    }
    update(call, { state: 'pending' });
  }
  const bodyRule = matched.find((r) => r.type === 'requestBody');
  if (bodyRule) {
    try {
      const out = await runBodyRule(bodyRule, req);
      if (out !== undefined) {
        req.bodyText = typeof out === 'string' ? out : JSON.stringify(out);
        req.body = restoreBody(req.bodyText, req.body);
        changed = true;
        markRule(call, bodyRule);
      }
    } catch (e) {
      ruleError(call, bodyRule, e);
    }
  }
  const delayRule = matched.find((r) => r.type === 'delay');
  if (delayRule) {
    markRule(call, delayRule);
    await sleep(Number(delayRule.config?.ms) || 0);
  }
  if (changed) {
    const b = capText(req.bodyText);
    update(call, {
      originalUrl: call.originalUrl || call.url,
      url: req.url,
      method: req.method,
      reqHeaders: req.headers,
      reqBody: b.text,
      reqBodySize: b.size,
      reqBodyTruncated: b.truncated,
      edited: true,
    });
  }
  return { changed, dropped: false };
}
