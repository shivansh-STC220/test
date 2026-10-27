// Captured calls live in IndexedDB, so they survive the service worker going to sleep.
// "calls" holds the small part (for the list), "bodies" holds request / response bodies.

const BODY_KEYS = ['reqBody', 'resBody'];
const MAX_PER_TAB = 3000;

let dbPromise = null;

function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('api-inspector', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      const calls = d.createObjectStore('calls', { keyPath: 'key' });
      calls.createIndex('tab', 'tabId');
      d.createObjectStore('bodies', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Writes run one after another, so a call's "start" is always saved before its "end".
let queue = Promise.resolve();
function serial(fn) {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

const keyOf = (tabId, id) => `${tabId}:${id}`;

function mergeRules(a = [], b = []) {
  const out = [...a];
  for (const r of b) if (!out.some((x) => x.id === r.id && x.layer === r.layer)) out.push(r);
  return out;
}

// Insert or update one call. Returns the merged summary (no bodies).
export function upsertCall(tabId, id, data) {
  return serial(async () => {
    const d = await db();
    const t = d.transaction(['calls', 'bodies'], 'readwrite');
    const calls = t.objectStore('calls');
    const bodies = t.objectStore('bodies');
    const key = keyOf(tabId, id);
    const old = (await wrap(calls.get(key))) || { key, tabId, id };
    const summary = { ...old };
    const bodyPart = {};
    for (const [k, v] of Object.entries(data)) {
      if (BODY_KEYS.includes(k)) bodyPart[k] = v;
      else if (k === 'rules') summary.rules = mergeRules(old.rules, v);
      else summary[k] = v;
    }
    summary.key = key;
    summary.tabId = tabId;
    summary.id = id;
    if ('reqBody' in bodyPart) summary.hasReqBody = bodyPart.reqBody != null && bodyPart.reqBody !== '';
    if ('resBody' in bodyPart) summary.hasResBody = bodyPart.resBody != null && bodyPart.resBody !== '';
    calls.put(summary);
    if (Object.keys(bodyPart).length) {
      const oldB = (await wrap(bodies.get(key))) || { key };
      bodies.put({ ...oldB, ...bodyPart });
    }
    await done(t);
    return summary;
  });
}

export async function getCalls(tabId) {
  await queue;
  const d = await db();
  const t = d.transaction('calls', 'readonly');
  const list = await wrap(t.objectStore('calls').index('tab').getAll(tabId));
  return list.sort((a, b) => a.start - b.start);
}

export async function getCall(tabId, id) {
  await queue;
  const d = await db();
  const t = d.transaction(['calls', 'bodies'], 'readonly');
  const key = keyOf(tabId, id);
  const [c, b] = await Promise.all([wrap(t.objectStore('calls').get(key)), wrap(t.objectStore('bodies').get(key))]);
  if (!c) return null;
  return { ...c, reqBody: b?.reqBody ?? null, resBody: b?.resBody ?? null };
}

export async function exportCalls(tabId) {
  await queue;
  const d = await db();
  const t = d.transaction(['calls', 'bodies'], 'readonly');
  const list = await wrap(t.objectStore('calls').index('tab').getAll(tabId));
  const bodies = t.objectStore('bodies');
  const out = [];
  for (const c of list.sort((a, b) => a.start - b.start)) {
    const b = await wrap(bodies.get(c.key));
    const { key, tabId: _t, hasReqBody, hasResBody, ...rest } = c;
    out.push({ ...rest, reqBody: b?.reqBody ?? null, resBody: b?.resBody ?? null });
  }
  return out;
}

// Delete a tab's calls. With "before", only calls that started before that time.
export function clearCalls(tabId, before = Infinity) {
  return serial(async () => {
    const d = await db();
    const t = d.transaction(['calls', 'bodies'], 'readwrite');
    const calls = t.objectStore('calls');
    const bodies = t.objectStore('bodies');
    const list = await wrap(calls.index('tab').getAll(tabId));
    for (const c of list) {
      if ((c.start ?? 0) < before) {
        calls.delete(c.key);
        bodies.delete(c.key);
      }
    }
    await done(t);
  });
}

export function clearAll() {
  return serial(async () => {
    const d = await db();
    const t = d.transaction(['calls', 'bodies'], 'readwrite');
    t.objectStore('calls').clear();
    t.objectStore('bodies').clear();
    await done(t);
  });
}

// Keep each tab under MAX_PER_TAB calls.
export function prune(tabId) {
  return serial(async () => {
    const d = await db();
    const t = d.transaction(['calls', 'bodies'], 'readwrite');
    const calls = t.objectStore('calls');
    const count = await wrap(calls.index('tab').count(tabId));
    if (count > MAX_PER_TAB) {
      const list = (await wrap(calls.index('tab').getAll(tabId))).sort((a, b) => a.start - b.start);
      const bodies = t.objectStore('bodies');
      for (const c of list.slice(0, count - MAX_PER_TAB + 200)) {
        calls.delete(c.key);
        bodies.delete(c.key);
      }
    }
    await done(t);
  });
}
