// Test servers:
//   store  http://localhost:4100  Dawn-like storefront + admin shell + test APIs
//   app    http://127.0.0.1:4300  React app (Vite dev server), shown in the admin iframe
//   local  http://localhost:4400  "your local server" for Map remote / redirect tests
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const STORE = 'http://localhost:4100';
export const APP = 'http://127.0.0.1:4300';
export const LOCAL = 'http://localhost:4400';

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}

function cors(req, res) {
  res.setHeader('access-control-allow-origin', req.headers.origin || '*');
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('access-control-expose-headers', 'x-from-rule, x-server');
}

async function file(res, path, type) {
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(await readFile(join(here, path)));
}

function listen(server, port, host) {
  return new Promise((resolve) => server.listen(port, host, resolve));
}

export async function startServers({ withApp = true } = {}) {
  const log = [];
  let lastForm = null;
  const add = (entry) => {
    log.push(entry);
    if (log.length > 5000) log.splice(0, log.length - 5000);
  };

  const store = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const url = new URL(req.url, STORE);
    add({ server: 'store', method: req.method, path: url.pathname, query: url.search, headers: req.headers, body, time: Date.now() });
    cors(req, res);
    if (req.method === 'OPTIONS') return res.end();
    const p = url.pathname;
    if (p === '/' || p === '/index.html') return file(res, 'store/index.html', 'text/html');
    if (p === '/page2') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><title>Page 2</title><h1>Page 2</h1><script>fetch("/api/echo?page2=1")</script>');
    }
    if (p === '/csp') {
      res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "script-src 'self'" });
      return res.end(await readFile(join(here, 'store/csp.html')));
    }
    if (p === '/admin') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end((await readFile(join(here, 'store/admin.html'), 'utf8')).replace('APP_URL', APP));
    }
    if (p === '/assets/theme.js') return file(res, 'store/assets/theme.js', 'text/javascript');
    if (p === '/assets/csp.js') return file(res, 'store/assets/csp.js', 'text/javascript');
    if (p === '/assets/style.css') {
      res.writeHead(200, { 'content-type': 'text/css' });
      return res.end('body { color: rgb(1, 2, 3); }');
    }
    if (p === '/apps/stock/embed.js') return file(res, 'store/apps/embed-live.js', 'text/javascript');
    if (p === '/apps/stock/api/config') return json(res, 200, { threshold: 5, server: 'store' });
    if (p === '/apps/stock/api/notify') return json(res, 200, { ok: true, got: body });
    if (p === '/cart/add' && req.method === 'POST') {
      lastForm = body;
      res.writeHead(302, { location: '/cart' });
      return res.end();
    }
    if (p === '/cart') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><title>Cart</title><h1>Cart</h1><pre id="form-body">${String(lastForm || '').replace(/</g, '&lt;')}</pre>`);
    }
    if (p === '/cart/add.js') return json(res, 200, { added: true, body: body ? JSON.parse(body) : null, item_count: 1 });
    if (p === '/cart.js') return json(res, 200, { items: [{ id: 1, title: 'Shirt' }, { id: 2, title: 'Hat' }], item_count: 2, total_price: 4500 });
    if (p === '/api/echo') {
      return json(res, 200, { server: 'store', method: req.method, path: p, query: Object.fromEntries(url.searchParams), headers: req.headers, body }, { 'x-server': 'store' });
    }
    if (p === '/api/big') {
      const big = { data: 'x'.repeat(2 * 1024 * 1024) };
      return json(res, 200, big);
    }
    if (p === '/api/slow') {
      await new Promise((r) => setTimeout(r, Number(url.searchParams.get('ms') || 300)));
      return json(res, 200, { slow: true });
    }
    const st = p.match(/^\/api\/status\/(\d+)$/);
    if (st) return json(res, Number(st[1]), { status: Number(st[1]) });
    const prod = p.match(/^\/api\/products\/(\d+)$/);
    if (prod) return json(res, 200, { id: Number(prod[1]), title: `Product ${prod[1]}`, price: 1000 });
    if (p === '/api/never-called') return json(res, 200, { never: false });
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  const local = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const url = new URL(req.url, LOCAL);
    add({ server: 'local', method: req.method, path: url.pathname, query: url.search, headers: req.headers, body, time: Date.now() });
    cors(req, res);
    if (req.method === 'OPTIONS') return res.end();
    if (url.pathname === '/apps/stock/embed.js') return file(res, 'store/apps/embed-local.js', 'text/javascript');
    if (url.pathname === '/apps/stock/api/config') return json(res, 200, { threshold: 99, server: 'local' });
    if (url.pathname === '/api/echo') {
      return json(res, 200, { server: 'local', method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body }, { 'x-server': 'local' });
    }
    res.writeHead(404);
    res.end('not found');
  });

  await listen(store, 4100, 'localhost');
  await listen(local, 4400, 'localhost');

  let vite = null;
  if (withApp) {
    const { createServer } = await import('vite');
    const react = (await import('@vitejs/plugin-react')).default;
    vite = await createServer({
      configFile: false,
      root: join(here, 'react-app'),
      logLevel: 'error',
      plugins: [
        react(),
        {
          name: 'test-api',
          configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
              if (!req.url.startsWith('/api/')) return next();
              const body = await readBody(req);
              const url = new URL(req.url, APP);
              add({ server: 'app', method: req.method, path: url.pathname, query: url.search, headers: req.headers, body, time: Date.now() });
              if (url.pathname === '/api/settings') return json(res, 200, { saved: true, got: body ? JSON.parse(body) : null });
              if (url.pathname === '/api/cart-items') return json(res, 200, { items: [1, 2, 3], page: url.searchParams.get('page') });
              return json(res, 404, { error: 'not found' });
            });
          },
        },
      ],
      server: { host: '127.0.0.1', port: 4300, strictPort: true, hmr: false },
    });
    await vite.listen();
  }

  return {
    log,
    clearLog: () => { log.length = 0; },
    async close() {
      const done = [new Promise((r) => store.close(r)), new Promise((r) => local.close(r))];
      store.closeAllConnections();
      local.closeAllConnections();
      await Promise.all([...done, vite ? vite.close() : null]);
    },
  };
}
