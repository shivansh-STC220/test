import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_FILTER, callMatches, callSentence, endpointMatchesFilter, endpointOf, groupEndpoints, isIdSegment, statusClass } from '../../src/shared/calls.js';
import { extractEndpoints, findOccurrences } from '../../src/shared/scan.js';

const call = (o) => ({ id: Math.random().toString(36), type: 'fetch', method: 'GET', state: 'done', status: 200, start: 1, frame: { top: true, url: 'https://shop.com/' }, rules: [], ...o });

describe('APIs (endpoints)', () => {
  it('ids in paths become :id', () => {
    assert.ok(isIdSegment('123'));
    assert.ok(isIdSegment('3fa85f64-5717-4562-b3fc-2c963f66afa6'));
    assert.ok(!isIdSegment('products'));
    assert.equal(endpointOf('post', 'https://shop.com/api/items/42?x=1').key, 'POST shop.com/api/items/:id');
  });
  it('groups calls and counts them', () => {
    const list = groupEndpoints([
      call({ url: 'https://shop.com/api/p/1', duration: 100, click: { text: 'Buy' } }),
      call({ url: 'https://shop.com/api/p/2', duration: 300, status: 500 }),
      call({ url: 'https://shop.com/cart.js' }),
      call({ type: 'nav', url: 'https://shop.com/' }),
      call({ type: 'network', resourceType: 'script', url: 'https://shop.com/apps/x/embed.js', status: undefined }),
    ], [
      { value: '/api/never', apiLike: true, file: 'https://shop.com/t.js', line: 3 },
      { value: '/api/p/9', apiLike: true, file: 'https://shop.com/t.js', line: 4 },
      { value: '/img/logo.png', apiLike: false, file: 'x', line: 1 },
    ]);
    assert.equal(list.length, 3);
    const p = list[0];
    assert.equal(p.key, 'GET shop.com/api/p/:id');
    assert.equal(p.count, 2);
    assert.equal(p.avgMs, 200);
    assert.deepEqual(p.statuses, { 200: 1, 500: 1 });
    assert.deepEqual(p.buttons, ['Buy']);
    assert.equal(list[2].live, false);
    assert.equal(list[2].path, '/api/never');
    const f = { ...EMPTY_FILTER, statuses: ['5xx'] };
    assert.deepEqual(list.filter((g) => endpointMatchesFilter(g, f)).map((g) => g.key), ['GET shop.com/api/p/:id']);
  });
});

describe('filters', () => {
  it('method, status, type, frame, rule and text / regex', () => {
    const c = call({ url: 'https://shop.com/api/cart', method: 'POST', status: 404, type: 'xhr', frame: { top: false }, rules: [{ id: 'r' }], click: { text: 'Save' } });
    assert.ok(callMatches(c, { ...EMPTY_FILTER, methods: ['POST'] }));
    assert.ok(!callMatches(c, { ...EMPTY_FILTER, methods: ['GET'] }));
    assert.ok(callMatches(c, { ...EMPTY_FILTER, statuses: ['4xx'] }));
    assert.ok(callMatches(c, { ...EMPTY_FILTER, types: ['xhr'] }));
    assert.ok(callMatches(c, { ...EMPTY_FILTER, frame: 'iframe' }));
    assert.ok(!callMatches(c, { ...EMPTY_FILTER, frame: 'top' }));
    assert.ok(callMatches(c, { ...EMPTY_FILTER, ruleOnly: true }));
    assert.ok(callMatches(c, { ...EMPTY_FILTER, text: 'save' }), 'button text');
    assert.ok(callMatches(c, { ...EMPTY_FILTER, text: '/api\\/ca.t/' }), 'regex');
    assert.ok(callMatches(c, { ...EMPTY_FILTER, hosts: ['shop.com'] }));
  });
  it('status classes', () => {
    assert.equal(statusClass(call({ status: 201 })), '2xx');
    assert.equal(statusClass(call({ state: 'error', error: 'x', status: undefined })), 'failed');
    assert.equal(statusClass(call({ state: 'pending' })), 'pending');
    assert.equal(statusClass(call({ type: 'beacon', status: 'queued' })), '2xx');
    assert.equal(statusClass(call({ type: 'network', status: undefined })), '');
  });
  it('sentence', () => {
    assert.equal(callSentence(call({ url: 'https://shop.com/api/settings', method: 'POST', duration: 120, click: { text: 'Save' } })), 'Clicked Save → POST /api/settings - 200 - 120 ms');
  });
});

describe('scan source', () => {
  const js = "var a = 1;\nfetch('/api/x/' + id);\nconst u = \"https://api.shop.com/v1/items\";\nimg.src = '/img/logo.png';\nthing('/api/x');";
  it('finds a text with line and column', () => {
    const hits = findOccurrences('f.js', js, '/api/x');
    assert.deepEqual(hits.map((h) => [h.line, h.col]), [[2, 8], [5, 8]]);
  });
  it('lists endpoint-like strings and marks API ones', () => {
    const list = extractEndpoints('f.js', js);
    const byValue = Object.fromEntries(list.map((e) => [e.value, e.apiLike]));
    assert.equal(byValue['/api/x/'], true);
    assert.equal(byValue['https://api.shop.com/v1/items'], true);
    assert.equal(byValue['/img/logo.png'], false);
  });
});
