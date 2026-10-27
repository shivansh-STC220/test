// D3 inside real Chrome DevTools: the "API Inspector" tab loads and lists the calls.
// DevTools needs a visible browser. On Linux without a screen, run with: xvfb-run -a npm run test:e2e
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STORE, startServers } from '../fixtures/servers.mjs';
import { EXT, waitFor } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const noScreen = process.platform === 'linux' && !process.env.DISPLAY;
const PORT = 9333;

async function evalIn(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  try {
    return await new Promise((res) => {
      ws.onmessage = (m) => {
        const d = JSON.parse(m.data);
        if (d.id === 1) res(d.result?.result?.value);
      };
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  } finally {
    ws.close();
  }
}

async function artifacts() {
  const out = [];
  for (const d of (await readdir(tmpdir())).filter((x) => x.startsWith('playwright-artifacts-'))) {
    for (const f of await readdir(join(tmpdir(), d)).catch(() => [])) out.push(join(tmpdir(), d, f));
  }
  return out;
}

const targets = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();

describe('DevTools tab', { skip: noScreen && 'needs a screen (use xvfb-run on Linux)' }, () => {
  let ctx;
  let servers;

  before(async () => {
    servers = await startServers({ withApp: false });
    ctx = await chromium.launchPersistentContext('', {
      headless: false,
      channel: 'chromium',
      viewport: null,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--auto-open-devtools-for-tabs', '--window-size=1600,1000', `--remote-debugging-port=${PORT}`],
    });
  });

  after(async () => {
    await ctx?.close();
    await servers?.close();
  });

  it('shows the API Inspector tab with the calls of the inspected page', async () => {
    const page = await ctx.newPage();
    await page.goto(`${STORE}/?devtools=1`);
    // Open our tab in every DevTools window (it may sit in the "more tabs" menu).
    await waitFor(async () => {
      const dts = (await targets()).filter((t) => t.url.startsWith('devtools://'));
      if (!dts.length) return false;
      const res = await Promise.all(dts.map((t) => evalIn(t.webSocketDebuggerUrl, `(async () => {
        const UI = await import('./ui/legacy/legacy.js');
        const vm = UI.ViewManager.ViewManager.instance();
        const v = [...vm.views.values()].find((x) => x.title() === 'API Inspector');
        if (!v) return false;
        await vm.showView(v.viewId());
        return true;
      })().catch(() => false)`)));
      return res.some(Boolean);
    }, { timeout: 15000, message: 'API Inspector tab in DevTools' });

    await page.click('#echo-btn');
    const rows = await waitFor(async () => {
      for (const p of (await targets()).filter((t) => t.url.includes('/panel.html'))) {
        const r = await evalIn(p.webSocketDebuggerUrl, "[...document.querySelectorAll('[data-testid=call-row]')].map((r) => r.dataset.method + ' ' + r.dataset.url)");
        if (r && r.some((x) => x.includes('/api/echo?a=1'))) return r;
      }
      return false;
    }, { timeout: 15000, message: 'echo call in the DevTools tab' });
    assert.ok(rows.includes(`POST ${STORE}/api/echo?a=1&b=2`), rows.join('\n'));
  });

  it('Export JSON works inside DevTools', async () => {
    // Playwright keeps downloads itself, in its artifacts folder, with random names.
    const before = await artifacts();
    // There is a DevTools window for each tab (one is an empty about:blank tab): use the one with calls.
    let panel = null;
    for (const t of (await targets()).filter((x) => x.url.includes('/panel.html') && x.webSocketDebuggerUrl)) {
      if (await evalIn(t.webSocketDebuggerUrl, "document.querySelectorAll('[data-testid=call-row]').length")) panel = t;
    }
    assert.ok(panel, 'a DevTools tab with calls');
    await evalIn(panel.webSocketDebuggerUrl, "document.querySelector('[data-testid=btn-export]').click()");
    const file = await waitFor(async () => (await artifacts()).find((f) => !before.includes(f)), { timeout: 10000, message: 'downloaded file' });
    const data = JSON.parse(await readFile(file, 'utf8'));
    assert.ok(Array.isArray(data.calls) && data.calls.length > 0);
  });
});
