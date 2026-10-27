// Step 1 + 2: capture (A1-A3), where-used (A4-A10), APIs view, DevTools screen (D3).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { APP, STORE, startServers } from '../fixtures/servers.mjs';
import { launch, waitFor } from './helpers.mjs';

const themeJs = await readFile(fileURLToPath(new URL('../fixtures/store/assets/theme.js', import.meta.url)), 'utf8');
const lineOf = (text, needle) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;

describe('capture and where-used', () => {
  let h;
  let servers;
  let page;
  let tabId;

  before(async () => {
    servers = await startServers();
    h = await launch();
    page = await h.open(`${STORE}/`);
    tabId = await h.tabId(page);
    await page.waitForFunction(() => window.__stockConfig);
  });

  after(async () => {
    await h?.close();
    await servers?.close();
  });

  it('A1: captures fetch with method, URL, status, time, headers and bodies', async () => {
    await page.click('#echo-btn');
    const c = await h.waitDone(tabId, (x) => x.url.includes('/api/echo?a=1'), 'echo call');
    assert.equal(c.type, 'fetch');
    assert.equal(c.method, 'POST');
    assert.equal(c.status, 200);
    assert.equal(typeof c.duration, 'number');
    assert.equal(c.reqHeaders['x-test'], 'yes');
    assert.equal(c.reqBody, '{"hello":"world"}');
    assert.match(c.resBody, /"server":"store"/);
    assert.equal(c.resHeaders['content-type'], 'application/json');
    // The page still gets its data.
    await page.waitForFunction(() => window.__echo && window.__echo.body === '{"hello":"world"}');
  });

  it('A1: captures XMLHttpRequest and the page still works', async () => {
    await page.click('#xhr-cart');
    const c = await h.waitDone(tabId, (x) => x.url.includes('/cart.js?via=xhr'), 'xhr call');
    assert.equal(c.type, 'xhr');
    assert.equal(c.status, 200);
    assert.match(c.resBody, /"item_count":2/);
    const r = await page.waitForFunction(() => window.__xhrCart).then((x) => x.jsonValue());
    assert.equal(r.status, 200);
  });

  it('A1: captures sendBeacon', async () => {
    await page.click('#beacon-btn');
    const c = await h.waitDone(tabId, (x) => x.type === 'beacon', 'beacon call');
    assert.equal(c.method, 'POST');
    assert.equal(c.status, 'queued');
    assert.equal(c.reqBody, '{"event":"click"}');
    assert.equal(await page.evaluate(() => window.__beacon), true);
  });

  it('A1: caps bodies at 1 MB, but the page gets the full body', async () => {
    await page.click('#big-btn');
    const c = await h.waitDone(tabId, (x) => x.url.endsWith('/api/big'), 'big call');
    assert.equal(c.resBodyTruncated, true);
    assert.equal(c.resBody.length, 1024 * 1024);
    const len = await page.waitForFunction(() => window.__bigLength).then((x) => x.jsonValue());
    assert.ok(len > 2 * 1024 * 1024);
  });

  it('A3: links calls to the button you clicked; page-load calls have no click', async () => {
    const echo = await h.waitDone(tabId, (x) => x.url.includes('/api/echo?a=1'));
    assert.equal(echo.click?.text, 'Echo');
    const config = await h.waitDone(tabId, (x) => x.url.endsWith('/apps/stock/api/config'));
    assert.equal(config.click, null);
  });

  it('A5: shows the Liquid section and the app block', async () => {
    await page.click('#ajax-add');
    const add = await h.waitDone(tabId, (x) => x.url.endsWith('/cart/add.js'), 'cart add');
    assert.equal(add.click.liquid.section.id, 'template--16124__main');
    assert.equal(add.click.liquid.section.name, 'main');
    await page.click('#notify-btn');
    const n = await h.waitDone(tabId, (x) => x.url.endsWith('/apps/stock/api/notify'), 'notify');
    assert.equal(n.click.liquid.block.id, 'AbC123xyz');
    assert.equal(n.click.liquid.block.appBlock, true);
    assert.equal(n.click.liquid.block.handle, 'stock-beacon');
    assert.equal(n.click.text, 'Notify me');
  });

  it('A6: shows the file and line that made the call', async () => {
    const add = await h.waitDone(tabId, (x) => x.url.endsWith('/cart/add.js'));
    assert.ok(add.source.url.endsWith('/assets/theme.js'), add.source.url);
    assert.equal(add.source.line, lineOf(themeJs, "fetch('/cart/add.js'"));
    const n = await h.waitDone(tabId, (x) => x.url.endsWith('/apps/stock/api/notify'));
    assert.ok(n.source.url.endsWith('/apps/stock/embed.js'));
  });

  it('A7: keeps button text and a CSS path', async () => {
    const add = await h.waitDone(tabId, (x) => x.url.endsWith('/cart/add.js'));
    assert.equal(add.click.text, 'Add to cart');
    assert.equal(add.click.cssPath, '#ajax-add');
    assert.equal(add.click.tag, 'button');
  });

  it('A2 + A4: works inside the admin iframe and shows the React component chain', async () => {
    const admin = await h.open(`${STORE}/admin`);
    const adminTab = await h.tabId(admin);
    const app = admin.frameLocator('#app');
    await app.locator('#save-btn').click();
    const c = await h.waitDone(adminTab, (x) => x.url === `${APP}/api/settings`, 'settings call');
    assert.equal(c.frame.top, false);
    assert.ok(c.frame.url.startsWith(APP));
    assert.equal(c.status, 200);
    assert.equal(c.reqBody, '{"theme":"dark"}');
    const chain = c.click.react.chain;
    assert.deepEqual(chain.slice(-3), ['App', 'SettingsPage', 'SaveButton']);
    assert.ok(c.click.react.source?.url.includes('/src/App.jsx'), JSON.stringify(c.click.react.source));
    assert.ok(c.source.url.includes('/src/App.jsx'), c.source.url);
    await app.locator('#save-result').filter({ hasText: 'saved' }).waitFor();

    await app.locator('#checkout-btn').click();
    const x = await h.waitDone(adminTab, (y) => y.url.includes('/api/cart-items'), 'checkout xhr');
    assert.equal(x.type, 'xhr');
    assert.deepEqual(x.click.react.chain.slice(-3), ['App', 'CartDrawer', 'CheckoutButton']);
    assert.equal(JSON.parse(x.resBody).page, '1');
    await app.locator('#checkout-result').filter({ hasText: '200' }).waitFor();
    await admin.close();
  });

  it('D3: the panel lists calls; A10: clicking a row highlights the button', async () => {
    const panel = await h.openPanel(tabId);
    const row = panel.locator('[data-testid="call-row"][data-url$="/cart/add.js"]');
    await row.first().waitFor();
    await row.first().click();
    // The button gets an outline on the page.
    await page.locator('[data-api-inspector-highlight]').waitFor({ timeout: 3000 });
    await panel.getByTestId('detail-initiator').click();
    await panel.getByTestId('init-text').filter({ hasText: 'Add to cart' }).waitFor();
    await panel.getByTestId('init-section').filter({ hasText: 'main' }).waitFor();
    await panel.getByTestId('init-source').filter({ hasText: 'theme.js:' }).waitFor();
    await panel.getByTestId('detail-overview').click();
    const sentence = await panel.getByTestId('call-sentence').textContent();
    assert.match(sentence, /^Clicked Add to cart → POST \/cart\/add\.js - 200 - \d+ ms$/);
    await panel.close();
  });

  it('D3: filters in the Calls view', async () => {
    const panel = await h.openPanel(tabId);
    await panel.locator('[data-testid="call-row"]').first().waitFor();
    const all = await panel.locator('[data-testid="call-row"]').count();
    await panel.getByTestId('f-method-POST').click();
    await waitFor(async () => (await panel.locator('[data-testid="call-row"]').count()) < all, { message: 'POST filter' });
    const methods = await panel.locator('[data-testid="call-row"]').evaluateAll((rows) => rows.map((r) => r.dataset.method));
    assert.ok(methods.length > 0 && methods.every((m) => m === 'POST'), methods.join(','));
    await panel.getByTestId('f-clear').click();
    await panel.getByTestId('f-type-xhr').click();
    await waitFor(async () => (await panel.locator('[data-testid="call-row"]').count()) === 1, { message: 'xhr filter' });
    await panel.getByTestId('f-clear').click();
    await panel.getByTestId('f-status-5xx').click();
    await page.click('#status-btn');
    await waitFor(async () => (await panel.locator('[data-testid="call-row"]').count()) === 1, { message: '5xx filter' });
    await panel.getByTestId('f-clear').click();
    await panel.getByTestId('filter-text').fill('/regex.*never/');
    await waitFor(async () => (await panel.locator('[data-testid="call-row"]').count()) === 0, { message: 'text filter' });
    await panel.close();
  });

  it('APIs view: counts the APIs the site uses, with filters', async () => {
    await page.click('#product-btn-7');
    await page.click('#product-btn-8');
    await h.waitDone(tabId, (x) => x.url.endsWith('/api/products/8'));
    const panel = await h.openPanel(tabId);
    await panel.getByTestId('tab-apis').click();
    const rows = panel.locator('[data-testid="api-row"]');
    await rows.first().waitFor();
    // /api/products/7 and /api/products/8 are one API.
    const products = panel.locator('[data-testid="api-row"][data-key="GET localhost:4100/api/products/:id"]');
    await products.waitFor();
    assert.match(await products.textContent(), /Product 7|Product 8/);
    const count = Number(await panel.getByTestId('api-count').textContent());
    assert.equal(count, await rows.count());
    assert.ok(count >= 8, `count ${count}`);
    // Filter: only POST.
    await panel.getByTestId('f-method-POST').click();
    await waitFor(async () => Number(await panel.getByTestId('api-count').textContent()) < count, { message: 'POST API filter' });
    const keys = await rows.evaluateAll((r) => r.map((x) => x.dataset.key));
    assert.ok(keys.every((k) => k.startsWith('POST ')), keys.join(','));
    await panel.getByTestId('f-clear').click();
    // Scan source adds APIs that were not called yet.
    await panel.getByTestId('tab-search').click();
    await panel.getByTestId('btn-scan').click();
    await panel.getByTestId('scan-summary').waitFor();
    await panel.getByTestId('tab-apis').click();
    await panel.locator('[data-testid="api-row"][data-key="ANY /api/never-called"]').waitFor();
    assert.match(await panel.getByTestId('api-count-detail').textContent(), /more found only in source/);
    // Click an API row: Calls view with only that API.
    await panel.getByTestId('tab-apis').click();
    await products.click();
    await waitFor(async () => (await panel.locator('[data-testid="call-row"]').count()) === 2, { message: 'endpoint filter' });
    await panel.close();
  });

  it('A8: search by endpoint shows button, component and line; A9: scan source finds unclicked endpoints', async () => {
    const panel = await h.openPanel(tabId);
    await panel.getByTestId('tab-search').click();
    await panel.getByTestId('search-input').fill('/cart/add');
    const row = panel.locator('[data-testid="search-row"]').first();
    await row.waitFor();
    const text = await row.textContent();
    assert.match(text, /Add to cart/);
    assert.match(text, /section main/);
    assert.match(text, new RegExp(`theme\\.js:${lineOf(themeJs, "fetch('/cart/add.js'")}`));

    await panel.getByTestId('search-input').fill('/api/never-called');
    await panel.getByTestId('btn-scan').click();
    const hit = panel.locator('[data-testid="scan-hit"]').first();
    await hit.waitFor();
    assert.match(await hit.textContent(), new RegExp(`theme\\.js:${lineOf(themeJs, "/api/never-called")}:`));
    await panel.close();
  });

  it('D3: Clear, Export JSON, and Preserve log across navigation', async () => {
    const panel = await h.openPanel(tabId);
    // Export
    const [download] = await Promise.all([panel.waitForEvent('download'), panel.getByTestId('btn-export').click()]);
    const data = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.ok(data.calls.length > 5);
    assert.ok(data.calls.some((c) => c.resBody && c.url.endsWith('/cart.js?via=xhr')));
    // Navigation clears the list when Preserve log is off.
    await page.goto(`${STORE}/page2?t=x1`);
    await waitFor(async () => (await h.calls(tabId)).every((c) => !c.url.includes('/cart')), { message: 'cleared after navigation' });
    await h.waitDone(tabId, (c) => c.url.includes('page2=1'), 'page2 call');
    // Preserve log keeps old calls and adds a navigation row.
    await panel.getByTestId('preserve-log').check();
    await page.goto(`${STORE}/?t=x2`);
    await page.waitForFunction(() => window.__stockConfig);
    const calls = await h.calls(tabId);
    assert.ok(calls.some((c) => c.url.includes('page2=1')), 'old call kept');
    assert.ok(calls.some((c) => c.type === 'nav'), 'nav row');
    await panel.getByTestId('preserve-log').uncheck();
    // Clear
    await panel.getByTestId('btn-clear').click();
    await waitFor(async () => (await h.calls(tabId)).length === 0, { message: 'clear' });
    await waitFor(async () => (await panel.locator('[data-testid="call-row"]').count()) === 0, { message: 'panel empty' });
    await panel.close();
  });
});
