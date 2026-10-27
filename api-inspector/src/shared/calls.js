// Helpers for captured calls: grouping into APIs (endpoints), filters, and labels.

const STATIC_EXT = /\.(png|jpe?g|gif|svg|webp|avif|ico|css|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|map|m?js|jsx|tsx?|vue|html?)(\?|#|$)/i;

// A path part that is an id: 123, a uuid, a long hex or a long mixed token.
export function isIdSegment(seg) {
  if (!seg) return false;
  if (/^\d+$/.test(seg)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return true;
  if (/^[0-9a-f]{12,}$/i.test(seg)) return true;
  if (seg.length >= 16 && /\d/.test(seg) && /^[A-Za-z0-9_-]+$/.test(seg)) return true;
  return false;
}

export function normalizePath(pathname) {
  return String(pathname || '/').split('/').map((s) => (isIdSegment(s) ? ':id' : s)).join('/');
}

// "POST https://shop.com/api/items/42?x=1" -> { key: "POST shop.com/api/items/:id", ... }
export function endpointOf(method, url) {
  let u;
  try { u = new URL(url); } catch { return { key: `${method} ${url}`, method, host: '', path: String(url) }; }
  const path = normalizePath(u.pathname);
  return { key: `${String(method || 'GET').toUpperCase()} ${u.host}${path}`, method: String(method || 'GET').toUpperCase(), host: u.host, path };
}

export function statusClass(call) {
  if (call.state === 'pending' || call.state === 'paused' || call.state === 'receiving') return 'pending';
  if (call.type === 'beacon') return call.status === 'queued' ? '2xx' : 'failed';
  if (call.error) return 'failed';
  // A network rule hit on a script / image row has no status.
  if (!call.status) return call.type === 'network' ? '' : 'failed';
  const s = Number(call.status);
  if (!s) return 'failed';
  return `${Math.floor(s / 100)}xx`;
}

export function hostOf(url) {
  try { return new URL(url).host; } catch { return ''; }
}

export const EMPTY_FILTER = {
  text: '',
  methods: [],
  statuses: [],
  types: [],
  hosts: [],
  frame: 'all',
  ruleOnly: false,
  endpoint: '',
};

export function filterIsEmpty(f) {
  return !f.text && !f.methods.length && !f.statuses.length && !f.types.length && !f.hosts.length && f.frame === 'all' && !f.ruleOnly && !f.endpoint;
}

function textMatches(text, call) {
  if (!text) return true;
  const t = text.trim();
  if (t.length > 2 && t.startsWith('/') && t.endsWith('/')) {
    try { return new RegExp(t.slice(1, -1), 'i').test(call.url); } catch { return false; }
  }
  const low = t.toLowerCase();
  return [call.url, call.method, String(call.status ?? ''), call.click?.text, call.source?.url, ...(call.click?.react?.chain || [])]
    .some((v) => v && String(v).toLowerCase().includes(low));
}

export function callMatches(call, f) {
  if (!f) return true;
  if (call.type === 'nav') return true;
  if (f.methods.length && !f.methods.includes(call.method)) return false;
  if (f.statuses.length && !f.statuses.includes(statusClass(call))) return false;
  if (f.types.length && !f.types.includes(call.type)) return false;
  if (f.hosts.length && !f.hosts.includes(hostOf(call.url))) return false;
  if (f.frame === 'top' && !call.frame?.top) return false;
  if (f.frame === 'iframe' && call.frame?.top) return false;
  if (f.ruleOnly && !(call.rules && call.rules.length)) return false;
  if (f.endpoint && endpointOf(call.method, call.url).key !== f.endpoint) return false;
  return textMatches(f.text, call);
}

export function filterCalls(calls, f) {
  return calls.filter((c) => callMatches(c, f));
}

// Group calls into APIs. Optional "found" are endpoints from Scan source not called yet.
export function groupEndpoints(calls, found = []) {
  const map = new Map();
  for (const c of calls) {
    if (c.type === 'nav' || !c.url) continue;
    // Rows from network rules / debugger mode can be page, script or image loads. Only form posts count as APIs.
    if (c.type === 'network' && (c.method === 'GET' || STATIC_EXT.test(c.url))) continue;
    const e = endpointOf(c.method, c.url);
    let g = map.get(e.key);
    if (!g) {
      g = { ...e, count: 0, statuses: {}, types: new Set(), buttons: new Set(), sources: new Set(), frames: new Set(), rules: new Set(), totalMs: 0, timed: 0, maxMs: 0, first: c.start, last: c.start, example: c.url, live: true };
      map.set(e.key, g);
    }
    g.count++;
    const sc = c.status || (c.error ? 'failed' : c.state);
    g.statuses[sc] = (g.statuses[sc] || 0) + 1;
    g.types.add(c.type);
    if (c.click?.text) g.buttons.add(c.click.text);
    if (c.source?.url) g.sources.add(`${shortFile(c.source.url)}:${c.source.line}`);
    g.frames.add(c.frame?.top ? 'top' : 'iframe');
    for (const r of c.rules || []) g.rules.add(r.name);
    if (typeof c.duration === 'number') { g.totalMs += c.duration; g.timed++; g.maxMs = Math.max(g.maxMs, c.duration); }
    g.first = Math.min(g.first, c.start);
    g.last = Math.max(g.last, c.start);
  }
  const live = [...map.values()].map((g) => ({
    ...g,
    avgMs: g.timed ? Math.round(g.totalMs / g.timed) : null,
    types: [...g.types], buttons: [...g.buttons], sources: [...g.sources], frames: [...g.frames], rules: [...g.rules],
  }));
  // Add endpoints only seen in the source code. Method is unknown, so match on path only.
  const livePaths = new Set(live.map((g) => g.path));
  const extra = new Map();
  for (const f of found) {
    if (!f.apiLike) continue;
    let path = f.value;
    let host = '';
    if (/^(https?:)?\/\//.test(path)) {
      try { const u = new URL(path, 'https://x.invalid'); path = u.pathname; host = u.host; } catch { continue; }
    } else {
      path = path.split(/[?#]/)[0];
    }
    path = normalizePath(path.replace(/\$\{[^}]*\}/g, ':id'));
    if (livePaths.has(path) || extra.has(path)) continue;
    extra.set(path, { key: `ANY ${host}${path}`, method: 'ANY', host, path, count: 0, statuses: {}, types: [], buttons: [], sources: [`${shortFile(f.file)}:${f.line}`], frames: [], rules: [], avgMs: null, maxMs: 0, live: false, example: f.value });
  }
  return [...live.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)), ...extra.values()];
}

export function endpointMatchesFilter(g, f) {
  if (!f) return true;
  if (f.methods.length && g.live && !f.methods.includes(g.method)) return false;
  if (f.hosts.length && g.host && !f.hosts.includes(g.host)) return false;
  if (f.types.length && !g.types.some((t) => f.types.includes(t))) return false;
  if (f.statuses.length) {
    const cls = Object.keys(g.statuses).map((s) => (/^\d+$/.test(s) ? `${s[0]}xx` : s === 'pending' || s === 'paused' || s === 'receiving' ? 'pending' : 'failed'));
    if (!cls.some((c) => f.statuses.includes(c))) return false;
  }
  if (f.frame !== 'all' && g.live && !g.frames.includes(f.frame)) return false;
  if (f.ruleOnly && !g.rules.length) return false;
  if (f.text) {
    const t = f.text.toLowerCase();
    if (![g.key, g.example, ...g.buttons, ...g.sources].some((v) => v && v.toLowerCase().includes(t))) return false;
  }
  return true;
}

export function shortFile(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    // Dev builds: keep the path from src/ so "src/components/Save.jsx" stays clear.
    const i = u.pathname.indexOf('/src/');
    if (i >= 0) return u.pathname.slice(i + 1);
    return u.pathname.split('/').filter(Boolean).pop() || u.host;
  } catch {
    return String(url).split('/').pop();
  }
}

export function displayPath(url, pageHost) {
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    return u.host === pageHost ? path : `${u.host}${path}`;
  } catch {
    return url;
  }
}

export function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function formatMs(n) {
  if (n == null) return '';
  return n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`;
}

// "Clicked Save -> POST /api/settings - 200 - 120 ms"
export function callSentence(call) {
  const parts = [];
  if (call.click?.text) parts.push(`Clicked ${call.click.text} →`);
  // Same host as the page: show only the path, like "/api/settings".
  parts.push(`${call.method} ${displayPath(call.url, hostOf(call.frame?.url))}`);
  if (call.status) parts.push(`- ${call.status}`);
  if (call.duration != null) parts.push(`- ${formatMs(call.duration)}`);
  return parts.join(' ');
}

export { STATIC_EXT };
