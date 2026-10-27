// Turns our rules into Chrome declarativeNetRequest (network) rules.
// One rule can become more than one network rule.
import { escapeRegExp, normalizeSite, wildcardToRegExpSource } from './rules.js';

export const ALL_RESOURCE_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other',
];

// Network rules for these types are made here. Page-only types return [].
export const NETWORK_TYPES = ['redirect', 'replace', 'query', 'headers', 'block', 'userAgent', 'mapRemote', 'mapLocal'];

// Escape text for a regexSubstitution (only "\" is special there).
function escapeSub(s) {
  return String(s).replace(/\\/g, '\\\\');
}

// Condition part that comes from the URL match.
export function urlCondition(match) {
  const v = (match && match.url) || '';
  if (!v) return {};
  switch (match.urlType) {
    case 'exact':
      return { regexFilter: '^' + escapeRegExp(v) + '$', isUrlFilterCaseSensitive: true };
    case 'wildcard':
      return { regexFilter: wildcardToRegExpSource(v), isUrlFilterCaseSensitive: true };
    case 'regex':
      return { regexFilter: v, isUrlFilterCaseSensitive: true };
    default:
      // urlFilter treats * ^ | as special, so fall back to a regex when the text has them.
      if (/[*^|]/.test(v)) return { regexFilter: escapeRegExp(v), isUrlFilterCaseSensitive: false };
      return { urlFilter: v, isUrlFilterCaseSensitive: false };
  }
}

function baseCondition(rule, { url = true, resourceTypes = ALL_RESOURCE_TYPES } = {}) {
  const m = rule.match || {};
  const cond = { resourceTypes: [...resourceTypes] };
  if (url) Object.assign(cond, urlCondition(m));
  if (m.methods && m.methods.length) cond.requestMethods = m.methods.map((x) => x.toLowerCase());
  const site = normalizeSite(m.site);
  if (site) cond.initiatorDomains = [site];
  return cond;
}

function toBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function dataUrlFor(config) {
  const type = config.contentType || 'text/plain';
  const b64 = config.base64 ? config.content || '' : toBase64Utf8(config.content || '');
  return `data:${type};base64,${b64}`;
}

// Returns a list of network rules without ids. Throws with a clear message on bad input.
export function toDnrRules(rule) {
  const c = rule.config || {};
  const m = rule.match || {};
  switch (rule.type) {
    case 'redirect': {
      if (!c.target) throw new Error('Redirect URL is empty.');
      const cond = baseCondition(rule);
      // With a regex match you can use \1 or $1 in the target.
      if (m.urlType === 'regex' && /(\\|\$)\d/.test(c.target)) {
        return [{ priority: 1, action: { type: 'redirect', redirect: { regexSubstitution: c.target.replace(/\$(\d)/g, '\\$1') } }, condition: cond }];
      }
      return [{ priority: 1, action: { type: 'redirect', redirect: { url: c.target } }, condition: cond }];
    }
    case 'replace': {
      if (!c.from) throw new Error('"From" text is empty.');
      const F = escapeRegExp(c.from);
      const T = escapeSub(c.to || '');
      const cond = baseCondition(rule, { url: false });
      if (m.url) {
        // Only URLs that also contain the match text. One branch matches, the other groups are empty.
        const V = escapeRegExp(m.url);
        cond.regexFilter = `^(.*?${V}.*?)${F}(.*)$|^(.*?)${F}(.*?${V}.*)$`;
        cond.isUrlFilterCaseSensitive = true;
        return [{ priority: 1, action: { type: 'redirect', redirect: { regexSubstitution: `\\1\\3${T}\\2\\4` } }, condition: cond }];
      }
      cond.regexFilter = `^(.*?)${F}(.*)$`;
      cond.isUrlFilterCaseSensitive = true;
      return [{ priority: 1, action: { type: 'redirect', redirect: { regexSubstitution: `\\1${T}\\2` } }, condition: cond }];
    }
    case 'query': {
      const add = [];
      const remove = [];
      for (const p of c.params || []) {
        if (!p.key) continue;
        if (p.op === 'remove') remove.push(p.key);
        else add.push({ key: p.key, value: String(p.value ?? ''), replaceOnly: p.op === 'set' });
      }
      if (!add.length && !remove.length) throw new Error('No params to change.');
      const queryTransform = {};
      if (add.length) queryTransform.addOrReplaceParams = add;
      if (remove.length) queryTransform.removeParams = remove;
      return [{ priority: 1, action: { type: 'redirect', redirect: { transform: { queryTransform } } }, condition: baseCondition(rule) }];
    }
    case 'headers': {
      const conv = (list) => (list || []).filter((h) => h.name).map((h) => {
        const op = h.op || 'set';
        const out = { header: h.name.trim().toLowerCase(), operation: op };
        if (op !== 'remove') out.value = String(h.value ?? '');
        return out;
      });
      const action = { type: 'modifyHeaders' };
      const req = conv(c.request);
      const res = conv(c.response);
      if (req.length) action.requestHeaders = req;
      if (res.length) action.responseHeaders = res;
      if (!req.length && !res.length) throw new Error('No headers to change.');
      return [{ priority: 1, action, condition: baseCondition(rule) }];
    }
    case 'block':
      return [{ priority: 1, action: { type: 'block' }, condition: baseCondition(rule) }];
    case 'userAgent': {
      if (!c.value) throw new Error('User agent is empty.');
      const mobile = /Mobile|Android|iPhone|iPad/.test(c.value) ? '?1' : '?0';
      return [{
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'user-agent', operation: 'set', value: c.value },
            { header: 'sec-ch-ua-mobile', operation: 'set', value: mobile },
          ],
        },
        condition: baseCondition(rule),
      }];
    }
    case 'mapRemote': {
      const from = (c.from || '').trim();
      const to = (c.to || '').trim();
      if (!/^https?:\/\/[^/]+/i.test(from) || !/^https?:\/\/[^/]+/i.test(to)) throw new Error('Map remote needs full "From" and "To" URLs.');
      const cond = baseCondition(rule, { url: false });
      // "https://shop.com" must not also match "https://shop.com.evil.net".
      const hostOnly = /^https?:\/\/[^/?#]+$/i.test(from);
      cond.regexFilter = '^' + escapeRegExp(from) + (hostOnly ? '([/?#].*)?$' : '(.*)$');
      cond.isUrlFilterCaseSensitive = false;
      return [{ priority: 1, action: { type: 'redirect', redirect: { regexSubstitution: escapeSub(to) + '\\1' } }, condition: cond }];
    }
    case 'mapLocal': {
      // fetch / XHR are mocked by the page script (a redirect to data: breaks CORS for them).
      const cond = baseCondition(rule, { resourceTypes: ALL_RESOURCE_TYPES.filter((t) => t !== 'xmlhttprequest') });
      return [{ priority: 2, action: { type: 'redirect', redirect: { url: dataUrlFor(c) } }, condition: cond }];
    }
    default:
      return [];
  }
}
