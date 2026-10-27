import { BODY_CAP } from '../shared/bridge.js';

export const CAP = BODY_CAP;

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function resolveUrl(u) {
  try {
    return new URL(String(u), document.baseURI).href;
  } catch {
    return String(u);
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function capText(text) {
  if (text == null) return { text: null, size: 0, truncated: false };
  const s = String(text);
  if (s.length > CAP) return { text: s.slice(0, CAP), size: s.length, truncated: true };
  return { text: s, size: s.length, truncated: false };
}

export function headersToObject(h) {
  const out = {};
  if (!h) return out;
  if (typeof Headers !== 'undefined' && h instanceof Headers) {
    h.forEach((v, k) => { out[k] = v; });
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) out[String(k).toLowerCase()] = String(v);
  } else if (typeof h === 'object') {
    for (const k of Object.keys(h)) out[k.toLowerCase()] = String(h[k]);
  }
  return out;
}

export function parseRawHeaders(raw) {
  const out = {};
  for (const line of String(raw || '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

export function isBinaryType(ct) {
  const t = String(ct || '').toLowerCase();
  if (!t) return false;
  if (/json|xml|text|javascript|ecmascript|x-www-form-urlencoded|graphql|csv|html|svg/.test(t)) return false;
  return /^(image|audio|video|font)\/|octet-stream|zip|pdf|protobuf|wasm|msgpack/.test(t);
}

// Readable text for a request body of any kind.
export async function bodyToText(body) {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const lines = [];
    for (const [k, v] of body.entries()) lines.push(`${k}=${typeof v === 'string' ? v : `[File ${v.name} ${v.size} B]`}`);
    return lines.join('\n');
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    if (body.size > CAP * 2 || isBinaryType(body.type)) return `[Blob ${body.type || 'unknown'} ${body.size} B]`;
    return body.text();
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    const u8 = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    if (u8.length > CAP * 2) return `[Binary ${u8.length} B]`;
    return new TextDecoder().decode(u8);
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return '[Stream body]';
  if (typeof Document !== 'undefined' && body instanceof Document) return new XMLSerializer().serializeToString(body);
  return String(body);
}

// Same as bodyToText but never waits. Used for sync XHR and beacons.
export function bodyToTextSync(body) {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof Blob !== 'undefined' && body instanceof Blob) return `[Blob ${body.type || 'unknown'} ${body.size} B]`;
  return null;
}

// After a rule or a manual edit gives new body text, keep the body's original kind
// so the Content-Type stays right (form posts stay form posts).
export function restoreBody(text, original) {
  if (original instanceof URLSearchParams) return new URLSearchParams(text);
  if (typeof FormData !== 'undefined' && original instanceof FormData) {
    const fd = new FormData();
    const files = new Map();
    for (const [k, v] of original.entries()) if (typeof v !== 'string') files.set(`${k}=[File ${v.name} ${v.size} B]`, [k, v]);
    for (const line of String(text).split('\n')) {
      if (!line) continue;
      if (files.has(line)) { const [k, v] = files.get(line); fd.append(k, v); continue; }
      const i = line.indexOf('=');
      if (i < 0) fd.append(line, '');
      else fd.append(line.slice(0, i), line.slice(i + 1));
    }
    return fd;
  }
  if (typeof Blob !== 'undefined' && original instanceof Blob) return new Blob([text], { type: original.type });
  return text;
}

export function b64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Read a response stream, but stop after the size cap.
export async function readCapped(stream) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let text = '';
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    text += dec.decode(value, { stream: true });
    if (text.length > CAP) {
      truncated = true;
      text = text.slice(0, CAP);
      reader.cancel().catch(() => {});
      break;
    }
  }
  if (!truncated) text += dec.decode();
  return { text, size, truncated };
}

const STACK_LINE = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

export function parseStack(stack, max = 15) {
  const frames = [];
  for (const line of String(stack || '').split('\n')) {
    const m = STACK_LINE.exec(line);
    if (!m) continue;
    const url = m[2];
    if (url.startsWith('chrome-extension://') || url.startsWith('<anonymous>')) continue;
    frames.push({ fn: m[1] || '', url, line: Number(m[3]), col: Number(m[4]) });
    if (frames.length >= max) break;
  }
  return frames;
}

export function captureStack() {
  const limit = Error.stackTraceLimit;
  try {
    Error.stackTraceLimit = 50;
    return parseStack(new Error().stack);
  } catch {
    return [];
  } finally {
    Error.stackTraceLimit = limit;
  }
}

// Library code is not "where the call was made" for you, so skip it when we can.
const LIB = /\/node_modules\/|\/\.vite\/deps\/|react-dom|\/react[.-]|scheduler|jquery|axios|zone\.js|polyfill|chunk-vendors|\/vendors?[.~-]|shopifycloud|jsx-dev-runtime|jsx-runtime/i;

export function pickSource(frames) {
  if (!frames || !frames.length) return null;
  return frames.find((f) => !LIB.test(f.url)) || frames[0];
}
