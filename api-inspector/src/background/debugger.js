// Debugger mode (C3): catch requests at network level with the Chrome debugger.
// fetch / XHR are already handled in the page, so here we handle the rest,
// like a theme's plain <form action="/cart/add"> post.
import { deepMerge, ruleMatchesRequest, STATUS_TEXT } from '../shared/rules.js';
import { BODY_CAP } from '../shared/bridge.js';

const tabs = new Map(); // tabId -> { rows: Map(networkId -> [{ id, url }]) }
let ctx = null;

const cmd = (target, method, params = {}) => chrome.debugger.sendCommand(target, method, params);

// Only types the debugger's fetch filter accepts (TextTrack, Manifest, ... are refused).
const REQUEST_TYPES = ['Document', 'Stylesheet', 'Image', 'Media', 'Font', 'Script', 'EventSource', 'CSPViolationReport', 'Other'];
const RESPONSE_TYPES = ['Document', 'Other'];

function patterns() {
  return [
    ...REQUEST_TYPES.map((resourceType) => ({ urlPattern: '*', resourceType, requestStage: 'Request' })),
    ...RESPONSE_TYPES.map((resourceType) => ({ urlPattern: '*', resourceType, requestStage: 'Response' })),
  ];
}

export function initDebugger(context) {
  ctx = context;
  chrome.debugger.onEvent.addListener((source, method, params) => {
    onEvent(source, method, params).catch((e) => console.warn('[API Inspector] debugger event', method, e));
  });
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId != null && tabs.delete(source.tabId)) ctx.onState(source.tabId);
  });
}

export function debuggerOn(tabId) {
  return tabs.has(tabId);
}

export async function restoreDebuggerState() {
  // The worker may have restarted while the debugger stayed attached.
  const { debuggerTabs = [] } = await chrome.storage.session.get('debuggerTabs');
  const targets = await chrome.debugger.getTargets();
  for (const t of targets) {
    if (t.attached && t.tabId != null && debuggerTabs.includes(t.tabId) && !tabs.has(t.tabId)) tabs.set(t.tabId, { rows: new Map() });
  }
}

async function saveTabs() {
  await chrome.storage.session.set({ debuggerTabs: [...tabs.keys()] });
}

async function setup(target) {
  await cmd(target, 'Network.enable', { maxPostDataSize: BODY_CAP }).catch(() => {});
  await cmd(target, 'Fetch.enable', { patterns: patterns() });
  await cmd(target, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }).catch(() => {});
}

export async function enableDebugger(tabId) {
  if (tabs.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  tabs.set(tabId, { rows: new Map() });
  try {
    await setup({ tabId });
  } catch (e) {
    tabs.delete(tabId);
    await chrome.debugger.detach({ tabId }).catch(() => {});
    throw e;
  }
  await saveTabs();
  ctx.onState(tabId);
}

export async function disableDebugger(tabId) {
  const had = tabs.delete(tabId);
  await chrome.debugger.detach({ tabId }).catch(() => {});
  await saveTabs();
  if (had) ctx.onState(tabId);
}

/* ---------- helpers ---------- */

function b64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function unb64(s) {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

function lowerHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) out[k.toLowerCase()] = v;
  return out;
}

const toHeaderList = (obj) => Object.entries(obj).map(([name, value]) => ({ name, value: String(value) }));

// Run the JS code of a rule inside the page (the service worker can't run typed code).
async function runInPage(tabId, rule, params, args) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [rule.id, params, rule.config?.code || '', args],
    func: async (ruleId, ps, code, as) => {
      let fn;
      try {
        fn = new Function(...ps, code); // eslint-disable-line no-new-func
      } catch (e) {
        const reg = window[Symbol.for('api-inspector-fns')];
        fn = reg && reg[ruleId];
        if (!fn) throw e;
      }
      const out = await fn(...as);
      return out === undefined ? { keep: true } : { value: typeof out === 'string' ? out : JSON.stringify(out) };
    },
  });
  if (!r || !r.result) throw new Error('Could not run the code in the page.');
  return r.result;
}

/* ---------- events ---------- */

async function onEvent(source, method, params) {
  const t = tabs.get(source.tabId);
  if (!t) return;
  const target = source.sessionId ? { tabId: source.tabId, sessionId: source.sessionId } : { tabId: source.tabId };
  switch (method) {
    case 'Target.attachedToTarget': {
      const child = { tabId: source.tabId, sessionId: params.sessionId };
      if (['iframe', 'page'].includes(params.targetInfo?.type)) await setup(child).catch(() => {});
      await cmd(child, 'Runtime.runIfWaitingForDebugger').catch(() => {});
      return;
    }
    case 'Fetch.requestPaused':
      return onPaused(target, t, params);
    case 'Network.requestWillBeSent':
      if (params.redirectResponse) {
        const row = findRow(t, params.requestId, params.redirectResponse.url);
        if (row) {
          ctx.saveCall(source.tabId, row.id, {
            status: params.redirectResponse.status,
            statusText: params.redirectResponse.statusText,
            resHeaders: lowerHeaders(params.redirectResponse.headers),
            state: 'done',
            end: Date.now(),
            duration: Date.now() - row.start,
          });
          row.closed = true;
        }
      }
      return;
    case 'Network.responseReceived': {
      const row = findRow(t, params.requestId, params.response.url);
      if (row) {
        ctx.saveCall(source.tabId, row.id, {
          status: params.response.status,
          statusText: params.response.statusText,
          resHeaders: lowerHeaders(params.response.headers),
          finalUrl: params.response.url,
          state: 'receiving',
        });
        row.waitingBody = true;
      }
      return;
    }
    case 'Network.loadingFinished': {
      const row = findRow(t, params.requestId);
      if (!row) return;
      row.closed = true;
      let body = null;
      try {
        const r = await cmd(target, 'Network.getResponseBody', { requestId: params.requestId });
        body = r.base64Encoded ? '[binary body]' : r.body;
      } catch {}
      ctx.saveCall(source.tabId, row.id, {
        state: 'done',
        end: Date.now(),
        duration: Date.now() - row.start,
        resBody: body == null ? null : body.slice(0, BODY_CAP),
        resBodyTruncated: body != null && body.length > BODY_CAP,
        resBodySize: params.encodedDataLength,
      });
      return;
    }
    case 'Network.loadingFailed': {
      const row = findRow(t, params.requestId);
      if (!row) return;
      row.closed = true;
      ctx.saveCall(source.tabId, row.id, { state: 'error', error: params.errorText || 'Failed', end: Date.now(), duration: Date.now() - row.start });
    }
  }
}

function findRow(t, networkId, url) {
  const list = t.rows.get(networkId);
  if (!list) return null;
  const open = list.filter((r) => !r.closed);
  if (url) return open.find((r) => r.url === url) || null;
  return open[open.length - 1] || null;
}

function debuggerRules(state) {
  return state.active.filter((r) => ['requestBody', 'responseEdit', 'responseMock', 'delay', 'pause'].includes(r.type));
}

async function onPaused(target, t, p) {
  const tabId = target.tabId;
  const state = await ctx.getState();
  const { request } = p;
  const headers = request.headers || {};
  const lh = lowerHeaders(headers);
  const tabUrl = await ctx.tabUrl(tabId);
  const initiatorHost = hostOf(lh.origin || lh.referer || '') || hostOf(tabUrl);
  const matched = debuggerRules(state).filter((r) => ruleMatchesRequest(r, request.url, request.method, initiatorHost));
  const isResponse = p.responseStatusCode != null || p.responseErrorReason != null;

  if (isResponse) {
    const editRule = matched.find((r) => r.type === 'responseEdit');
    const redirect = p.responseStatusCode >= 300 && p.responseStatusCode < 400;
    if (!editRule || p.responseErrorReason || redirect) return cmd(target, 'Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
    try {
      const r = await cmd(target, 'Fetch.getResponseBody', { requestId: p.requestId });
      const text = r.base64Encoded ? unb64(r.body) : r.body;
      const c = editRule.config || {};
      let out = text;
      if (c.mode === 'replace') out = c.value ?? '';
      else if (c.mode === 'merge') out = JSON.stringify(deepMerge(JSON.parse(text), JSON.parse(c.value || '{}')));
      else {
        let data = text;
        try { data = JSON.parse(text); } catch {}
        const res = await runInPage(tabId, editRule, ['data', 'response', 'request'], [data, { status: p.responseStatusCode, url: request.url, text }, { url: request.url, method: request.method }]);
        if (!res.keep) out = res.value;
      }
      const status = c.status ? Number(c.status) : p.responseStatusCode;
      const resHeaders = (p.responseHeaders || []).filter((h) => !/^(content-length|content-encoding)$/i.test(h.name));
      await cmd(target, 'Fetch.fulfillRequest', { requestId: p.requestId, responseCode: status, responseHeaders: resHeaders, body: b64(out) });
      const row = p.networkId && findRow(t, p.networkId, request.url);
      if (row) ctx.saveCall(tabId, row.id, { rules: [ruleRef(editRule)] });
      ctx.ruleHit(tabId);
    } catch (e) {
      await cmd(target, 'Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
    }
    return;
  }

  // Request stage. Keep a row for documents, form posts and anything a rule touches.
  const record = p.resourceType === 'Document' || request.method !== 'GET' || matched.length > 0;
  let postData = request.postData;
  if (postData == null && request.hasPostData && p.networkId) {
    try { postData = (await cmd(target, 'Network.getRequestPostData', { requestId: p.networkId })).postData; } catch {}
  }
  const row = { id: `dbg-${p.requestId}`, url: request.url, start: Date.now() };
  if (record) {
    if (p.networkId) {
      if (!t.rows.has(p.networkId)) t.rows.set(p.networkId, []);
      t.rows.get(p.networkId).push(row);
    }
    await ctx.saveCall(tabId, row.id, {
      type: 'network',
      resourceType: p.resourceType,
      method: request.method,
      url: request.url,
      start: row.start,
      state: 'pending',
      reqHeaders: lowerHeaders(headers),
      reqBody: postData ?? null,
      frame: { top: lh['sec-fetch-dest'] === 'document', url: '' },
      rules: [],
      layer: 'debugger',
    });
  }

  const req = { url: request.url, method: request.method, headers: { ...headers }, bodyText: postData ?? '' };
  let changed = false;
  const used = [];
  const pauseRule = matched.find((r) => r.type === 'pause');
  if (pauseRule) {
    used.push(pauseRule);
    if (record) ctx.saveCall(tabId, row.id, { state: 'paused', rules: [ruleRef(pauseRule)] });
    const d = await ctx.pause(tabId, { id: row.id, ruleName: pauseRule.name, request: { method: req.method, url: req.url, headers: req.headers, body: req.bodyText }, source: 'debugger' });
    if (d.action === 'drop') {
      if (record) ctx.saveCall(tabId, row.id, { state: 'error', error: 'Dropped (pause rule)', end: Date.now() });
      return cmd(target, 'Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    }
    const e = d.request || {};
    if (e.url && e.url !== req.url) { req.url = e.url; changed = true; }
    if (e.method && e.method !== req.method) { req.method = e.method; changed = true; }
    if (e.headers && JSON.stringify(e.headers) !== JSON.stringify(req.headers)) { req.headers = e.headers; changed = true; }
    if (typeof e.body === 'string' && e.body !== req.bodyText) { req.bodyText = e.body; changed = true; }
  }
  const bodyRule = matched.find((r) => r.type === 'requestBody');
  if (bodyRule) {
    try {
      if (bodyRule.config?.mode === 'js') {
        const res = await runInPage(tabId, bodyRule, ['body', 'request'], [req.bodyText, { url: req.url, method: req.method, headers: req.headers }]);
        if (!res.keep) { req.bodyText = res.value; changed = true; used.push(bodyRule); }
      } else {
        req.bodyText = bodyRule.config?.value ?? '';
        changed = true;
        used.push(bodyRule);
      }
    } catch (e) {
      if (record) ctx.saveCall(tabId, row.id, { ruleErrors: [`${bodyRule.name}: ${e.message}`] });
    }
  }
  const delayRule = matched.find((r) => r.type === 'delay');
  if (delayRule) {
    used.push(delayRule);
    await new Promise((r) => setTimeout(r, Number(delayRule.config?.ms) || 0));
  }
  for (const r of used) ctx.ruleHit(tabId);
  if (record && used.length) {
    ctx.saveCall(tabId, row.id, { rules: used.map(ruleRef), ...(changed ? { url: req.url, method: req.method, reqHeaders: lowerHeaders(req.headers), reqBody: req.bodyText, edited: true } : {}) });
  }

  const mockRule = matched.find((r) => r.type === 'responseMock');
  if (mockRule) {
    const c = mockRule.config || {};
    const status = Number(c.status);
    ctx.ruleHit(tabId);
    if (status === 0) {
      if (record) ctx.saveCall(tabId, row.id, { state: 'error', error: 'Mocked network error', rules: [ruleRef(mockRule)] });
      return cmd(target, 'Fetch.failRequest', { requestId: p.requestId, errorReason: 'Failed' }).catch(() => {});
    }
    const resHeaders = { 'content-type': c.contentType || 'application/json' };
    for (const h of c.headers || []) if (h.name) resHeaders[h.name.toLowerCase()] = h.value;
    await cmd(target, 'Fetch.fulfillRequest', { requestId: p.requestId, responseCode: status, responseHeaders: toHeaderList(resHeaders), body: b64(c.body ?? '') }).catch(() => {});
    if (record) {
      row.closed = true;
      ctx.saveCall(tabId, row.id, { state: 'done', status, statusText: STATUS_TEXT[status] || '', resHeaders, resBody: c.body ?? '', mocked: true, rules: [ruleRef(mockRule)], end: Date.now(), duration: Date.now() - row.start });
    }
    return;
  }

  const params = { requestId: p.requestId };
  if (changed) {
    if (req.url !== request.url) params.url = req.url;
    if (req.method !== request.method) params.method = req.method;
    params.headers = toHeaderList(req.headers).filter((h) => h.name.toLowerCase() !== 'content-length');
    if (req.method !== 'GET' && req.method !== 'HEAD') params.postData = b64(req.bodyText ?? '');
    if (record && req.url !== row.url) row.url = req.url;
  }
  await cmd(target, 'Fetch.continueRequest', params).catch((e) => {
    if (record) ctx.saveCall(tabId, row.id, { ruleErrors: [`Debugger: ${e.message}`] });
  });
}

function ruleRef(r) {
  return { id: r.id, name: r.name, type: r.type, layer: 'debugger' };
}
