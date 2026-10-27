// Facts about a clicked element: text, CSS path, React components, Liquid section / block.
import { parseStack, pickSource, uid } from './util.js';

const CLICKABLE = [
  'button', 'a[href]', '[role="button"]', '[role="menuitem"]', '[role="tab"]', '[role="link"]', '[role="switch"]',
  'input[type="submit"]', 'input[type="button"]', 'input[type="image"]', 'input[type="checkbox"]', 'input[type="radio"]',
  'summary', 'label', 'select', '[onclick]',
].join(',');

export function pickElement(event) {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
  for (const n of path) {
    if (n && n.nodeType === 1 && n.matches && n.matches(CLICKABLE)) return n;
  }
  const t = path[0];
  return t && t.nodeType === 1 ? t : t && t.parentElement ? t.parentElement : null;
}

export function labelOf(el) {
  let t = '';
  try { t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' '); } catch {}
  return (t || el.getAttribute('aria-label') || el.value || el.title || el.getAttribute('alt') || el.getAttribute('name') || '')
    .toString()
    .slice(0, 80);
}

const SIMPLE_ID = /^[A-Za-z][\w-]*$/;

export function cssPath(el) {
  const parts = [];
  for (let n = el; n && n.nodeType === 1 && parts.length < 8; n = n.parentElement) {
    if (n.id && SIMPLE_ID.test(n.id)) {
      let unique = false;
      try { unique = n.ownerDocument.querySelectorAll('#' + CSS.escape(n.id)).length === 1; } catch {}
      if (unique) { parts.unshift('#' + CSS.escape(n.id)); break; }
    }
    let sel = n.tagName.toLowerCase();
    if (n === n.ownerDocument.body || n === n.ownerDocument.documentElement) {
      parts.unshift(sel);
      break;
    }
    const classes = [...n.classList].filter((c) => SIMPLE_ID.test(c) && c.length < 40).slice(0, 2);
    if (classes.length) sel += '.' + classes.map((c) => CSS.escape(c)).join('.');
    const parent = n.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === n.tagName);
      if (same.length > 1) sel += `:nth-of-type(${same.indexOf(n) + 1})`;
    }
    parts.unshift(sel);
  }
  return parts.join(' > ');
}

function fiberKey(node) {
  for (const k in node) {
    if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) return k;
  }
  return null;
}

function typeName(t) {
  if (!t || typeof t === 'string') return null;
  if (typeof t === 'function') return t.displayName || t.name || null;
  if (typeof t === 'object') {
    if (t.displayName) return t.displayName;
    if (t.render) return t.render.displayName || t.render.name || 'ForwardRef'; // forwardRef
    if (t.type) return typeName(t.type); // memo
  }
  return null;
}

// Where the JSX for this element was written (dev builds only).
function fiberSource(fiber) {
  const s = fiber._debugSource;
  if (s && s.fileName) return { url: s.fileName, line: s.lineNumber, col: s.columnNumber };
  const st = fiber._debugStack; // React 19 dev
  if (st && st.stack) {
    const f = pickSource(parseStack(st.stack));
    if (f) return { url: f.url, line: f.line, col: f.col, fn: f.fn };
  }
  return null;
}

export function reactInfo(el) {
  let node = el;
  let key = null;
  for (let i = 0; node && i < 50; i++, node = node.parentNode) {
    key = fiberKey(node);
    if (key) break;
  }
  if (!key) return null;
  let fiber = node[key];
  const chain = [];
  let source = null;
  for (let guard = 0; fiber && guard < 1000; guard++, fiber = fiber.return) {
    if (!source) {
      try { source = fiberSource(fiber); } catch {}
    }
    const name = typeName(fiber.type);
    if (name && chain[chain.length - 1] !== name) chain.push(name);
  }
  if (!chain.length) return null;
  chain.reverse();
  const minified = chain.every((n) => n.length <= 2);
  return { chain: chain.slice(-30), source, minified };
}

// Shopify theme wrappers: <div id="shopify-section-..."> and <div id="shopify-block-...">.
export function liquidInfo(el) {
  let section = null;
  let block = null;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const id = n.id || '';
    const cl = n.classList;
    if (!block && (id.startsWith('shopify-block-') || cl.contains('shopify-block') || cl.contains('shopify-app-block'))) {
      block = {
        id: id.replace(/^shopify-block-/, ''),
        appBlock: cl.contains('shopify-app-block'),
        handle: n.getAttribute('data-block-handle') || n.getAttribute('data-block-type') || '',
      };
    }
    if (!section && (id.startsWith('shopify-section-') || cl.contains('shopify-section'))) {
      const sid = id.replace(/^shopify-section-/, '');
      section = {
        id: sid,
        // "template--1234__main" -> "main", "header" -> "header"
        name: n.getAttribute('data-section-type') || sid.split('__').pop() || sid,
      };
    }
    if (section) break;
  }
  if (!section && !block) return null;
  return { section, block };
}

export function describeElement(el) {
  const info = {
    id: uid(),
    time: Date.now(),
    tag: el.tagName.toLowerCase(),
    text: labelOf(el),
    cssPath: '',
    react: null,
    liquid: null,
    attrs: {},
  };
  try { info.cssPath = cssPath(el); } catch {}
  try { info.react = reactInfo(el); } catch {}
  try { info.liquid = liquidInfo(el); } catch {}
  for (const a of ['id', 'name', 'type', 'href', 'data-testid', 'aria-label']) {
    const v = el.getAttribute && el.getAttribute(a);
    if (v) info.attrs[a] = String(v).slice(0, 200);
  }
  return info;
}
