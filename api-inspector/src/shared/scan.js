// Text search used by "Scan source": find an endpoint text in JS files,
// and list endpoint-like strings, with file, line and a short snippet.
import { STATIC_EXT } from './calls.js';

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function position(starts, index) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid; else hi = mid - 1;
  }
  return { line: lo + 1, col: index - starts[lo] + 1 };
}

function snippet(text, index, len) {
  const a = Math.max(0, index - 60);
  const b = Math.min(text.length, index + len + 60);
  return (a > 0 ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ') + (b < text.length ? '…' : '');
}

export function findOccurrences(file, text, term, limit = 200) {
  const out = [];
  if (!term) return out;
  const low = text.toLowerCase();
  const t = term.toLowerCase();
  let starts = null;
  let i = low.indexOf(t);
  while (i !== -1 && out.length < limit) {
    starts ||= lineStarts(text);
    out.push({ file, ...position(starts, i), snippet: snippet(text, i, term.length) });
    i = low.indexOf(t, i + t.length);
  }
  return out;
}

const API_PATH = /\/api\b|\/graphql|\.json(\?|$)|\/cart\b|\/apps\/|\/v\d+\/|\/rest\/|\/admin\/|\/ajax|\/webhooks?\b|\/auth|\/oauth|\/search\b|\/products?\b|\/collections\b|\/checkouts?\b|\/proxy\b/i;
const API_CONTEXT = /(fetch\s*\(|axios|\.ajax\s*\(|XMLHttpRequest|\.open\s*\(|\.(get|post|put|patch|delete)\s*\(|url\s*:|endpoint|baseURL|sendBeacon|action\s*=)/i;

// String literals that look like a path ("/api/x") or a full URL.
const LITERAL = /(["'`])((?:https?:)?\/\/[^"'`\s\\<>]{3,300}|\/[A-Za-z0-9_$:{][^"'`\s\\<>]{0,300})\1/g;

export function extractEndpoints(file, text, limit = 2000) {
  const out = [];
  let starts = null;
  LITERAL.lastIndex = 0;
  let m;
  while ((m = LITERAL.exec(text)) && out.length < limit) {
    const value = m[2];
    if (!/[a-z]/i.test(value)) continue;
    if (/^\/\/?[a-z]+\/?$/i.test(value) && !API_PATH.test(value)) continue; // "/a", "//x": too vague
    const isStatic = STATIC_EXT.test(value);
    const before = text.slice(Math.max(0, m.index - 80), m.index);
    const apiLike = !isStatic && (API_PATH.test(value) || API_CONTEXT.test(before));
    starts ||= lineStarts(text);
    out.push({ value, file, ...position(starts, m.index), apiLike, snippet: snippet(text, m.index, m[0].length) });
  }
  return out;
}
