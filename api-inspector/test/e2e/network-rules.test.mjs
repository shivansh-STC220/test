// Step 3: network rules (B1-B7), rule options (O1-O6), popup (D1), rules page (D2).
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCAL, STORE, startServers } from '../fixtures/servers.mjs';
import { newRule } from '../../src/shared/rules.js';
import { launch, waitFor } from './helpers.mjs';

const rule = (type, match = {}, config = {}, extra = {}) => {
  const r = newRule(type, extra);
  r.match = { ...r.match, ...match };
  r.config = { ...r.config, ...config };
  return r;
};

// fetch from the page; returns { ok, status, json, headers } or { error }.
const pageFetch = (page, url, init) => page.evaluate(async ({ url, init }) => {
  try {
    const r = await fetch(url, init);
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: r.ok, status: r.status, json, text, headers: Object.fromEntries(r.headers) };
  } catch (e) {
    return { error: e.message };
  }
}, { url, init });

describe('network rules', () => {
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

  it('B1: redirect, and O6: the call shows which rule changed it', async () => {
    const r = rule('redirect', { url: '/api/status/404' }, { target: `${LOCAL}/api/echo?redirected=1` }, { name: 'To local' });
    await h.setRules({ rules: [r] });
    const res = await pageFetch(page, '/api/status/404');
    assert.equal(res.json.server, 'local');
    assert.equal(res.json.query.redirected, '1');
    const c = await h.waitCall(tabId, (x) => x.url.endsWith('/api/status/404') && x.rules?.length, 'rule log on call');
    assert.deepEqual(c.rules.map((x) => [x.name, x.layer]), [['To local', 'network']]);
    const badge = await h.sw().evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
    assert.ok(Number(badge) >= 1, `badge ${badge}`);
  });

  it('B1: redirect with regex groups ($1)', async () => {
    const r = rule('redirect', { urlType: 'regex', url: '^http://localhost:4100/api/products/(\\d+)$' }, { target: 'http://localhost:4400/api/echo?product=$1' });
    await h.setRules({ rules: [r] });
    const res = await pageFetch(page, '/api/products/7');
    assert.equal(res.json.server, 'local');
    assert.equal(res.json.query.product, '7');
  });

  it('B1: a redirect rule that loops forever is turned off by itself', async () => {
    const r = rule('redirect', { urlType: 'regex', url: '^http://localhost:4100/api/products/(\\d+)$' }, { target: 'http://localhost:4100/api/products/9$1' }, { name: 'Loop' });
    await h.setRules({ rules: [r] });
    servers.clearLog();
    await pageFetch(page, '/api/products/7');
    const saved = await waitFor(async () => (await h.storage('rules')).rules.find((x) => x.id === r.id && !x.enabled && x.loopError), { message: 'rule turned off' });
    assert.match(saved.loopError, /loop/);
    const hitsOnServer = servers.log.filter((l) => l.path.startsWith('/api/products/')).length;
    assert.ok(hitsOnServer < 300, `server got ${hitsOnServer} calls`);
    // The form check catches the simple case before saving.
    const { validateRule } = await import('../../src/shared/rules.js');
    assert.match(validateRule(rule('redirect', { url: '/api/' }, { target: `${STORE}/api/other` })), /loop forever/);
  });

  it('B2: replace string in the URL (optionally only when the URL contains some text)', async () => {
    await h.setRules({ rules: [rule('replace', {}, { from: 'products/5', to: 'products/66' })] });
    assert.equal((await pageFetch(page, '/api/products/5')).json.id, 66);
    await h.setRules({ rules: [rule('replace', { url: 'no-such-text' }, { from: 'products/5', to: 'products/66' })] });
    assert.equal((await pageFetch(page, '/api/products/5')).json.id, 5);
    await h.setRules({ rules: [rule('replace', { url: '/api/' }, { from: 'products/5', to: 'products/67' })] });
    assert.equal((await pageFetch(page, '/api/products/5')).json.id, 67);
  });

  it('B3: query params add, change and remove', async () => {
    const r = rule('query', { url: '/api/echo' }, {
      params: [
        { op: 'add', key: 'x', value: '1' },
        { op: 'set', key: 'a', value: 'changed' },
        { op: 'set', key: 'zz', value: 'only-if-there' },
        { op: 'remove', key: 'b' },
      ],
    });
    await h.setRules({ rules: [r] });
    const res = await pageFetch(page, '/api/echo?a=1&b=2&c=3');
    assert.deepEqual(res.json.query, { a: 'changed', c: '3', x: '1' });
  });

  it('B4: change request and response headers', async () => {
    const r = rule('headers', { url: '/api/echo' }, {
      request: [{ op: 'set', name: 'X-Added', value: 'hello' }, { op: 'remove', name: 'X-Test' }],
      response: [{ op: 'set', name: 'X-From-Rule', value: 'yes' }],
    });
    await h.setRules({ rules: [r] });
    const res = await pageFetch(page, '/api/echo', { headers: { 'X-Test': 'gone' } });
    assert.equal(res.json.headers['x-added'], 'hello');
    assert.equal(res.json.headers['x-test'], undefined);
    assert.equal(res.headers['x-from-rule'], 'yes');
  });

  it('B5: cancel (block) makes the call fail', async () => {
    await h.setRules({ rules: [rule('block', { url: '/api/status/418' }, {}, { name: 'Block 418' })] });
    const res = await pageFetch(page, '/api/status/418');
    assert.match(res.error, /Failed to fetch/);
    const c = await h.waitCall(tabId, (x) => x.url.endsWith('/api/status/418') && x.state === 'error' && x.rules?.length, 'blocked call');
    assert.equal(c.rules[0].name, 'Block 418');
    assert.ok(!servers.log.some((l) => l.path === '/api/status/418'), 'never reached the server');
  });

  it('B6: user agent for requests and navigator.userAgent', async () => {
    await h.setRules({ rules: [rule('userAgent', {}, { preset: 'iphone' })] });
    const res = await pageFetch(page, '/api/echo?ua=1');
    assert.match(res.json.headers['user-agent'], /iPhone/);
    assert.equal(res.json.headers['sec-ch-ua-mobile'], '?1');
    await waitFor(() => page.evaluate(() => /iPhone/.test(navigator.userAgent)), { message: 'navigator.userAgent' });
    await h.setRules({ rules: [] });
    await waitFor(() => page.evaluate(() => !/iPhone/.test(navigator.userAgent)), { message: 'navigator.userAgent back' });
  });

  it('B7: map remote points the app embed script and its API to localhost', async () => {
    await h.setRules({ rules: [rule('mapRemote', {}, { from: `${STORE}/apps/stock/`, to: `${LOCAL}/apps/stock/` }, { name: 'Stock local' })] });
    await page.reload();
    await page.waitForFunction(() => window.__stockConfig);
    assert.equal(await page.evaluate(() => window.__embedVersion), 'local');
    assert.equal(await page.evaluate(() => window.__stockConfig.server), 'local');
    // The script load shows up as its own row with the rule.
    const row = await h.waitCall(tabId, (x) => x.type === 'network' && x.resourceType === 'script' && x.url.endsWith('/apps/stock/embed.js'), 'script rule row');
    assert.equal(row.rules[0].name, 'Stock local');
    // Host only (no path) must not catch other hosts that start the same way.
    await h.setRules({ rules: [rule('mapRemote', {}, { from: 'http://localhost:41', to: LOCAL })] });
    assert.equal((await pageFetch(page, '/api/echo')).json.server, 'store');
  });

  it('O1: match by exact URL, wildcard, regex, method and site', async () => {
    await h.setRules({
      rules: [
        rule('block', { urlType: 'exact', url: `${STORE}/api/status/401` }),
        rule('block', { urlType: 'wildcard', url: `${STORE}/api/status/41*` }),
        rule('block', { urlType: 'regex', url: '/api/status/4[3-4]\\d$' }),
        rule('block', { url: '/api/echo?m', methods: ['POST'] }),
        rule('block', { url: '/api/echo?site=a', site: 'example.com' }),
        rule('block', { url: '/api/echo?site=b', site: 'http://localhost:4100/' }),
      ],
    });
    assert.ok((await pageFetch(page, '/api/status/401')).error);
    assert.equal((await pageFetch(page, '/api/status/401?x')).status, 401);
    assert.ok((await pageFetch(page, '/api/status/410')).error);
    assert.equal((await pageFetch(page, '/api/status/420')).status, 420);
    assert.ok((await pageFetch(page, '/api/status/431')).error);
    assert.equal((await pageFetch(page, '/api/status/451')).status, 451);
    assert.equal((await pageFetch(page, '/api/echo?m')).status, 200);
    assert.ok((await pageFetch(page, '/api/echo?m', { method: 'POST' })).error);
    assert.equal((await pageFetch(page, '/api/echo?site=a')).status, 200);
    assert.ok((await pageFetch(page, '/api/echo?site=b')).error);
  });

  it('O2 + O3: each rule, each group and the main switch can be turned off', async () => {
    const g = { id: 'g1', name: 'Cart Sync local', enabled: true };
    const r = rule('block', { url: '/api/status/402' }, {}, { groupId: 'g1' });
    await h.setRules({ rules: [r], groups: [g] });
    assert.ok((await pageFetch(page, '/api/status/402')).error);
    await h.setRules({ rules: [{ ...r, enabled: false }], groups: [g] });
    assert.equal((await pageFetch(page, '/api/status/402')).status, 402);
    await h.setRules({ rules: [r], groups: [{ ...g, enabled: false }] });
    assert.equal((await pageFetch(page, '/api/status/402')).status, 402);
    await h.setRules({ rules: [r], groups: [g], settings: { enabled: false } });
    assert.equal((await pageFetch(page, '/api/status/402')).status, 402);
  });

  it('shows rules Chrome can not use (bad regex) on the rules page', async () => {
    const bad = rule('block', { urlType: 'regex', url: '(?=lookahead)x' }, {}, { name: 'Bad regex' });
    const good = rule('block', { url: '/api/status/403' }, {}, { name: 'Good' });
    await h.setRules({ rules: [bad, good] });
    const { ruleErrors } = await h.storage('ruleErrors');
    assert.ok(ruleErrors[bad.id], 'error saved');
    assert.ok((await pageFetch(page, '/api/status/403')).error, 'the good rule still works');
    const rp = await h.ctx.newPage();
    await rp.goto(h.url('rules.html'));
    await rp.locator('[data-testid="rule-row"][data-name="Bad regex"] [data-testid="rule-row-error"]').waitFor();
    await rp.close();
  });

  it('D2: create a rule on the rules page, and O5: export / import', async () => {
    const rp = await h.ctx.newPage();
    await rp.goto(h.url('rules.html'));
    await rp.getByTestId('new-rule').click();
    await rp.getByTestId('type-redirect').click();
    await rp.getByTestId('rule-name').fill('UI redirect');
    await rp.getByTestId('match-url').fill('/api/status/405');
    await rp.getByTestId('rule-save').click();
    await rp.getByTestId('rule-error').filter({ hasText: 'Enter the URL' }).waitFor();
    await rp.getByTestId('cfg-target').fill(`${LOCAL}/api/echo?from=ui`);
    const before = (await h.storage('syncedAt')).syncedAt;
    await rp.getByTestId('rule-save').click();
    await rp.locator('[data-testid="rule-row"][data-name="UI redirect"]').waitFor();
    await waitFor(async () => (await h.storage('syncedAt')).syncedAt > before, { message: 'sync' });
    assert.equal((await pageFetch(page, '/api/status/405')).json.query.from, 'ui');

    // Group made on the page.
    await rp.getByTestId('new-group').click();
    await rp.getByTestId('new-group-input').fill('StockBeacon');
    await rp.getByTestId('new-group-input').press('Enter');
    await rp.locator('[data-testid="group-item"]').filter({ hasText: 'StockBeacon' }).waitFor();

    // Export
    const [dl] = await Promise.all([rp.waitForEvent('download'), rp.getByTestId('export-rules').click()]);
    const exported = JSON.parse(await readFile(await dl.path(), 'utf8'));
    assert.equal(exported.rules.length, 1);
    assert.equal(exported.groups[0].name, 'StockBeacon');

    // Import a file with a group and a rule.
    const file = join(tmpdir(), `rules-${Date.now()}.json`);
    const imported = rule('block', { url: '/api/status/406' }, {}, { name: 'Imported block', groupId: 'gx' });
    await writeFile(file, JSON.stringify({ groups: [{ id: 'gx', name: 'Imported group', enabled: true }], rules: [imported] }));
    const before2 = (await h.storage('syncedAt')).syncedAt;
    await rp.getByTestId('import-rules').setInputFiles(file);
    await rp.getByTestId('rules-msg').filter({ hasText: 'Imported 1 rule' }).waitFor();
    await waitFor(async () => (await h.storage('syncedAt')).syncedAt > before2, { message: 'sync' });
    const { rules, groups } = await h.storage(['rules', 'groups']);
    const ir = rules.find((x) => x.name === 'Imported block');
    assert.ok(ir.id !== imported.id, 'gets a new id');
    assert.equal(groups.find((g) => g.id === ir.groupId).name, 'Imported group');
    assert.ok((await pageFetch(page, '/api/status/406')).error);
    await rp.close();
  });

  it('O4: rules saved per site; D1: popup shows hits and turns groups on and off', async () => {
    const g = { id: 'g2', name: 'Popup group', enabled: true };
    const siteRule = rule('block', { url: '/api/status/409', site: 'localhost' }, {}, { name: 'Site rule', groupId: 'g2' });
    const otherSite = rule('block', { url: '/api/status/409', site: 'shop.example.com' }, {}, { name: 'Other site rule' });
    await h.setRules({ rules: [siteRule, otherSite], groups: [g] });
    assert.ok((await pageFetch(page, '/api/status/409')).error);

    const popup = await h.ctx.newPage();
    await popup.goto(h.url(`popup.html?tabId=${tabId}`));
    await popup.getByTestId('popup').waitFor();
    // Only this site's rule is listed under "Rules for this site".
    await popup.getByText('Site rule').waitFor();
    assert.equal(await popup.getByText('Other site rule').count(), 0);
    const hits = Number(await popup.getByTestId('popup-hits').textContent());
    const badge = await h.sw().evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
    assert.equal(String(hits), badge);
    const before = (await h.storage('syncedAt')).syncedAt;
    await popup.getByTestId('group-toggle-Popup group').click();
    await waitFor(async () => (await h.storage('syncedAt')).syncedAt > before, { message: 'sync' });
    assert.equal((await h.storage('groups')).groups[0].enabled, false);
    assert.equal((await pageFetch(page, '/api/status/409')).status, 409);
    await popup.close();
  });
});
