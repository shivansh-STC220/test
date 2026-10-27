// Scan source (A9): look through the JS files loaded in every frame of a tab.
import { extractEndpoints, findOccurrences } from '../shared/scan.js';

const MAX_FILE = 8 * 1024 * 1024;
const CODE_URL = /\.(m?js|cjs|jsx|tsx?|vue|svelte)([?#]|$)|\/@vite\/|\/src\//i;

// Runs inside each frame: list script files and inline scripts.
function collect() {
  const urls = new Set();
  for (const s of document.scripts) if (s.src) urls.add(s.src);
  for (const l of document.querySelectorAll('link[rel="modulepreload"], link[rel="preload"][as="script"]')) if (l.href) urls.add(l.href);
  try {
    for (const e of performance.getEntriesByType('resource')) {
      if (e.initiatorType === 'script' || e.initiatorType === 'other' || e.initiatorType === 'link') urls.add(e.name);
    }
  } catch {}
  const inline = [];
  for (const s of document.scripts) {
    if (!s.src && s.textContent.trim() && (!s.type || /javascript|module/.test(s.type))) inline.push(s.textContent);
  }
  return { frameUrl: location.href, urls: [...urls], inline };
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { cache: 'force-cache', signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (/image|font|css|html/.test(ct) && !/javascript/.test(ct)) return null;
    const text = await res.text();
    return text.length > MAX_FILE ? text.slice(0, MAX_FILE) : text;
  } finally {
    clearTimeout(timer);
  }
}

export async function scanTab(tabId, term) {
  const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: collect });
  const files = [];
  const urls = new Set();
  for (const r of results) {
    if (!r.result) continue;
    r.result.urls.filter((u) => /^https?:/.test(u) && CODE_URL.test(u)).forEach((u) => urls.add(u));
    r.result.inline.forEach((text, i) => files.push({ url: `${r.result.frameUrl} (inline script #${i + 1})`, text }));
  }
  const list = [...urls];
  const fetched = [];
  // A few at a time, so big sites don't flood the network.
  for (let i = 0; i < list.length; i += 6) {
    const part = await Promise.all(list.slice(i, i + 6).map(async (url) => {
      try {
        const text = await fetchText(url);
        return text == null ? null : { url, text };
      } catch (e) {
        return { url, text: '', error: e.message };
      }
    }));
    fetched.push(...part.filter(Boolean));
  }
  files.push(...fetched);
  const occurrences = [];
  const endpoints = [];
  for (const f of files) {
    if (!f.text) continue;
    if (term) occurrences.push(...findOccurrences(f.url, f.text, term));
    endpoints.push(...extractEndpoints(f.url, f.text));
  }
  return {
    term,
    time: Date.now(),
    files: files.map((f) => ({ url: f.url, size: f.text.length, error: f.error })),
    occurrences,
    endpoints,
  };
}
