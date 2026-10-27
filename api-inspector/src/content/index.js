// Content script (isolated world). Bridge between the page script and the extension.
// Also sends the page rules to the page script, and runs Insert script / CSS when
// user scripts are not turned on.
import { TO_CS, TO_PAGE } from '../shared/bridge.js';
import { activeRules, pageRulesFor, siteMatches, urlMatches } from '../shared/rules.js';

let alive = true;
let store = null;
const waiting = new Map(); // reqId -> resolve

function toPage(msg) {
  window.dispatchEvent(new CustomEvent(TO_PAGE, { detail: JSON.stringify(msg) }));
}

function toBackground(msg) {
  if (!alive) return Promise.resolve();
  try {
    return chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    alive = false; // extension was reloaded; this old script can't talk anymore
    return Promise.resolve();
  }
}

function pageRequest(msg, timeout = 60000) {
  const reqId = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    waiting.set(reqId, resolve);
    setTimeout(() => {
      if (waiting.delete(reqId)) resolve({ ok: false, error: 'The page did not answer.' });
    }, timeout);
    toPage({ ...msg, reqId });
  });
}

function sendRules() {
  if (store) toPage({ type: 'rules', rules: pageRulesFor(store, location.href) });
}

window.addEventListener(TO_CS, (e) => {
  let msg;
  try { msg = JSON.parse(e.detail); } catch { return; }
  switch (msg.type) {
    case 'hello':
      sendRules();
      break;
    case 'call':
    case 'rule-hit':
    case 'pause':
      toBackground(msg);
      break;
    case 'reply': {
      const r = waiting.get(msg.reqId);
      if (r) {
        waiting.delete(msg.reqId);
        r(msg.data);
      }
      break;
    }
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'highlight':
    case 'send':
      pageRequest(msg).then(sendResponse);
      return true;
    case 'pause-result':
      toPage(msg);
      sendResponse({ ok: true });
      return false;
    case 'ping':
      sendResponse({ ok: true, url: location.href });
      return false;
  }
  return false;
});

/* ---------- Insert script / CSS fallback (no user scripts) ---------- */

const inserted = new Set();

function runAtReady(runAt, fn) {
  if (runAt === 'document_start') return fn();
  const ev = runAt === 'document_end' ? 'DOMContentLoaded' : 'load';
  const done = runAt === 'document_end' ? document.readyState !== 'loading' : document.readyState === 'complete';
  if (done) fn();
  else window.addEventListener(ev, fn, { once: true });
}

function insertFallback() {
  if (!store || store.env?.userScripts) return;
  for (const r of activeRules(store)) {
    if (r.type !== 'insertScript' || inserted.has(r.id)) continue;
    if (!siteMatches(r.match?.site, location.hostname) || !urlMatches(r.match, location.href)) continue;
    inserted.add(r.id);
    const c = r.config || {};
    runAtReady(c.runAt || 'document_idle', () => {
      toBackground({ type: c.kind === 'css' ? 'insert-css' : 'insert-js', code: c.code || '', ruleId: r.id, name: r.name, url: location.href });
    });
  }
}

async function load() {
  try {
    store = await chrome.storage.local.get(['rules', 'groups', 'settings', 'env']);
  } catch {
    alive = false;
    return;
  }
  sendRules();
  insertFallback();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.rules || changes.groups || changes.settings || changes.env)) load();
});

toPage({ type: 'hello' });
load();
