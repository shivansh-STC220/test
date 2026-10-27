// Step 5 + 6: Insert script / CSS (B13), Map local (B14), Debugger mode (C3).
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { APP, STORE, startServers } from '../fixtures/servers.mjs';
import { newRule } from '../../src/shared/rules.js';
import { launch, waitFor } from './helpers.mjs';

const rule = (type, match = {}, config = {}, extra = {}) => {
  const r = newRule(type, extra);
  r.match = { ...r.match, ...match };
  r.config = { ...r.config, ...config };
  return r;
};

describe('insert script, map local, debugger mode', () => {
  let h;
  let servers;
  let page;
  let tabId;

  before(async () => {
    servers = await startServers();
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

  // Tell the extension that the "Allow User Scripts" switch changed (the rules page checks it).
  async function userScripts(on) {
    await h.setUserScripts(on);
    const rp = await h.ctx.newPage();
    await rp.goto(h.url('rules.html'));
    await rp.getByTestId('us-banner').filter({ hasText: on ? 'User scripts are on' : 'One-time setup' }).waitFor();
    await waitFor(async () => (await h.storage('env')).env?.userScripts === on, { message: 'env flag' });
    await rp.close();
    await new Promise((r) => setTimeout(r, 300)); // sync after the flag changed
  }

  const insertRules = () => [
    rule('insertScript', { url: 'localhost:4100' }, { kind: 'js', code: "window.__inserted = 'yes';", runAt: 'document_end' }, { name: 'Insert JS' }),
    rule('insertScript', { url: 'localhost:4100' }, { kind: 'css', code: 'body { color: rgb(9, 8, 7) !important; }', runAt: 'document_start' }, { name: 'Insert CSS' }),
  ];

  it('B13: insert JS and CSS without user scripts (pages that allow inline scripts)', async () => {
    await h.setRules({ rules: insertRules() });
    await page.reload();
    await page.waitForFunction(() => window.__inserted === 'yes');
    await waitFor(() => page.evaluate(() => getComputedStyle(document.body).color === 'rgb(9, 8, 7)'), { message: 'css' });
    // A strict CSP page blocks the inline script, but CSS still works.
    const csp = await h.open(`${STORE}/csp`);
    await waitFor(() => csp.evaluate(() => getComputedStyle(document.body).color === 'rgb(9, 8, 7)'), { message: 'css on csp page' });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await csp.evaluate(() => window.__inserted), undefined);
    await csp.close();
  });

  it('JS in rules on a strict CSP page: fails with a clear error, then works with user scripts', async () => {
    const r = rule('requestBody', { url: '/api/echo?csp=1' }, { mode: 'js', code: "return body + '-changed';" }, { name: 'CSP body' });
    await h.setRules({ rules: [r] });
    const csp = await h.open(`${STORE}/csp`);
    const cspTab = await h.tabId(csp);
    await csp.click('#csp-btn');
    await csp.waitForFunction(() => window.__cspEcho);
    assert.equal(await csp.evaluate(() => window.__cspEcho.body), 'original');
    const c = await h.waitDone(cspTab, (x) => x.url.includes('csp=1'));
    assert.match(c.ruleErrors[0], /Allow User Scripts/);
    await csp.close();

    await userScripts(true);
    const csp2 = await h.open(`${STORE}/csp`);
    await csp2.click('#csp-btn');
    await csp2.waitForFunction(() => window.__cspEcho);
    assert.equal(await csp2.evaluate(() => window.__cspEcho.body), 'original-changed');
    await csp2.close();
  });

  it('B13: with user scripts on, insert script works even on strict CSP pages', async () => {
    await h.setRules({ rules: insertRules() });
    const csp = await h.open(`${STORE}/csp`);
    await csp.waitForFunction(() => window.__inserted === 'yes');
    await waitFor(() => csp.evaluate(() => getComputedStyle(document.body).color === 'rgb(9, 8, 7)'), { message: 'css' });
    await csp.close();
    await userScripts(false);
  });

  it('B14: map local serves your file instead of the real script, and for fetch', async () => {
    await h.setRules({
      rules: [
        rule('mapLocal', { url: '/assets/theme.js' }, { content: "window.__mapped = 'local-theme';", contentType: 'text/javascript' }, { name: 'Local theme' }),
        rule('mapLocal', { url: '/cart.js' }, { content: '{"items":[],"local":true}', contentType: 'application/json' }, { name: 'Local cart' }),
      ],
    });
    await page.reload();
    await page.waitForFunction(() => window.__mapped === 'local-theme');
    servers.clearLog();
    const res = await page.evaluate(() => fetch('/cart.js').then((r) => r.json()));
    assert.equal(res.local, true);
    assert.ok(!servers.log.some((l) => l.path === '/cart.js'), 'server not called');
    const row = await h.waitCall(tabId, (x) => x.type === 'network' && x.url.endsWith('/assets/theme.js'), 'script row');
    assert.equal(row.rules[0].name, 'Local theme');
  });

  it('C3: debugger mode changes the body of a plain form post', async () => {
    await page.reload();
    const panel = await h.openPanel(tabId);
    await panel.getByTestId('debugger-toggle').click();
    await panel.getByTestId('note').filter({ hasText: 'Debugger mode is on' }).waitFor();
    assert.equal(await panel.getByTestId('debugger-toggle').getAttribute('aria-checked'), 'true');

    await h.setRules({ rules: [rule('requestBody', { url: '/cart/add', methods: ['POST'] }, { mode: 'fixed', value: 'id=40123&quantity=5' }, { name: 'Form qty 5' })] });
    await Promise.all([page.waitForURL(/\/cart$/), page.click('#form-add')]);
    assert.equal(await page.textContent('#form-body'), 'id=40123&quantity=5');
    const row = await h.waitCall(tabId, (x) => x.type === 'network' && x.method === 'POST' && x.url.endsWith('/cart/add'), 'form post row');
    assert.equal(row.resourceType, 'Document');
    assert.equal(row.reqBody, 'id=40123&quantity=5');
    assert.deepEqual(row.rules.map((r) => r.name), ['Form qty 5']);
    await waitFor(async () => (await h.calls(tabId)).find((x) => x.id === row.id)?.status === 302, { message: 'status 302' });

    // Response edit on a page (document) in debugger mode.
    await h.setRules({ rules: [rule('responseEdit', { urlType: 'regex', url: '/cart(\\?|$)' }, { mode: 'replace', value: '<h1 id="replaced">Replaced</h1>' })] });
    await page.goto(`${STORE}/cart`);
    await page.locator('#replaced').waitFor();

    // Turn it off: the form post goes out as it is.
    await panel.getByTestId('debugger-toggle').click();
    await waitFor(async () => (await panel.getByTestId('debugger-toggle').getAttribute('aria-checked')) === 'false', { message: 'off' });
    await h.setRules({ rules: [rule('requestBody', { url: '/cart/add', methods: ['POST'] }, { mode: 'fixed', value: 'id=40123&quantity=5' })] });
    await page.goto(`${STORE}/`);
    await Promise.all([page.waitForURL(/\/cart$/), page.click('#form-add')]);
    assert.equal(await page.textContent('#form-body'), 'id=40123&quantity=1&add=');
    await panel.close();
  });

  it('C3: debugger mode keeps cross-site iframes working (Shopify admin style)', async () => {
    const admin = await h.open(`${STORE}/admin`);
    const adminTab = await h.tabId(admin);
    const r = await h.sw().evaluate(() => 0); // keep the worker awake
    assert.equal(r, 0);
    const panel = await h.openPanel(adminTab);
    await panel.getByTestId('debugger-toggle').click();
    await panel.getByTestId('note').filter({ hasText: 'Debugger mode is on' }).waitFor();
    await admin.reload();
    const app = admin.frameLocator('#app');
    await app.locator('#save-btn').click({ timeout: 15000 });
    await app.locator('#save-result').filter({ hasText: 'saved' }).waitFor();
    const c = await h.waitDone(adminTab, (x) => x.url === `${APP}/api/settings`);
    assert.deepEqual(c.click.react.chain.slice(-1), ['SaveButton']);
    await panel.getByTestId('debugger-toggle').click();
    await panel.close();
    await admin.close();
  });
});
