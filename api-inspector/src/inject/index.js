// Page script. Runs in every frame before the page's own code (MAIN world).
// Captures fetch / XHR / sendBeacon calls, links them to clicks, and applies page rules.
import { TO_PAGE } from '../shared/bridge.js';
import { urlMatches } from '../shared/rules.js';
import { describeElement, pickElement } from './element.js';
import { resolvePause } from './apply.js';
import { handleFetch, installBeacon, installFetch, installXhr } from './network.js';
import { post, setRules, state } from './state.js';
import { capText, headersToObject } from './util.js';

const KEY = Symbol.for('api-inspector-installed');

if (!window[KEY]) {
  Object.defineProperty(window, KEY, { value: true });
  install();
}

function install() {
  installFetch();
  installXhr();
  installBeacon();
  installUserAgent();
  installClicks();

  const addEL = EventTarget.prototype.addEventListener;
  addEL.call(window, TO_PAGE, (e) => {
    let msg;
    try { msg = JSON.parse(e.detail); } catch { return; }
    onMessage(msg);
  });
  post({ type: 'hello' });
}

/* ---------- clicks (button -> API) ---------- */

const clickEls = new Map(); // click id -> WeakRef(element)

function remember(el) {
  const info = describeElement(el);
  state.lastClick = info;
  clickEls.set(info.id, new WeakRef(el));
  if (clickEls.size > 300) clickEls.delete(clickEls.keys().next().value);
}

function installClicks() {
  const addEL = EventTarget.prototype.addEventListener;
  addEL.call(window, 'click', (e) => {
    try { const el = pickElement(e); if (el) remember(el); } catch {}
  }, true);
  addEL.call(window, 'submit', (e) => {
    try { const el = e.submitter || e.target; if (el && el.nodeType === 1) remember(el); } catch {}
  }, true);
  addEL.call(window, 'change', (e) => {
    try {
      const el = e.target;
      if (el && el.matches && el.matches('select, input[type="checkbox"], input[type="radio"]')) remember(el);
    } catch {}
  }, true);
}

/* ---------- user agent (navigator.userAgent) ---------- */

let uaOverride = null;

function installUserAgent() {
  for (const prop of ['userAgent', 'appVersion']) {
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, prop);
    if (!desc || !desc.get) continue;
    Object.defineProperty(Navigator.prototype, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        if (uaOverride == null) return desc.get.call(this);
        return prop === 'userAgent' ? uaOverride : uaOverride.replace(/^Mozilla\//, '');
      },
    });
  }
}

/* ---------- highlight (A10) ---------- */

function highlight({ clickId, cssPath }) {
  let el = clickEls.get(clickId)?.deref();
  if (!el || !el.isConnected) {
    try { el = cssPath ? document.querySelector(cssPath) : null; } catch { el = null; }
  }
  if (!el) return { found: false };
  try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch {}
  const r = el.getBoundingClientRect();
  const box = document.createElement('div');
  box.setAttribute('data-api-inspector-highlight', '');
  Object.assign(box.style, {
    position: 'fixed',
    left: `${r.left - 4}px`,
    top: `${r.top - 4}px`,
    width: `${r.width + 8}px`,
    height: `${r.height + 8}px`,
    border: '3px solid #f43f5e',
    background: 'rgba(244,63,94,.15)',
    borderRadius: '6px',
    boxShadow: '0 0 0 4px rgba(244,63,94,.35)',
    zIndex: '2147483647',
    pointerEvents: 'none',
    transition: 'opacity .4s',
  });
  (document.body || document.documentElement).appendChild(box);
  setTimeout(() => { box.style.opacity = '0'; }, 2200);
  setTimeout(() => box.remove(), 2700);
  return { found: true, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
}

/* ---------- replay / send from the page (C1, C2) ---------- */

async function sendFromPage(request) {
  const method = String(request.method || 'GET').toUpperCase();
  const init = { method, headers: request.headers || {} };
  if (method !== 'GET' && method !== 'HEAD' && request.body != null && request.body !== '') init.body = request.body;
  const t0 = performance.now();
  const res = await handleFetch(request.url, init, request.mark || 'replay');
  const text = await res.text();
  const b = capText(text);
  return {
    ok: true,
    status: res.status,
    statusText: res.statusText,
    headers: headersToObject(res.headers),
    body: b.text,
    truncated: b.truncated,
    size: b.size,
    url: res.url,
    time: Math.round(performance.now() - t0),
  };
}

function reply(reqId, data) {
  post({ type: 'reply', reqId, data });
}

function onMessage(msg) {
  switch (msg.type) {
    case 'rules': {
      setRules(msg.rules);
      const ua = state.rules.find((r) => r.type === 'userAgent' && urlMatches(r.match, location.href));
      uaOverride = ua ? ua.config.value : null;
      break;
    }
    case 'pause-result':
      resolvePause(msg.id, msg.decision);
      break;
    case 'highlight':
      reply(msg.reqId, highlight(msg));
      break;
    case 'send':
      sendFromPage(msg.request).then(
        (d) => reply(msg.reqId, d),
        (e) => reply(msg.reqId, { ok: false, error: e && e.message ? e.message : String(e) }),
      );
      break;
    case 'hello':
      post({ type: 'hello' });
      break;
  }
}
