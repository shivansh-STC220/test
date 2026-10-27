// Switching websites in the same tab: nothing from the old site gets mixed in (O4, D1, D2, D3).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { APP, STORE, startServers } from '../fixtures/servers.mjs';
import { newRule } from '../../src/shared/rules.js';
import { launch, waitFor } from './helpers.mjs';

const rule = (type, match = {}, extra = {}) => {
  const r = newRule(type, extra);
  r.match = { ...r.match, ...match };
  return r;
};

const pageFetch = (page, url, init) => page.evaluate(({ url, init }) => fetch(url, init).then((r) => ({ status: r.status }), (e) => ({ error: e.message })), { url, init });

describe('switching websites', () => {
  let h;
  let servers;

  before(async () => {
    servers = await startServers();
    h = await launch();
  });

  after(async () => {
    await h?.close();
    await servers?.close();
  });

  it('DevTools tab: scan results, search text and filters from the old site are cleared', async () => {
    const page = await h.open(`${STORE}/`);
    const tabId = await h.tabId(page);
    await page.waitForFunction(() => window.__stockConfig);
    await page.click('#echo-btn');
    await h.waitDone(tabId, (c) => c.url.includes('/api/echo?a=1'));

    const panel = await h.openPanel(tabId);
    await panel.getByTestId('site-chip').filter({ hasText: 'localhost:4100' }).waitFor();
    await panel.getByTestId('f-host').selectOption('localhost:4100');
    await panel.getByTestId('tab-search').click();
    await panel.getByTestId('search-input').fill('/api/never-called');
    await panel.getByTestId('btn-scan').click();
    await panel.getByTestId('scan-hit').first().waitFor();
    await panel.getByTestId('tab-apis').click();
    await panel.locator('[data-testid="api-row"][data-key="ANY /api/never-called"]').waitFor();

    // Same tab, other website.
    await page.goto(`${APP}/`);
    await page.click('#save-btn');
    await h.waitDone(tabId, (c) => c.url === `${APP}/api/settings`);
    await panel.getByTestId('site-chip').filter({ hasText: '127.0.0.1:4300' }).waitFor();
    await panel.locator('[data-testid="api-row"][data-key="POST 127.0.0.1:4300/api/settings"]').waitFor();
    const keys = await panel.locator('[data-testid="api-row"]').evaluateAll((rows) => rows.map((r) => r.dataset.key));
    assert.ok(keys.every((k) => !k.includes('never-called') && !k.includes('localhost:4100')), keys.join('\n'));
    assert.equal(Number(await panel.getByTestId('api-count').textContent()), keys.length);
    assert.equal(await panel.getByTestId('f-clear').count(), 0, 'filters were reset');
    assert.equal(await panel.getByTestId('f-host').inputValue(), '');
    await panel.getByTestId('tab-search').click();
    assert.equal(await panel.getByTestId('search-input').inputValue(), '');
    assert.equal(await panel.getByTestId('scan-summary').count(), 0, 'old scan is gone');
    await panel.close();
    await page.close();
  });

  it('a rule saved for one website does not change another website', async () => {
    await h.setRules({ rules: [rule('block', { url: '/api/', site: 'localhost' }, { name: 'Block store API' })] });
    const page = await h.open(`${STORE}/`);
    assert.ok((await pageFetch(page, '/api/echo')).error, 'blocked on localhost');
    await page.goto(`${APP}/`);
    assert.equal((await pageFetch(page, '/api/settings', { method: 'POST', body: '{}' })).status, 200, 'not blocked on 127.0.0.1');
    await page.close();
  });

  it('the popup shows the rules of the website you are on', async () => {
    await h.setRules({
      rules: [
        rule('block', { url: '/x', site: 'localhost' }, { name: 'Store rule' }),
        rule('block', { url: '/x', site: '127.0.0.1' }, { name: 'App rule' }),
        rule('block', { url: '/x' }, { name: 'Global rule' }),
      ],
    });
    const page = await h.open(`${APP}/`);
    const tabId = await h.tabId(page);
    const popup = await h.ctx.newPage();
    await popup.goto(h.url(`popup.html?tabId=${tabId}`));
    await popup.getByTestId('popup-site').filter({ hasText: '127.0.0.1:4300' }).waitFor();
    await popup.getByText('App rule').waitFor();
    await popup.getByText('Global rule').waitFor();
    assert.equal(await popup.getByText('Store rule').count(), 0);

    await page.goto(`${STORE}/`);
    await popup.getByTestId('popup-site').filter({ hasText: 'localhost:4100' }).waitFor();
    await popup.getByText('Store rule').waitFor();
    assert.equal(await popup.getByText('App rule').count(), 0);
    await popup.close();
    await page.close();
  });

  it('the rules page opened for a website makes new rules for that website', async () => {
    const rp = await h.ctx.newPage();
    await rp.goto(h.url('rules.html?site=127.0.0.1&new=1'));
    await rp.getByTestId('type-picker').waitFor();
    await rp.getByTestId('type-block').click();
    assert.equal(await rp.getByTestId('match-site').inputValue(), '127.0.0.1');
    assert.equal(await rp.getByTestId('site-this').isChecked(), true);
    await rp.getByTestId('rule-name').fill('New app rule');
    await rp.getByTestId('match-url').fill('/api/new');
    await rp.getByTestId('rule-save').click();
    await rp.locator('[data-testid="rule-row"][data-name="New app rule"]').waitFor();
    const { rules } = await h.storage('rules');
    assert.equal(rules.find((r) => r.name === 'New app rule').match.site, '127.0.0.1');
    // This website's view: its rules, plus the "all websites" rules. Never another site's rules.
    assert.match(await rp.getByTestId('rules-title').textContent(), /127\.0\.0\.1/);
    await rp.locator('[data-testid="rule-row"][data-name="App rule"]').waitFor();
    await rp.locator('[data-testid="rule-row"][data-name="Global rule"]').waitFor();
    assert.equal(await rp.locator('[data-testid="rule-row"][data-name="Store rule"]').count(), 0);
    await rp.close();
  });
});
