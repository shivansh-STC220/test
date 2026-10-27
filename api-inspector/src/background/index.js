// Background service worker: stores calls, keeps rules in sync, counts rule hits,
// and runs tools (replay, API client, scan, pause, debugger mode).
import { activeRules } from '../shared/rules.js';
import { clearAll, clearCalls, exportCalls, getCall, getCalls, prune, upsertCall } from './store.js';
import { dnrMap, loadDnrMap, syncDnr, syncUserScripts, userScriptsAvailable } from './sync.js';
import { scanTab } from './scan.js';
import { debuggerOn, disableDebugger, enableDebugger, initDebugger, restoreDebuggerState } from './debugger.js';

/* ---------- state ---------- */

let rulesState = null; // { rules, groups, settings, active }
const viewers = new Map(); // tabId -> Set<Port> (DevTools panel, panel tab, pause window)
const preserve = new Map(); // tabId -> bool
const hits = new Map(); // tabId -> [time]
const navStart = new Map(); // tabId -> time
const paused = new Map(); // `${tabId}:${id}` -> paused call
const pauseWaiters = new Map(); // key -> resolve (debugger mode)
const pauseWindows = new Map(); // tabId -> windowId
const recentCalls = new Map(); // tabId -> Map(id -> { url, method, start, end, ruleIds })
const pendingHits = new Map(); // tabId -> [{ url, method, time, rule }]

const ready = (async () => {
  const s = await chrome.storage.session.get(['preserve', 'hits']);
  for (const [k, v] of Object.entries(s.preserve || {})) preserve.set(Number(k), v);
  for (const [k, v] of Object.entries(s.hits || {})) hits.set(Number(k), v);
  await loadDnrMap();
  await loadRules();
  await restoreDebuggerState().catch(() => {});
})();

async function loadRules() {
  const s = await chrome.storage.local.get(['rules', 'groups', 'settings']);
  const state = { rules: s.rules || [], groups: s.groups || [], settings: s.settings || { enabled: true } };
  state.active = activeRules(state);
  rulesState = state;
  return state;
}

function ruleById(id) {
  return rulesState?.rules.find((r) => r.id === id);
}

/* ---------- viewers (panel ports) ---------- */

function push(tabId, msg) {
  for (const port of viewers.get(tabId) || []) {
    try { port.postMessage(msg); } catch {}
  }
}

function tabState(tabId) {
  return {
    preserve: !!preserve.get(tabId),
    debugger: debuggerOn(tabId),
    hits: (hits.get(tabId) || []).length,
  };
}

function pushState(tabId) {
  push(tabId, { type: 'state', ...tabState(tabId) });
}

function pausedFor(tabId) {
  return [...paused.values()].filter((p) => p.tabId === tabId);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'panel') return;
  let tabId = null;
  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'subscribe') return;
    await ready;
    tabId = msg.tabId;
    if (!viewers.has(tabId)) viewers.set(tabId, new Set());
    viewers.get(tabId).add(port);
    const calls = await getCalls(tabId);
    port.postMessage({ type: 'init', calls, paused: pausedFor(tabId), ...tabState(tabId) });
  });
  port.onDisconnect.addListener(() => {
    if (tabId != null) viewers.get(tabId)?.delete(port);
  });
});

/* ---------- badge (rule hits on this tab) ---------- */

let saveTimer = null;
function saveSession() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.session.set({
      preserve: Object.fromEntries(preserve),
      hits: Object.fromEntries([...hits].map(([k, v]) => [k, v.slice(-500)])),
    });
  }, 200);
}

function updateBadge(tabId) {
  const n = (hits.get(tabId) || []).length;
  chrome.action.setBadgeText({ tabId, text: n ? String(n > 999 ? '999+' : n) : '' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#4f46e5' }).catch(() => {});
}

function ruleHit(tabId) {
  if (tabId == null || tabId < 0) return;
  if (!hits.has(tabId)) hits.set(tabId, []);
  hits.get(tabId).push(Date.now());
  updateBadge(tabId);
  pushState(tabId);
  saveSession();
}

/* ---------- calls ---------- */

async function saveCall(tabId, id, data) {
  const call = await upsertCall(tabId, id, data);
  push(tabId, { type: 'call', call });
  return call;
}

function stripHash(url) {
  return String(url || '').split('#')[0];
}

function rememberCall(tabId, call) {
  if (!recentCalls.has(tabId)) recentCalls.set(tabId, new Map());
  const m = recentCalls.get(tabId);
  const prev = m.get(call.id) || { ruleIds: new Set() };
  m.set(call.id, {
    ...prev,
    url: stripHash(call.originalUrl || call.url || prev.url),
    altUrl: stripHash(call.url || prev.altUrl),
    method: call.method || prev.method,
    start: call.start ?? prev.start,
    end: call.end ?? prev.end,
  });
  // Forget calls older than a minute.
  const cutoff = Date.now() - 60000;
  for (const [k, v] of m) if ((v.end || v.start || 0) < cutoff) m.delete(k);
}

// A network rule matched a fetch / XHR / beacon. Link it to the captured call (rule log, O6).
function linkHit(tabId, hit) {
  const m = recentCalls.get(tabId);
  if (!m) return false;
  let best = null;
  for (const [id, c] of m) {
    if (c.ruleIds.has(hit.rule.id)) continue;
    if (c.url !== hit.url && c.altUrl !== hit.url) continue;
    if (c.method && hit.method && c.method !== hit.method) continue;
    if (c.start && c.start > hit.time + 2000) continue;
    if (!best || c.start > best[1].start) best = [id, c];
  }
  if (!best) return false;
  best[1].ruleIds.add(hit.rule.id);
  saveCall(tabId, best[0], { rules: [hit.rule] });
  return true;
}

function tryPendingHits(tabId) {
  const list = pendingHits.get(tabId);
  if (!list || !list.length) return;
  const now = Date.now();
  pendingHits.set(tabId, list.filter((h) => now - h.time < 15000 && !linkHit(tabId, h)));
}

async function onPageCall(tabId, frameId, msg) {
  const data = { ...msg.data, frameId };
  const call = await saveCall(tabId, msg.id, data);
  rememberCall(tabId, call);
  tryPendingHits(tabId);
  if (data.start != null && Math.random() < 0.05) prune(tabId);
}

// A redirect rule whose new URL matches the rule again would loop forever (Chrome does not
// stop these internal redirects). If one call is redirected again and again, turn the rule off.
const REDIRECT_TYPES = ['redirect', 'replace', 'query', 'mapRemote', 'mapLocal'];
const redirectCounts = new Map(); // `${requestId}:${ruleId}` -> { n, time }

function loopGuard(requestId, rule) {
  if (!REDIRECT_TYPES.includes(rule.type)) return false;
  const now = Date.now();
  for (const [k, v] of redirectCounts) if (now - v.time > 10000) redirectCounts.delete(k);
  const key = `${requestId}:${rule.id}`;
  const entry = redirectCounts.get(key) || { n: 0, time: now };
  entry.n++;
  redirectCounts.set(key, entry);
  if (entry.n === 8) disableLoopingRule(rule.id);
  return entry.n > 1;
}

async function disableLoopingRule(id) {
  const { rules = [] } = await chrome.storage.local.get('rules');
  const msg = 'Turned off: it kept redirecting the same call in a loop. The new URL matches the rule again.';
  await chrome.storage.local.set({ rules: rules.map((r) => (r.id === id ? { ...r, enabled: false, loopError: msg } : r)) });
}

chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(async ({ request, rule }) => {
  await ready;
  const tabId = request.tabId;
  if (tabId == null || tabId < 0) return;
  const ours = ruleById(dnrMap[rule.ruleId]);
  if (!ours) return;
  if (loopGuard(request.requestId, ours)) return;
  ruleHit(tabId);
  const ref = { id: ours.id, name: ours.name, type: ours.type, layer: 'network' };
  const url = stripHash(request.url);
  const method = String(request.method || 'get').toUpperCase();
  if (request.type === 'xmlhttprequest' || request.type === 'ping') {
    const hit = { url, method, time: Date.now(), rule: ref };
    if (!linkHit(tabId, hit)) {
      if (!pendingHits.has(tabId)) pendingHits.set(tabId, []);
      pendingHits.get(tabId).push(hit);
    }
    return;
  }
  // Scripts, pages, images...: show the hit as its own row.
  await saveCall(tabId, `net-${request.requestId}`, {
    type: 'network',
    resourceType: request.type,
    method,
    url,
    start: Date.now(),
    state: 'done',
    frameId: request.frameId,
    frame: { top: request.frameId === 0 && request.type === 'main_frame', url: request.initiator || '' },
    rules: [ref],
  });
});

/* ---------- navigation: clear the list unless "Preserve log" ---------- */

chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId === 0) navStart.set(d.tabId, d.timeStamp);
});

chrome.webNavigation.onCommitted.addListener(async (d) => {
  if (d.frameId !== 0) return;
  await ready;
  const before = Math.min(navStart.get(d.tabId) ?? d.timeStamp, d.timeStamp);
  navStart.delete(d.tabId);
  if (preserve.get(d.tabId)) {
    await saveCall(d.tabId, `nav-${Math.round(d.timeStamp)}`, { type: 'nav', url: d.url, start: before - 0.5, state: 'done' });
    return;
  }
  await clearCalls(d.tabId, before);
  hits.set(d.tabId, (hits.get(d.tabId) || []).filter((t) => t >= before));
  updateBadge(d.tabId);
  saveSession();
  push(d.tabId, { type: 'cleared', before });
  pushState(d.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearCalls(tabId);
  hits.delete(tabId);
  preserve.delete(tabId);
  recentCalls.delete(tabId);
  pendingHits.delete(tabId);
  for (const p of pausedFor(tabId)) paused.delete(p.key);
  saveSession();
});

/* ---------- pause & edit ---------- */

const PAUSE_TIMEOUT = 5 * 60 * 1000;

async function openPauseWindow(tabId) {
  const existing = pauseWindows.get(tabId);
  if (existing != null) {
    try {
      await chrome.windows.update(existing, { focused: true });
      return;
    } catch {}
  }
  const w = await chrome.windows.create({ url: chrome.runtime.getURL(`pause.html?tabId=${tabId}`), type: 'popup', width: 760, height: 680 });
  pauseWindows.set(tabId, w.id);
}

chrome.windows.onRemoved.addListener((id) => {
  for (const [tabId, w] of pauseWindows) if (w === id) pauseWindows.delete(tabId);
});

// Returns a promise with { action: 'send' | 'drop', request }.
function addPause(tabId, frameId, item) {
  const key = `${tabId}:${item.id}`;
  const entry = { key, tabId, frameId, time: Date.now(), source: 'page', ...item };
  paused.set(key, entry);
  push(tabId, { type: 'paused', list: pausedFor(tabId) });
  if (!(viewers.get(tabId)?.size)) openPauseWindow(tabId).catch(() => {});
  setTimeout(() => {
    if (paused.has(key)) decidePause(tabId, item.id, { action: 'send' });
  }, PAUSE_TIMEOUT);
  return new Promise((resolve) => pauseWaiters.set(key, resolve));
}

async function decidePause(tabId, id, decision) {
  const key = `${tabId}:${id}`;
  const p = paused.get(key);
  if (!p) return { ok: false, error: 'This call is not paused anymore.' };
  paused.delete(key);
  const waiter = pauseWaiters.get(key);
  pauseWaiters.delete(key);
  if (waiter) waiter(decision);
  if (p.source === 'page') {
    await chrome.tabs.sendMessage(tabId, { type: 'pause-result', id, decision }, { frameId: p.frameId }).catch(() => {});
  }
  push(tabId, { type: 'paused', list: pausedFor(tabId) });
  return { ok: true };
}

/* ---------- sending requests (replay, API client) ---------- */

async function sendInPage(tabId, frameId, request) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'send', request }, { frameId: frameId ?? 0 });
    if (r) return r;
  } catch (e) {
    if (frameId) return sendInPage(tabId, 0, request);
    return { ok: false, error: `Can't reach the page: ${e.message}` };
  }
  return { ok: false, error: 'No answer from the page.' };
}

async function sendFromExtension(tabId, request) {
  const method = String(request.method || 'GET').toUpperCase();
  const start = Date.now();
  const id = `client-${start}-${Math.random().toString(36).slice(2, 6)}`;
  const init = { method, headers: request.headers || {}, credentials: 'include' };
  if (method !== 'GET' && method !== 'HEAD' && request.body) init.body = request.body;
  if (tabId != null) {
    await saveCall(tabId, id, { type: 'client', method, url: request.url, start, state: 'pending', reqHeaders: init.headers, reqBody: init.body ?? null, frame: { top: true, url: '' }, rules: [] });
  }
  try {
    const res = await fetch(request.url, init);
    const text = await res.text();
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    const body = text.length > 1024 * 1024 ? text.slice(0, 1024 * 1024) : text;
    const out = { ok: true, status: res.status, statusText: res.statusText, headers, body, size: text.length, truncated: text.length > body.length, url: res.url, time: Date.now() - start };
    if (tabId != null) {
      await saveCall(tabId, id, { state: 'done', status: res.status, statusText: res.statusText, resHeaders: headers, resBody: body, resBodySize: text.length, resBodyTruncated: out.truncated, finalUrl: res.url, end: Date.now(), duration: out.time });
    }
    return out;
  } catch (e) {
    if (tabId != null) await saveCall(tabId, id, { state: 'error', error: e.message, end: Date.now(), duration: Date.now() - start });
    return { ok: false, error: e.message };
  }
}

/* ---------- rules sync ---------- */

let syncing = Promise.resolve();
let syncTimer = null;

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncing = syncing.then(runSync, runSync);
  }, 30);
}

async function runSync() {
  const state = await loadRules();
  const errors = {};
  try { await syncDnr(state, errors); } catch (e) { console.warn('[API Inspector] network rules', e); }
  try { await syncUserScripts(state, errors); } catch (e) { console.warn('[API Inspector] user scripts', e); }
  const { ruleErrors = {} } = await chrome.storage.local.get('ruleErrors');
  if (JSON.stringify(ruleErrors) !== JSON.stringify(errors)) await chrome.storage.local.set({ ruleErrors: errors });
  await chrome.storage.local.set({ syncedAt: Date.now() });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.rules || changes.groups || changes.settings)) scheduleSync();
});

chrome.runtime.onInstalled.addListener(async () => {
  await clearAll();
  const s = await chrome.storage.local.get(['rules', 'groups', 'settings']);
  const init = {};
  if (!s.rules) init.rules = [];
  if (!s.groups) init.groups = [];
  if (!s.settings) init.settings = { enabled: true };
  if (Object.keys(init).length) await chrome.storage.local.set(init);
  scheduleSync();
});

chrome.runtime.onStartup.addListener(() => {
  clearAll();
  scheduleSync();
});

/* ---------- debugger mode ---------- */

initDebugger({
  saveCall,
  ruleHit,
  onState: pushState,
  getState: async () => {
    await ready;
    return rulesState;
  },
  tabUrl: async (tabId) => (await chrome.tabs.get(tabId).catch(() => null))?.url || '',
  pause: (tabId, item) => addPause(tabId, null, item),
});

/* ---------- messages ---------- */

async function handle(msg, sender) {
  await ready;
  const tabId = msg.tabId ?? sender.tab?.id;
  switch (msg.type) {
    // from the content script
    case 'call':
      return onPageCall(sender.tab.id, sender.frameId, msg);
    case 'rule-hit':
      return ruleHit(sender.tab?.id);
    case 'pause':
      addPause(sender.tab.id, sender.frameId, { id: msg.id, ruleName: msg.ruleName, request: msg.request });
      return { ok: true };
    case 'insert-css':
      await chrome.scripting.insertCSS({ target: { tabId: sender.tab.id, frameIds: [sender.frameId] }, css: msg.code });
      ruleHit(sender.tab.id);
      return { ok: true };
    case 'insert-js':
      await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
        world: 'MAIN',
        injectImmediately: true,
        args: [msg.code],
        func: (code) => {
          const s = document.createElement('script');
          s.textContent = code;
          (document.head || document.documentElement).appendChild(s);
          s.remove();
        },
      });
      ruleHit(sender.tab.id);
      return { ok: true };

    // from the screens
    case 'get-call':
      return getCall(tabId, msg.id);
    case 'clear':
      await clearCalls(tabId);
      hits.set(tabId, []);
      updateBadge(tabId);
      saveSession();
      push(tabId, { type: 'cleared', before: null });
      pushState(tabId);
      return { ok: true };
    case 'set-preserve':
      preserve.set(tabId, !!msg.value);
      saveSession();
      pushState(tabId);
      return { ok: true };
    case 'export':
      return exportCalls(tabId);
    case 'highlight':
      try {
        return await chrome.tabs.sendMessage(tabId, { type: 'highlight', clickId: msg.clickId, cssPath: msg.cssPath }, { frameId: msg.frameId ?? 0 });
      } catch (e) {
        return { found: false, error: e.message };
      }
    case 'replay': {
      const call = await getCall(tabId, msg.id);
      if (!call) return { ok: false, error: 'Call not found.' };
      const request = msg.request || { method: call.method, url: call.url, headers: call.reqHeaders || {}, body: call.reqBody };
      if (call.type === 'client') return sendFromExtension(tabId, request);
      return sendInPage(tabId, call.frameId, { ...request, mark: 'replay' });
    }
    case 'client-send':
      if (msg.from === 'page') return sendInPage(tabId, msg.frameId ?? 0, { ...msg.request, mark: 'client' });
      return sendFromExtension(tabId, msg.request);
    case 'scan':
      return scanTab(tabId, msg.term || '');
    case 'pause-decision':
      return decidePause(tabId, msg.id, { action: msg.action, request: msg.request });
    case 'get-paused':
      return pausedFor(tabId);
    case 'debugger':
      try {
        if (msg.on) await enableDebugger(tabId);
        else await disableDebugger(tabId);
        return { ok: true, on: debuggerOn(tabId) };
      } catch (e) {
        return { ok: false, error: e.message, on: debuggerOn(tabId) };
      }
    case 'tab-state':
      return { ...tabState(tabId), url: (await chrome.tabs.get(tabId).catch(() => null))?.url || '' };
    case 'env-check': {
      const ok = await userScriptsAvailable();
      const { env = {} } = await chrome.storage.local.get('env');
      if (env.userScripts !== ok) scheduleSync();
      return { userScripts: ok };
    }
    case 'sync-now':
      scheduleSync();
      await new Promise((r) => setTimeout(r, 60));
      await syncing;
      return { ok: true };
  }
  return undefined;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(
    (r) => sendResponse(r),
    (e) => sendResponse({ ok: false, error: e && e.message ? e.message : String(e) }),
  );
  return true;
});

// First run after the worker wakes up: make sure Chrome's rules match the saved ones.
ready.then(() => chrome.declarativeNetRequest.getDynamicRules()).then((list) => {
  if (!list.length && rulesState?.active.length) scheduleSync();
});
