// Shared helpers for the end-to-end tests: start Chromium with the built extension.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

export const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');

let counter = 0;

export async function waitFor(fn, { timeout = 8000, interval = 50, message = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for ${message}. Last value: ${last instanceof Error ? last.message : JSON.stringify(last)?.slice(0, 500)}`);
}

export async function launch() {
  const ctx = await chromium.launchPersistentContext('', {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const h = new Helper(ctx, new URL(sw.url()).host);
  // Wait for the first rules sync after install.
  await waitFor(() => h.sw().evaluate(async () => (await chrome.storage.local.get('syncedAt')).syncedAt), { message: 'first sync' });
  return h;
}

export class Helper {
  constructor(ctx, extId) {
    this.ctx = ctx;
    this.extId = extId;
  }

  sw() {
    return this.ctx.serviceWorkers()[0];
  }

  url(path) {
    return `chrome-extension://${this.extId}/${path}`;
  }

  // Open a page with a unique URL, so we can find its tab id.
  async open(url) {
    const page = await this.ctx.newPage();
    const u = new URL(url);
    u.searchParams.set('t', String(++counter));
    await page.goto(u.href);
    return page;
  }

  async tabId(page) {
    const url = page.url();
    return waitFor(() => this.sw().evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url), { message: `tab id of ${url}` });
  }

  // Read the stored calls of a tab straight from IndexedDB.
  async calls(tabId) {
    return this.sw().evaluate(async (id) => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('api-inspector');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const t = db.transaction(['calls', 'bodies'], 'readonly');
      const get = (req) => new Promise((res) => { req.onsuccess = () => res(req.result); });
      const list = await get(t.objectStore('calls').index('tab').getAll(id));
      const out = [];
      for (const c of list) {
        const b = await get(t.objectStore('bodies').get(c.key));
        out.push({ ...c, reqBody: b?.reqBody ?? null, resBody: b?.resBody ?? null });
      }
      db.close();
      return out.sort((a, b) => a.start - b.start);
    }, tabId);
  }

  async waitCall(tabId, pred, message = 'call') {
    return waitFor(async () => (await this.calls(tabId)).find(pred), { message });
  }

  async waitDone(tabId, pred, message = 'finished call') {
    return this.waitCall(tabId, (c) => pred(c) && (c.state === 'done' || c.state === 'error'), message);
  }

  async storage(keys) {
    return this.sw().evaluate((k) => chrome.storage.local.get(k), keys);
  }

  // Save rules and wait until Chrome's rules are updated.
  async setRules({ rules = [], groups = [], settings = { enabled: true } }) {
    const now = await this.storage(['rules', 'groups', 'settings', 'syncedAt']);
    // Chrome sends no change event when nothing changed, so there is nothing to wait for.
    if (JSON.stringify([now.rules, now.groups, now.settings]) === JSON.stringify([rules, groups, settings])) return;
    const before = now.syncedAt || 0;
    await this.sw().evaluate((d) => chrome.storage.local.set(d), { rules, groups, settings });
    await waitFor(async () => ((await this.storage('syncedAt')).syncedAt || 0) > before, { message: 'rules sync' });
  }

  async openPanel(tabId) {
    const panel = await this.ctx.newPage();
    await panel.goto(this.url(`panel.html?tabId=${tabId}`));
    await panel.getByTestId('calls-table').waitFor();
    return panel;
  }

  // Same switch as "Allow User Scripts" on chrome://extensions.
  async setUserScripts(on) {
    const p = await this.ctx.newPage();
    await p.goto(`chrome://extensions/?id=${this.extId}`);
    await p.evaluate(({ id, v }) => chrome.developerPrivate.updateExtensionConfiguration({ extensionId: id, userScriptsAccess: v }), { id: this.extId, v: on });
    await p.close();
  }

  async close() {
    await this.ctx.close();
  }
}
