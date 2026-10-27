// Step 4: page rules (B8-B12), replay (C1), API client (C2).
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL, STORE, startServers } from '../fixtures/servers.mjs';
import { newRule } from '../../src/shared/rules.js';
import { launch, waitFor } from './helpers.mjs';

const rule = (type, match = {}, config = {}, extra = {}) => {
  const r = newRule(type, extra);
  r.match = { ...r.match, ...match };
  r.config = { ...r.config, ...config };
  return r;
};

const pageFetch = (page, url, init) => page.evaluate(async ({ url, init }) => {
  const t0 = performance.now();
  try {
    const r = await fetch(url, init);
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: r.ok, status: r.status, json, text, ms: performance.now() - t0, headers: Object.fromEntries(r.headers), url: r.url };
  } catch (e) {
    return { error: e.message, name: e.name, ms: performance.now() - t0 };
  }
}, { url, init });

// XHR from the page; returns what the page's handlers saw.
const pageXhr = (page, { method = 'GET', url, body = null, responseType = '', headers = {} }) => page.evaluate(({ method, url, body, responseType, headers }) => new Promise((resolve) => {
  const xhr = new XMLHttpRequest();
  const states = [];
  xhr.open(method, url);
  for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
  xhr.responseType = responseType;
  xhr.onreadystatechange = () => states.push(xhr.readyState);
  xhr.onload = () => resolve({
    status: xhr.status,
    text: responseType === '' || responseType === 'text' ? xhr.responseText : null,
    response: responseType === 'json' ? xhr.response : null,
    ct: xhr.getResponseHeader('content-type'),
    states,
    event: 'load',
  });
  xhr.onerror = () => resolve({ event: 'error', status: xhr.status, states });
  xhr.send(body);
}), { method, url, body, responseType, headers });

describe('page rules and tools', () => {
  let h;
  let servers;
  let page;
  let tabId;

  before(async () => {
    servers = await startServers({ withApp: false });
    h = await launch();
    page = await h.open(`${STORE}/`);
    tabId = await h.tabId(page);
  });

  after(async () => {
    await h?.close();
    await servers?.close();
  });

  beforeEach(async () => {
    await h.setRules({ rules: [] });
  });

  // Page rules reach the page by message; give it a moment after saving.
  const settle = () => new Promise((r) => setTimeout(r, 100));

  it('B8: request body - fixed body (fetch) and the call shows the rule', async () => {
    await h.setRules({ rules: [rule('requestBody', { url: '/api/echo?rb=1' }, { mode: 'fixed', value: '{"quantity":999}' }, { name: 'Fixed body' })] });
    await settle();
    const res = await pageFetch(page, '/api/echo?rb=1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"quantity":1}' });
    assert.equal(res.json.body, '{"quantity":999}');
    const c = await h.waitDone(tabId, (x) => x.url.endsWith('rb=1'));
    assert.equal(c.reqBody, '{"quantity":999}');
    assert.equal(c.edited, true);
    assert.deepEqual(c.rules.map((r) => r.name), ['Fixed body']);
  });

  it('B8: request body - JS function for fetch, XHR and sendBeacon', async () => {
    await h.setRules({
      rules: [
        rule('requestBody', { url: '/api/echo?rb=2' }, { mode: 'js', code: 'const d = JSON.parse(body); d.qty = 5; return d;' }),
        rule('requestBody', { url: '/api/echo?rb=3' }, { mode: 'fixed', value: 'changed' }),
      ],
    });
    await settle();
    const f = await pageFetch(page, '/api/echo?rb=2', { method: 'POST', body: '{"hello":"world"}' });
    assert.equal(f.json.body, '{"hello":"world","qty":5}');
    const x = await pageXhr(page, { method: 'POST', url: '/api/echo?rb=2', body: '{"a":1}' });
    assert.equal(JSON.parse(x.text).body, '{"a":1,"qty":5}');
    await page.evaluate(() => navigator.sendBeacon('/api/echo?rb=3', 'original'));
    await waitFor(() => servers.log.find((l) => l.query === '?rb=3'), { message: 'beacon on server' });
    assert.equal(servers.log.find((l) => l.query === '?rb=3').body, 'changed');
  });

  it('B8: form bodies stay form bodies after a change', async () => {
    await h.setRules({ rules: [rule('requestBody', { url: '/api/echo?rb=4' }, { mode: 'js', code: "return body.replace('quantity=1', 'quantity=7');" })] });
    await settle();
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/echo?rb=4', { method: 'POST', body: new URLSearchParams({ id: '1', quantity: '1' }) });
      return r.json();
    });
    assert.equal(res.body, 'id=1&quantity=7');
    assert.match(res.headers['content-type'], /application\/x-www-form-urlencoded/);
  });

  it('B9: response edit - merge JSON, for fetch and XHR (text and json types)', async () => {
    await h.setRules({ rules: [rule('responseEdit', { url: '/cart.js' }, { mode: 'merge', value: '{"item_count": 0, "note": "edited"}' }, { name: 'Empty count' })] });
    await settle();
    const f = await pageFetch(page, '/cart.js?e=1');
    assert.equal(f.json.item_count, 0);
    assert.equal(f.json.note, 'edited');
    assert.equal(f.json.items.length, 2, 'other keys are kept');
    assert.equal(f.url, `${STORE}/cart.js?e=1`, 'response.url is kept');
    const x = await pageXhr(page, { url: '/cart.js?e=2' });
    assert.equal(x.event, 'load');
    assert.equal(JSON.parse(x.text).item_count, 0);
    assert.equal(x.ct, 'application/json');
    assert.deepEqual(x.states, [2, 3, 4]);
    const j = await pageXhr(page, { url: '/cart.js?e=3', responseType: 'json' });
    assert.equal(j.response.note, 'edited');
    const c = await h.waitDone(tabId, (y) => y.url.endsWith('/cart.js?e=1'));
    assert.match(c.resBody, /"note":"edited"/);
    assert.equal(c.rules[0].name, 'Empty count');
  });

  it('B9: response edit - JS function and new status', async () => {
    await h.setRules({ rules: [rule('responseEdit', { url: '/cart.js' }, { mode: 'js', code: 'data.items = []; return data;', status: '201' })] });
    await settle();
    const f = await pageFetch(page, '/cart.js?e=4');
    assert.equal(f.status, 201);
    assert.deepEqual(f.json.items, []);
  });

  it('B10: response mock - fake status and body, no server call (fetch and XHR)', async () => {
    await h.setRules({ rules: [rule('responseMock', { url: '/api/mock-me' }, { status: 429, body: '{"error":"slow down"}' }, { name: 'Mock 429' })] });
    await settle();
    servers.clearLog();
    const f = await pageFetch(page, '/api/mock-me');
    assert.equal(f.status, 429);
    assert.equal(f.json.error, 'slow down');
    const x = await pageXhr(page, { url: '/api/mock-me?x' });
    assert.equal(x.status, 429);
    assert.equal(JSON.parse(x.text).error, 'slow down');
    assert.ok(!servers.log.some((l) => l.path === '/api/mock-me'), 'server never called');
    const c = await h.waitDone(tabId, (y) => y.url.endsWith('/api/mock-me'));
    assert.equal(c.mocked, true);
    assert.equal(c.status, 429);
  });

  it('B10: response mock - network error (status 0)', async () => {
    await h.setRules({ rules: [rule('responseMock', { url: '/api/offline' }, { status: 0 })] });
    await settle();
    const f = await pageFetch(page, '/api/offline');
    assert.equal(f.error, 'Failed to fetch');
    const x = await pageXhr(page, { url: '/api/offline' });
    assert.equal(x.event, 'error');
    assert.equal(x.status, 0);
  });

  it('B11: delay waits before sending', async () => {
    await h.setRules({ rules: [rule('delay', { url: '/api/echo?delay=1' }, { ms: 800 })] });
    await settle();
    const f = await pageFetch(page, '/api/echo?delay=1');
    assert.ok(f.ms >= 790, `took ${f.ms}`);
    const c = await h.waitDone(tabId, (y) => y.url.endsWith('delay=1'));
    assert.ok(c.duration >= 790);
    const quick = await pageFetch(page, '/api/echo?delay=0');
    assert.ok(quick.ms < 500, 'other calls are not delayed');
  });

  it('B12: pause & edit in the panel - Send with changes, and Drop', async () => {
    await h.setRules({ rules: [rule('pause', { url: '/api/echo?pause=' }, {}, { name: 'Pause echo' })] });
    await settle();
    const panel = await h.openPanel(tabId);
    const pending = pageFetch(page, '/api/echo?pause=1', { method: 'POST', body: '{"edited":false}' });
    const card = panel.getByTestId('paused-card');
    await card.waitFor();
    assert.equal(await panel.getByTestId('paused-body').inputValue(), '{"edited":false}');
    await panel.getByTestId('paused-body').fill('{"edited":true}');
    await panel.getByTestId('paused-url').fill(`${STORE}/api/echo?pause=1&x=2`);
    await panel.getByTestId('paused-send').click();
    const res = await pending;
    assert.equal(res.json.body, '{"edited":true}');
    assert.equal(res.json.query.x, '2');
    await card.waitFor({ state: 'detached' });

    // Drop
    const dropped = pageFetch(page, '/api/echo?pause=2');
    await card.waitFor();
    await panel.getByTestId('paused-drop').click();
    assert.equal((await dropped).error, 'Failed to fetch');

    // XHR can be paused too.
    const xhr = pageXhr(page, { method: 'POST', url: '/api/echo?pause=3', body: 'a' });
    await card.waitFor();
    await panel.getByTestId('paused-body').fill('b');
    await panel.getByTestId('paused-send').click();
    assert.equal(JSON.parse((await xhr).text).body, 'b');
    await panel.close();
  });

  it('B12: without DevTools open, a small window opens for the paused call', async () => {
    await h.setRules({ rules: [rule('pause', { url: '/api/echo?pause=win' })] });
    await settle();
    const winPromise = h.ctx.waitForEvent('page', { predicate: (p) => p.url().includes('pause.html') });
    const pending = pageFetch(page, '/api/echo?pause=win', { method: 'POST', body: 'x' });
    const win = await winPromise;
    await win.getByTestId('paused-card').waitFor();
    await win.getByTestId('paused-send').click();
    assert.equal((await pending).json.body, 'x');
    await win.close();
  });

  it('C1: replay a captured call', async () => {
    await page.click('#echo-btn');
    await h.waitDone(tabId, (x) => x.url.includes('/api/echo?a=1'));
    servers.clearLog();
    const panel = await h.openPanel(tabId);
    await panel.locator('[data-testid="call-row"][data-url*="/api/echo?a=1"]').first().click();
    await panel.getByTestId('btn-replay').click();
    await panel.getByTestId('replay-result').filter({ hasText: 'Replayed: 200' }).waitFor();
    const hit = servers.log.find((l) => l.path === '/api/echo' && l.query === '?a=1&b=2');
    assert.ok(hit, 'server got the replay');
    assert.equal(hit.body, '{"hello":"world"}');
    assert.equal(hit.headers['x-test'], 'yes');
    await h.waitDone(tabId, (x) => x.type === 'replay' && x.url.includes('/api/echo?a=1'), 'replay row');
    await panel.close();
  });

  it('C2: API client sends from the extension and from the page', async () => {
    const panel = await h.openPanel(tabId);
    await panel.getByTestId('tab-client').click();
    await panel.getByTestId('client-method').selectOption('POST');
    await panel.getByTestId('client-url').fill(`${LOCAL}/api/echo?from=client`);
    await panel.getByTestId('client-headers').fill('X-Client: one\nContent-Type: application/json');
    await panel.getByTestId('client-body').fill('{"x":1}');
    await panel.getByTestId('client-send').click();
    await panel.getByTestId('client-status').filter({ hasText: '200' }).waitFor();
    const body = await panel.getByTestId('client-body-view').textContent();
    assert.match(body, /"x-client": "one"/);
    assert.match(body, /"server": "local"/);
    await h.waitDone(tabId, (x) => x.type === 'client' && x.url.includes('from=client'), 'client row');

    await panel.getByTestId('client-from-page').check();
    await panel.getByTestId('client-method').selectOption('GET');
    await panel.getByTestId('client-url').fill(`${STORE}/api/echo?from=page`);
    await panel.getByTestId('client-send').click();
    await panel.getByTestId('client-status').filter({ hasText: '200' }).waitFor();
    const fromPage = servers.log.find((l) => l.query === '?from=page');
    assert.match(fromPage.headers.referer || '', /localhost:4100/, 'sent by the page');
    // "Edit & send" fills the client from a captured call.
    await panel.getByTestId('tab-calls').click();
    await panel.locator('[data-testid="call-row"][data-url*="/api/echo?a=1"]').first().click();
    await panel.getByTestId('btn-edit-send').click();
    await waitFor(async () => (await panel.getByTestId('client-url').inputValue()) === `${STORE}/api/echo?a=1&b=2`, { message: 'client URL filled' });
    assert.equal(await panel.getByTestId('client-body').inputValue(), '{"hello":"world"}');
    await panel.close();
  });
});
