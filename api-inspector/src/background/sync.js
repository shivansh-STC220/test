// Keeps Chrome's network rules and user scripts in step with the saved rules.
import { activeRules, wildcardToRegExpSource, normalizeSite } from '../shared/rules.js';
import { toDnrRules } from '../shared/dnr.js';
import { FNS_KEY } from '../shared/bridge.js';

const dnr = chrome.declarativeNetRequest;

export let dnrMap = {}; // network rule id -> our rule id

export async function loadDnrMap() {
  const { dnrMap: m } = await chrome.storage.session.get('dnrMap');
  if (m) dnrMap = m;
}

async function checkRegexes(list) {
  for (const d of list) {
    const re = d.condition.regexFilter;
    if (!re) continue;
    const r = await dnr.isRegexSupported({ regex: re, isCaseSensitive: d.condition.isUrlFilterCaseSensitive !== false });
    if (!r.isSupported) throw new Error(`Chrome can't use this regex (${r.reason}).`);
  }
}

export async function syncDnr(state, errors) {
  const built = [];
  for (const rule of activeRules(state)) {
    try {
      const list = toDnrRules(rule);
      if (!list.length) continue;
      await checkRegexes(list);
      built.push({ rule, list });
    } catch (e) {
      errors[rule.id] = e.message;
    }
  }
  let nextId = 1;
  const map = {};
  for (const b of built) {
    for (const d of b.list) {
      d.id = nextId++;
      map[d.id] = b.rule.id;
    }
  }
  const existing = (await dnr.getDynamicRules()).map((r) => r.id);
  const all = built.flatMap((b) => b.list);
  try {
    await dnr.updateDynamicRules({ removeRuleIds: existing, addRules: all });
  } catch {
    // One bad rule fails the whole update. Add them one by one to find it.
    await dnr.updateDynamicRules({ removeRuleIds: existing, addRules: [] });
    for (const b of built) {
      try {
        await dnr.updateDynamicRules({ addRules: b.list });
      } catch (e) {
        errors[b.rule.id] = e.message;
        for (const d of b.list) delete map[d.id];
      }
    }
  }
  dnrMap = map;
  await chrome.storage.session.set({ dnrMap: map });
}

export async function userScriptsAvailable() {
  try {
    if (!chrome.userScripts) return false;
    await chrome.userScripts.getScripts();
    return true;
  } catch {
    return false;
  }
}

function matcherCode(match) {
  const v = (match && match.url) || '';
  if (!v) return 'true';
  switch (match.urlType) {
    case 'exact': return `location.href === ${JSON.stringify(v)}`;
    case 'wildcard': return `new RegExp(${JSON.stringify(wildcardToRegExpSource(v))}).test(location.href)`;
    case 'regex': return `new RegExp(${JSON.stringify(v)}).test(location.href)`;
    default: return `location.href.toLowerCase().includes(${JSON.stringify(v.toLowerCase())})`;
  }
}

function matchesFor(rule) {
  const site = normalizeSite(rule.match?.site);
  return site ? [`*://${site}/*`, `*://*.${site}/*`] : ['<all_urls>'];
}

function insertCode(rule) {
  const c = rule.config || {};
  const body = c.kind === 'css'
    ? `var s=document.createElement('style');s.setAttribute('data-api-inspector-rule',${JSON.stringify(rule.id)});s.textContent=${JSON.stringify(c.code || '')};(document.head||document.documentElement).appendChild(s);`
    : c.code || '';
  return `if (${matcherCode(rule.match)}) {\n${body}\n}`;
}

// JS code from "Request body" / "Response - edit" rules, added as real functions,
// so they still work on pages whose CSP blocks new Function().
function fnCode(rule) {
  const params = rule.type === 'requestBody' ? 'body, request' : 'data, response, request';
  return `(function(){var k=Symbol.for(${JSON.stringify(FNS_KEY)});var reg=window[k]||(window[k]={});reg[${JSON.stringify(rule.id)}]=function(${params}){\n${rule.config?.code || ''}\n};})();`;
}

export async function syncUserScripts(state, errors) {
  const ok = await userScriptsAvailable();
  const env = (await chrome.storage.local.get('env')).env || {};
  if (env.userScripts !== ok) await chrome.storage.local.set({ env: { ...env, userScripts: ok } });
  if (!ok) return ok;
  await chrome.userScripts.unregister();
  const scripts = [];
  for (const rule of activeRules(state)) {
    if (rule.type === 'insertScript') {
      scripts.push({
        rule,
        s: { id: `ins_${rule.id}`, matches: matchesFor(rule), js: [{ code: insertCode(rule) }], runAt: rule.config?.runAt || 'document_idle', world: 'MAIN', allFrames: true },
      });
    } else if ((rule.type === 'requestBody' || rule.type === 'responseEdit') && rule.config?.mode === 'js') {
      scripts.push({
        rule,
        s: { id: `fn_${rule.id}`, matches: matchesFor(rule), js: [{ code: fnCode(rule) }], runAt: 'document_start', world: 'MAIN', allFrames: true },
      });
    }
  }
  for (const { rule, s } of scripts) {
    try {
      await chrome.userScripts.register([s]);
    } catch (e) {
      errors[rule.id] = e.message;
    }
  }
  return ok;
}
