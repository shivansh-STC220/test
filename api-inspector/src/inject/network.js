// Wraps fetch, XMLHttpRequest and sendBeacon to capture calls and apply page rules.
import {
  applyBefore, emitStart, finish, finishError, finishFromData, markRule, matchingRules, mockData,
  newCall, ruleError, runBodyRuleSync, runEditRule, setReqBody, update,
} from './apply.js';
import { currentClick, readyPromise, state } from './state.js';
import {
  bodyToText, bodyToTextSync, capText, captureStack, headersToObject, isBinaryType,
  parseRawHeaders, readCapped, resolveUrl, restoreBody,
} from './util.js';
import { STATUS_TEXT } from '../shared/rules.js';

const nativeFetch = window.fetch;
const nAddEL = EventTarget.prototype.addEventListener;
const nDispatch = EventTarget.prototype.dispatchEvent;

function abortError() {
  return new DOMException('The user aborted a request.', 'AbortError');
}

/* ---------------- fetch ---------------- */

function describeFetch(input, init) {
  const isReq = typeof Request !== 'undefined' && input instanceof Request;
  const url = isReq ? input.url : resolveUrl(input);
  const method = String((init && init.method) || (isReq ? input.method : 'GET')).toUpperCase();
  const headers = isReq ? headersToObject(input.headers) : {};
  if (init && init.headers) Object.assign(headers, headersToObject(init.headers));
  const hasInitBody = !!init && init.body != null;
  return { isReq, url, method, headers, rawBody: hasInitBody ? init.body : undefined, reqHasBody: isReq && !hasInitBody && input.body != null };
}

function fetchOptions(input, init, d, req) {
  const src = d.isReq ? input : {};
  const i = init || {};
  const pick = (k) => (i[k] !== undefined ? i[k] : src[k]);
  const opts = {
    method: req.method,
    headers: req.headers,
    credentials: pick('credentials'),
    cache: pick('cache'),
    redirect: pick('redirect'),
    referrer: pick('referrer'),
    referrerPolicy: pick('referrerPolicy'),
    integrity: pick('integrity'),
    keepalive: pick('keepalive'),
    signal: pick('signal'),
    mode: pick('mode') === 'navigate' ? 'same-origin' : pick('mode'),
    priority: i.priority,
  };
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body != null) opts.body = req.body;
  if (typeof ReadableStream !== 'undefined' && opts.body instanceof ReadableStream) opts.duplex = 'half';
  for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k];
  return opts;
}

function defineResponseProps(res, url, redirected) {
  try {
    Object.defineProperty(res, 'url', { configurable: true, value: url || '' });
    Object.defineProperty(res, 'redirected', { configurable: true, value: !!redirected });
    const clone = res.clone;
    Object.defineProperty(res, 'clone', {
      configurable: true,
      value() {
        const c = clone.call(this);
        defineResponseProps(c, url, redirected);
        return c;
      },
    });
  } catch {}
  return res;
}

const NULL_BODY = [101, 204, 205, 304];

function mockResponse(data, url) {
  const res = new Response(NULL_BODY.includes(data.status) ? null : data.bytes || data.text, {
    status: data.status,
    statusText: data.statusText || '',
    headers: data.headers,
  });
  return defineResponseProps(res, url, false);
}

function editedResponse(text, status, orig) {
  const headers = new Headers();
  orig.headers.forEach((v, k) => {
    if (k !== 'content-length' && k !== 'content-encoding') headers.append(k, v);
  });
  const res = new Response(NULL_BODY.includes(status) ? null : text, {
    status,
    statusText: status === orig.status ? orig.statusText : STATUS_TEXT[status] || '',
    headers,
  });
  return defineResponseProps(res, orig.url, orig.redirected);
}

function captureFetchResponse(call, res) {
  update(call, {
    status: res.status,
    statusText: res.statusText,
    finalUrl: res.url || call.url,
    resHeaders: headersToObject(res.headers),
    state: 'receiving',
  });
  const ct = res.headers.get('content-type') || '';
  if (!res.body) return finish(call, { resBody: res.type === 'opaque' ? '[opaque no-cors response]' : '', resBodySize: 0 });
  if (isBinaryType(ct)) return finish(call, { resBody: `[binary ${ct}]`, resBodySize: Number(res.headers.get('content-length')) || null });
  let copy;
  try { copy = res.clone(); } catch { return finish(call, {}); }
  readCapped(copy.body)
    .then((b) => finish(call, { resBody: b.text, resBodySize: b.size, resBodyTruncated: b.truncated }))
    .catch((e) => finish(call, { resBodyError: e.message }));
}

export async function handleFetch(input, init, type = 'fetch') {
  const stack = captureStack();
  const click = currentClick();
  let d;
  try {
    d = describeFetch(input, init);
  } catch {
    return nativeFetch.call(window, input, init);
  }
  const call = newCall(type, d.method, d.url, d.headers, stack, click);
  if (!state.ready) await readyPromise;
  let raw = d.rawBody;
  if (d.reqHasBody) {
    try { raw = await input.clone().blob(); } catch {}
  }
  let bodyText = null;
  try { bodyText = await bodyToText(raw); } catch {}
  setReqBody(call, bodyText);
  const matched = matchingRules(d.url, d.method);
  emitStart(call);

  const req = { url: d.url, method: d.method, headers: { ...d.headers }, body: raw, bodyText };
  const signal = (init && init.signal) || (d.isReq ? input.signal : null);
  let before = { changed: false };
  if (matched.length) {
    before = await applyBefore(call, req, matched);
    if (before.dropped) {
      finishError(call, 'Dropped (pause rule)');
      throw new TypeError('Failed to fetch');
    }
    if (signal && signal.aborted) {
      finishError(call, 'Aborted');
      throw signal.reason || abortError();
    }
    const mockRule = matched.find((r) => r.type === 'responseMock' || r.type === 'mapLocal');
    if (mockRule) {
      markRule(call, mockRule);
      const data = mockData(mockRule);
      if (data.networkError) {
        finishError(call, 'Mocked network error');
        throw new TypeError('Failed to fetch');
      }
      finishFromData(call, { ...data, url: req.url }, { mocked: true });
      return mockResponse(data, req.url);
    }
  }

  let res;
  try {
    res = before.changed
      ? await nativeFetch.call(window, req.url, fetchOptions(input, init, d, req))
      : await nativeFetch.call(window, input, init);
  } catch (e) {
    finishError(call, e);
    throw e;
  }

  const editRule = matched.find((r) => r.type === 'responseEdit');
  if (editRule && res.body) {
    try {
      const text = await res.clone().text();
      const out = await runEditRule(editRule, text, res, req);
      res = editedResponse(out.text, out.status, res);
      markRule(call, editRule);
    } catch (e) {
      ruleError(call, editRule, e);
    }
  }
  captureFetchResponse(call, res);
  return res;
}

export function installFetch() {
  if (typeof nativeFetch !== 'function') return;
  window.fetch = function fetch(input, init) {
    return handleFetch(input, init, 'fetch');
  };
}

/* ---------------- XMLHttpRequest ---------------- */

const XHR = window.XMLHttpRequest;
const P = XHR && XHR.prototype;
const nOpen = P && P.open;
const nSend = P && P.send;
const nSetRH = P && P.setRequestHeader;
const nAbort = P && P.abort;
const getter = (name) => P && Object.getOwnPropertyDescriptor(P, name).get;
const gStatus = getter('status');
const gStatusText = getter('statusText');
const gResponseURL = getter('responseURL');
const gResponse = getter('response');
const gResponseText = getter('responseText');
const gResponseType = getter('responseType');
const nGetAllHeaders = P && P.getAllResponseHeaders;

const info = new WeakMap();
const listening = new WeakSet();
const SIM_PROPS = ['readyState', 'status', 'statusText', 'response', 'responseText', 'responseURL', 'responseXML', 'getAllResponseHeaders', 'getResponseHeader'];

function clearSim(xhr) {
  for (const k of SIM_PROPS) if (Object.prototype.hasOwnProperty.call(xhr, k)) delete xhr[k];
}

function xhrResponseText(xhr) {
  const rt = gResponseType.call(xhr);
  try {
    if (rt === '' || rt === 'text') return gResponseText.call(xhr);
    const r = gResponse.call(xhr);
    if (r == null) return '';
    if (rt === 'json') return JSON.stringify(r);
    if (rt === 'document') return new XMLSerializer().serializeToString(r);
    if (rt === 'arraybuffer') return r.byteLength > 2 * 1024 * 1024 ? `[binary ${r.byteLength} B]` : new TextDecoder().decode(r);
    if (rt === 'blob') return `[Blob ${r.type} ${r.size} B]`;
  } catch {}
  return null;
}

function onNativeEnd(xhr) {
  const s = info.get(xhr);
  if (!s || !s.call || s.simulated || s.done) return;
  s.done = true;
  const call = s.call;
  const status = gStatus.call(xhr);
  if (!status) return finishError(call, s.reason || 'Network error');
  const b = capText(xhrResponseText(xhr));
  finish(call, {
    status,
    statusText: gStatusText.call(xhr),
    finalUrl: gResponseURL.call(xhr) || call.url,
    resHeaders: parseRawHeaders(nGetAllHeaders.call(xhr)),
    resBody: b.text,
    resBodySize: b.size,
    resBodyTruncated: b.truncated,
  });
}

function listen(xhr) {
  if (listening.has(xhr)) return;
  listening.add(xhr);
  const reason = (r) => () => { const s = info.get(xhr); if (s) s.reason = r; };
  nAddEL.call(xhr, 'abort', reason('Aborted'));
  nAddEL.call(xhr, 'timeout', reason('Timeout'));
  nAddEL.call(xhr, 'error', reason('Network error'));
  nAddEL.call(xhr, 'loadend', () => onNativeEnd(xhr));
}

// Make the page's XHR look like it got this response, then fire its events.
function simulateResponse(xhr, { status, statusText, headers, text, bytes, url }) {
  const rt = gResponseType.call(xhr);
  const lower = {};
  for (const [k, v] of Object.entries(headers || {})) lower[k.toLowerCase()] = String(v);
  let response;
  if (rt === '' || rt === 'text') response = text;
  else if (rt === 'json') { try { response = JSON.parse(text); } catch { response = null; } }
  else if (rt === 'blob') response = new Blob([bytes || text], { type: lower['content-type'] || '' });
  else if (rt === 'arraybuffer') response = (bytes || new TextEncoder().encode(text)).buffer;
  else if (rt === 'document') response = new DOMParser().parseFromString(text, /xml/.test(lower['content-type'] || '') ? 'application/xml' : 'text/html');
  const raw = Object.entries(lower).map(([k, v]) => `${k}: ${v}`).join('\r\n');
  let rs = 1;
  const def = (k, get) => Object.defineProperty(xhr, k, { configurable: true, get });
  def('readyState', () => rs);
  def('status', () => (rs >= 2 ? status : 0));
  def('statusText', () => (rs >= 2 ? statusText || '' : ''));
  def('responseURL', () => (rs >= 2 ? url : ''));
  def('response', () => (rs === 4 ? response : rt === '' || rt === 'text' ? (rs === 3 ? text : '') : null));
  def('responseText', () => {
    if (rt !== '' && rt !== 'text') {
      throw new DOMException(`The value is only accessible if the object's 'responseType' is '' or 'text' (was '${rt}').`, 'InvalidStateError');
    }
    return rs >= 3 ? text : '';
  });
  def('responseXML', () => (rs === 4 && rt === 'document' ? response : null));
  Object.defineProperty(xhr, 'getAllResponseHeaders', { configurable: true, value: () => (rs >= 2 && raw ? raw + '\r\n' : '') });
  Object.defineProperty(xhr, 'getResponseHeader', { configurable: true, value: (n) => (rs >= 2 ? lower[String(n).toLowerCase()] ?? null : null) });
  const total = bytes ? bytes.length : (text || '').length;
  const fire = (type, progress) => nDispatch.call(xhr, progress ? new ProgressEvent(type, { lengthComputable: true, loaded: total, total }) : new Event(type));
  setTimeout(() => {
    fire('loadstart', true);
    rs = 2; fire('readystatechange');
    rs = 3; fire('readystatechange'); fire('progress', true);
    rs = 4; fire('readystatechange'); fire('load', true); fire('loadend', true);
  }, 0);
}

function simulateFailure(xhr, kind = 'error') {
  let rs = 4;
  const def = (k, get) => Object.defineProperty(xhr, k, { configurable: true, get });
  def('readyState', () => rs);
  def('status', () => 0);
  def('statusText', () => '');
  def('response', () => (gResponseType.call(xhr) === '' || gResponseType.call(xhr) === 'text' ? '' : null));
  def('responseText', () => '');
  const fire = (type, progress) => nDispatch.call(xhr, progress ? new ProgressEvent(type) : new Event(type));
  setTimeout(() => {
    fire('readystatechange');
    fire(kind, true);
    fire('loadend', true);
    if (kind === 'abort') rs = 0;
  }, 0);
}

function reopen(xhr, s, req) {
  const wc = xhr.withCredentials;
  const to = xhr.timeout;
  const rt = gResponseType.call(xhr);
  nOpen.call(xhr, req.method, req.url, true, s.user, s.password);
  for (const [k, v] of Object.entries(req.headers)) {
    try { nSetRH.call(xhr, k, v); } catch {}
  }
  xhr.withCredentials = wc;
  xhr.timeout = to;
  try { xhr.responseType = rt; } catch {}
}

async function sendWithRules(xhr, s, body) {
  const call = s.call;
  if (!state.ready) await readyPromise;
  const matched = matchingRules(s.url, s.method);
  let bodyText = null;
  try { bodyText = await bodyToText(body); } catch {}
  setReqBody(call, bodyText);
  emitStart(call);
  if (s.aborted) return finishError(call, 'Aborted');

  const req = { url: s.url, method: s.method, headers: { ...s.headers }, body, bodyText };
  const before = await applyBefore(call, req, matched);
  if (s.aborted) return finishError(call, 'Aborted');
  if (before.dropped) {
    s.waiting = false;
    s.simulated = true;
    simulateFailure(xhr);
    return finishError(call, 'Dropped (pause rule)');
  }
  const mockRule = matched.find((r) => r.type === 'responseMock' || r.type === 'mapLocal');
  if (mockRule) {
    s.waiting = false;
    s.simulated = true;
    markRule(call, mockRule);
    const data = mockData(mockRule);
    if (data.networkError) {
      simulateFailure(xhr);
      return finishError(call, 'Mocked network error');
    }
    simulateResponse(xhr, { ...data, url: req.url });
    return finishFromData(call, { ...data, url: req.url }, { mocked: true });
  }
  const editRule = matched.find((r) => r.type === 'responseEdit');
  const rt = gResponseType.call(xhr);
  if (editRule && (rt === '' || rt === 'text' || rt === 'json')) {
    // Do the real call on a hidden XHR, edit the result, then hand it to the page's XHR.
    s.waiting = false;
    s.simulated = true;
    const inner = new XHR();
    s.inner = inner;
    nOpen.call(inner, req.method, req.url, true, s.user, s.password);
    for (const [k, v] of Object.entries(req.headers)) {
      try { nSetRH.call(inner, k, v); } catch {}
    }
    inner.withCredentials = xhr.withCredentials;
    inner.timeout = xhr.timeout;
    nAddEL.call(inner, 'loadend', () => { s.inner = null; });
    nAddEL.call(inner, 'load', async () => {
      const text = gResponseText.call(inner);
      const headers = parseRawHeaders(nGetAllHeaders.call(inner));
      const real = { status: gStatus.call(inner), headers, url: gResponseURL.call(inner) };
      let out = { text, status: real.status };
      try {
        out = await runEditRule(editRule, text, real, req);
        markRule(call, editRule);
      } catch (e) {
        ruleError(call, editRule, e);
      }
      delete headers['content-length'];
      delete headers['content-encoding'];
      const data = { status: out.status, statusText: out.status === real.status ? gStatusText.call(inner) : STATUS_TEXT[out.status] || '', headers, text: out.text, url: real.url || req.url };
      simulateResponse(xhr, data);
      finishFromData(call, data);
    });
    nAddEL.call(inner, 'error', () => { simulateFailure(xhr); finishError(call, 'Network error'); });
    nAddEL.call(inner, 'timeout', () => { simulateFailure(xhr, 'timeout'); finishError(call, 'Timeout'); });
    nSend.call(inner, req.body ?? null);
    return;
  }
  s.waiting = false;
  if (before.changed) reopen(xhr, s, req);
  nSend.call(xhr, req.body ?? null);
}

export function installXhr() {
  if (!XHR) return;
  P.open = function open(method, url, async) {
    clearSim(this);
    info.set(this, {
      method: String(method).toUpperCase(),
      url: resolveUrl(url),
      async: arguments.length < 3 ? true : !!async,
      user: arguments[3],
      password: arguments[4],
      headers: {},
    });
    return nOpen.apply(this, arguments);
  };

  P.setRequestHeader = function setRequestHeader(name, value) {
    const s = info.get(this);
    if (s) {
      const k = String(name);
      s.headers[k] = s.headers[k] != null ? `${s.headers[k]}, ${value}` : String(value);
    }
    return nSetRH.apply(this, arguments);
  };

  P.abort = function abort() {
    const s = info.get(this);
    if (s && s.inner) nAbort.call(s.inner);
    if (s && (s.waiting || s.inner)) {
      s.aborted = true;
      s.waiting = false;
      s.simulated = true;
      if (s.call) finishError(s.call, 'Aborted');
      simulateFailure(this, 'abort');
      return undefined;
    }
    return nAbort.apply(this, arguments);
  };

  P.send = function send(body) {
    const s = info.get(this);
    if (!s) return nSend.apply(this, arguments);
    const stack = captureStack();
    const call = newCall('xhr', s.method, s.url, { ...s.headers }, stack, currentClick());
    Object.assign(s, { call, simulated: false, aborted: false, done: false, reason: null, inner: null });
    listen(this);

    // Sync XHR and calls with no rules go out right away, like normal.
    if (!s.async || (state.ready && !matchingRules(s.url, s.method).length)) {
      const t = bodyToTextSync(body);
      setReqBody(call, t);
      emitStart(call);
      if (t == null && body != null) {
        bodyToText(body).then((txt) => { setReqBody(call, txt); update(call, { reqBody: call.reqBody, reqBodySize: call.reqBodySize, reqBodyTruncated: call.reqBodyTruncated }); }).catch(() => {});
      }
      return nSend.apply(this, arguments);
    }
    s.waiting = true;
    sendWithRules(this, s, body).catch((e) => {
      s.waiting = false;
      finishError(call, e);
    });
    return undefined;
  };
}

/* ---------------- sendBeacon ---------------- */

export function installBeacon() {
  const nBeacon = navigator.sendBeacon;
  if (typeof nBeacon !== 'function') return;
  navigator.sendBeacon = function sendBeacon(url, data) {
    const stack = captureStack();
    const abs = resolveUrl(url);
    const call = newCall('beacon', 'POST', abs, {}, stack, currentClick());
    let body = data;
    const matched = state.ready ? matchingRules(abs, 'POST') : [];
    const bodyRule = matched.find((r) => r.type === 'requestBody');
    const text = bodyToTextSync(data);
    if (bodyRule && (data == null || typeof data === 'string' || data instanceof URLSearchParams)) {
      try {
        const out = runBodyRuleSync(bodyRule, { url: abs, method: 'POST', headers: {}, bodyText: text ?? '' });
        if (out !== undefined) {
          body = restoreBody(typeof out === 'string' ? out : JSON.stringify(out), data);
          markRule(call, bodyRule);
        }
      } catch (e) {
        ruleError(call, bodyRule, e);
      }
    }
    const ok = nBeacon.call(navigator, url, body);
    bodyToText(body)
      .catch(() => null)
      .then((t) => {
        setReqBody(call, t);
        emitStart(call);
        finish(call, { status: ok ? 'queued' : 'failed' });
      });
    return ok;
  };
}
