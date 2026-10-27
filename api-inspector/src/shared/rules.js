// Rule model shared by the background, content script, page script and screens.
// Plain JS with no imports, so the page script can copy it safely.

export const RULE_TYPES = {
  redirect: { id: 'B1', label: 'Redirect', layer: 'network', help: 'Send a URL to another URL.' },
  replace: { id: 'B2', label: 'Replace string', layer: 'network', help: 'Change part of a URL.' },
  query: { id: 'B3', label: 'Query params', layer: 'network', help: 'Add, change or remove query params.' },
  headers: { id: 'B4', label: 'Headers', layer: 'network', help: 'Change request and response headers.' },
  block: { id: 'B5', label: 'Cancel (block)', layer: 'network', help: 'The call fails and is never sent.' },
  userAgent: { id: 'B6', label: 'User agent', layer: 'network', help: 'Pretend to be another device or browser.' },
  mapRemote: { id: 'B7', label: 'Map remote', layer: 'network', help: 'Point a whole host or path to another server.' },
  requestBody: { id: 'B8', label: 'Request body', layer: 'page', help: 'Change the body before it is sent.' },
  responseEdit: { id: 'B9', label: 'Response - edit', layer: 'page', help: 'The real call goes. You change the body before the page sees it.' },
  responseMock: { id: 'B10', label: 'Response - mock', layer: 'page', help: 'Return a fake status and body. No server call.' },
  delay: { id: 'B11', label: 'Delay', layer: 'page', help: 'Wait some ms before sending.' },
  pause: { id: 'B12', label: 'Pause & edit', layer: 'page', help: 'The call stops. You edit it, then Send or Drop.' },
  insertScript: { id: 'B13', label: 'Insert script / CSS', layer: 'script', help: 'Add your own JS or CSS to a page.' },
  mapLocal: { id: 'B14', label: 'Map local', layer: 'both', help: 'Serve a file you paste or upload instead of the real one.' },
};

// Types the page script (fetch / XHR wrapper) handles.
export const PAGE_TYPES = ['requestBody', 'responseEdit', 'responseMock', 'delay', 'pause', 'mapLocal', 'userAgent'];

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export const UA_PRESETS = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeDesktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  firefoxDesktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
};

export function uid(prefix = 'r') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function defaultConfig(type) {
  switch (type) {
    case 'redirect': return { target: '' };
    case 'replace': return { from: '', to: '' };
    case 'query': return { params: [{ op: 'add', key: '', value: '' }] };
    case 'headers': return { request: [], response: [] };
    case 'userAgent': return { preset: 'iphone', value: UA_PRESETS.iphone };
    case 'mapRemote': return { from: '', to: '' };
    case 'requestBody': return { mode: 'fixed', value: '', code: 'return body;' };
    case 'responseEdit': return { mode: 'merge', value: '{}', code: 'return data;', status: '' };
    case 'responseMock': return { status: 200, contentType: 'application/json', headers: [], body: '{}' };
    case 'delay': return { ms: 1000 };
    case 'insertScript': return { kind: 'js', code: '', runAt: 'document_idle' };
    case 'mapLocal': return { content: '', contentType: 'text/javascript', base64: false, fileName: '' };
    default: return {};
  }
}

export function newRule(type = 'redirect', extra = {}) {
  return {
    id: uid('r'),
    name: RULE_TYPES[type]?.label || type,
    enabled: true,
    groupId: null,
    type,
    match: { urlType: 'contains', url: '', methods: [], site: '' },
    config: defaultConfig(type),
    ...extra,
  };
}

// "https://Shop.example.com:8080/path" -> "shop.example.com"
export function normalizeSite(site) {
  let s = String(site || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#]/)[0];
  s = s.replace(/:\d+$/, '');
  return s.replace(/^\*\./, '');
}

export function siteMatches(site, hostname) {
  const s = normalizeSite(site);
  if (!s) return true;
  const h = String(hostname || '').toLowerCase();
  return h === s || h.endsWith('.' + s);
}

export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function wildcardToRegExpSource(pattern) {
  return '^' + String(pattern).split('*').map(escapeRegExp).join('.*') + '$';
}

export function urlMatches(match, url) {
  const v = (match && match.url) || '';
  if (!v) return true;
  switch (match.urlType) {
    case 'exact':
      return url === v;
    case 'wildcard':
      return new RegExp(wildcardToRegExpSource(v)).test(url);
    case 'regex':
      try { return new RegExp(v).test(url); } catch { return false; }
    default:
      return url.toLowerCase().includes(v.toLowerCase());
  }
}

export function methodMatches(match, method) {
  const list = (match && match.methods) || [];
  return !list.length || list.includes(String(method || 'GET').toUpperCase());
}

export function isRuleActive(rule, groups, settings) {
  if (settings && settings.enabled === false) return false;
  if (!rule || !rule.enabled) return false;
  if (rule.groupId) {
    const g = (groups || []).find((x) => x.id === rule.groupId);
    if (g && g.enabled === false) return false;
  }
  return true;
}

export function activeRules(state) {
  const { rules = [], groups = [], settings = {} } = state || {};
  return rules.filter((r) => isRuleActive(r, groups, settings));
}

// Rules the page script needs for one frame.
export function pageRulesFor(state, frameUrl) {
  let host = '';
  try { host = new URL(frameUrl).hostname; } catch {}
  return activeRules(state).filter((r) => PAGE_TYPES.includes(r.type) && siteMatches(r.match?.site, host));
}

// Full check used by the page script and debugger mode.
export function ruleMatchesRequest(rule, url, method, initiatorHost) {
  if (!siteMatches(rule.match?.site, initiatorHost)) return false;
  if (!methodMatches(rule.match, method)) return false;
  return urlMatches(rule.match, url);
}

export function deepMerge(target, patch) {
  if (Array.isArray(patch) || patch === null || typeof patch !== 'object') return patch;
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v);
  return out;
}

export const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found',
  304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error',
  502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};

// Short text for the rules list, like "URL contains /cart · POST · on shop.com".
export function matchSummary(rule) {
  const m = rule.match || {};
  const parts = [];
  if (rule.type === 'mapRemote') parts.push(`${rule.config?.from || '?'} → ${rule.config?.to || '?'}`);
  else if (m.url) parts.push(`URL ${m.urlType || 'contains'} ${m.url}`);
  else parts.push('Any URL');
  if (m.methods?.length) parts.push(m.methods.join(', '));
  if (m.site) parts.push(`on ${m.site}`);
  return parts.join(' · ');
}

// Basic checks before saving. Returns an error text or ''.
export function validateRule(rule) {
  const c = rule.config || {};
  const m = rule.match || {};
  if (m.urlType === 'regex' && m.url) {
    try { new RegExp(m.url); } catch (e) { return `Bad regex: ${e.message}`; }
  }
  switch (rule.type) {
    case 'redirect':
      if (!c.target) return 'Enter the URL to redirect to.';
      if (!/^[a-z][a-z0-9+.-]*:/i.test(c.target)) return 'Redirect URL must start with http:// or https://';
      if (!/(\\|\$)\d/.test(c.target) && urlMatches(m, c.target)) return 'The redirect URL also matches this rule, so the call would loop forever. Make the URL match more exact.';
      break;
    case 'replace':
      if (!c.from) return 'Enter the text to replace.';
      if (c.to && c.to.includes(c.from)) return '"To" must not contain "From", or the URL keeps changing forever.';
      break;
    case 'query':
      if (!(c.params || []).some((p) => p.key)) return 'Add at least one param.';
      break;
    case 'headers':
      if (![...(c.request || []), ...(c.response || [])].some((h) => h.name)) return 'Add at least one header.';
      break;
    case 'userAgent':
      if (!c.value) return 'Enter a user agent.';
      break;
    case 'mapRemote':
      if (!/^https?:\/\/[^/]+/i.test(c.from || '')) return '"From" must be a URL like https://shop.com/apps/x/';
      if (!/^https?:\/\/[^/]+/i.test(c.to || '')) return '"To" must be a URL like http://localhost:3000/apps/x/';
      if (c.to.toLowerCase().startsWith(c.from.toLowerCase())) return '"To" must not start with "From", or the call keeps moving forever.';
      break;
    case 'responseMock': {
      const s = Number(c.status);
      if (!(s === 0 || (s >= 200 && s <= 599))) return 'Status must be 0 (network error) or 200-599.';
      break;
    }
    case 'responseEdit':
      if (c.mode === 'merge') {
        try { JSON.parse(c.value || '{}'); } catch (e) { return `Merge JSON is not valid: ${e.message}`; }
      }
      if (c.status && !(Number(c.status) >= 200 && Number(c.status) <= 599)) return 'Status must be 200-599.';
      break;
    case 'delay':
      if (!(Number(c.ms) >= 0)) return 'Delay must be a number of ms.';
      break;
    case 'insertScript':
      if (!c.code) return 'Enter the code.';
      break;
    case 'mapLocal':
      if (!m.url) return 'Enter the URL to replace.';
      break;
  }
  return '';
}
