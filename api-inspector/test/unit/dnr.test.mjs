import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_RESOURCE_TYPES, dataUrlFor, toDnrRules, urlCondition } from '../../src/shared/dnr.js';
import { newRule } from '../../src/shared/rules.js';

const make = (type, match = {}, config = {}) => {
  const r = newRule(type);
  return { ...r, match: { ...r.match, ...match }, config: { ...r.config, ...config } };
};

describe('network rules (B1-B7)', () => {
  it('URL conditions', () => {
    assert.deepEqual(urlCondition({ urlType: 'contains', url: '/api' }), { urlFilter: '/api', isUrlFilterCaseSensitive: false });
    assert.deepEqual(urlCondition({ urlType: 'contains', url: 'a*b' }), { regexFilter: 'a\\*b', isUrlFilterCaseSensitive: false });
    assert.equal(urlCondition({ urlType: 'exact', url: 'https://x.com/a?b' }).regexFilter, '^https://x\\.com/a\\?b$');
    assert.equal(urlCondition({ urlType: 'wildcard', url: 'https://*.x.com/*' }).regexFilter, '^https://.*\\.x\\.com/.*$');
  });
  it('every rule covers page loads too (main_frame)', () => {
    const [d] = toDnrRules(make('block', { url: '/x' }));
    assert.deepEqual(d.condition.resourceTypes, ALL_RESOURCE_TYPES);
    assert.ok(d.condition.resourceTypes.includes('main_frame'));
  });
  it('redirect, with $1 for regex', () => {
    assert.deepEqual(toDnrRules(make('redirect', { url: '/a' }, { target: 'https://b.com/' }))[0].action, { type: 'redirect', redirect: { url: 'https://b.com/' } });
    const [d] = toDnrRules(make('redirect', { urlType: 'regex', url: '^https://a\\.com/(.*)$' }, { target: 'https://b.com/$1' }));
    assert.equal(d.action.redirect.regexSubstitution, 'https://b.com/\\1');
  });
  it('replace builds a regex with groups', () => {
    const [d] = toDnrRules(make('replace', {}, { from: 'api.live', to: 'api.dev' }));
    assert.equal(d.condition.regexFilter, '^(.*?)api\\.live(.*)$');
    assert.equal(d.action.redirect.regexSubstitution, '\\1api.dev\\2');
    const [e] = toDnrRules(make('replace', { url: '/v1/' }, { from: 'a', to: 'b' }));
    assert.match(e.condition.regexFilter, /\|/);
    assert.equal(e.action.redirect.regexSubstitution, '\\1\\3b\\2\\4');
  });
  it('query, headers, user agent, method and site', () => {
    const [q] = toDnrRules(make('query', {}, { params: [{ op: 'add', key: 'a', value: '1' }, { op: 'set', key: 'b', value: '2' }, { op: 'remove', key: 'c' }] }));
    assert.deepEqual(q.action.redirect.transform.queryTransform, { addOrReplaceParams: [{ key: 'a', value: '1', replaceOnly: false }, { key: 'b', value: '2', replaceOnly: true }], removeParams: ['c'] });
    const [hd] = toDnrRules(make('headers', { methods: ['POST'], site: 'https://shop.com/' }, { request: [{ op: 'set', name: 'X-A', value: '1' }], response: [{ op: 'remove', name: 'X-B' }] }));
    assert.deepEqual(hd.action.requestHeaders, [{ header: 'x-a', operation: 'set', value: '1' }]);
    assert.deepEqual(hd.action.responseHeaders, [{ header: 'x-b', operation: 'remove' }]);
    assert.deepEqual(hd.condition.requestMethods, ['post']);
    assert.deepEqual(hd.condition.initiatorDomains, ['shop.com']);
    const [ua] = toDnrRules(make('userAgent', {}, { value: 'Mozilla/5.0 (iPhone)' }));
    assert.equal(ua.action.requestHeaders[1].value, '?1');
  });
  it('map remote: host only does not catch longer hosts', () => {
    const [a] = toDnrRules(make('mapRemote', {}, { from: 'https://shop.com', to: 'http://localhost:3000' }));
    const re = new RegExp(a.condition.regexFilter);
    assert.ok(re.test('https://shop.com/apps/x.js'));
    assert.ok(re.test('https://shop.com'));
    assert.ok(!re.test('https://shop.com.evil.net/x'));
    assert.equal(a.action.redirect.regexSubstitution, 'http://localhost:3000\\1');
  });
  it('map local makes a data URL and leaves fetch / XHR to the page script', () => {
    const [d] = toDnrRules(make('mapLocal', { url: '/theme.js' }, { content: 'é', contentType: 'text/javascript' }));
    assert.ok(!d.condition.resourceTypes.includes('xmlhttprequest'));
    assert.equal(d.action.redirect.url, 'data:text/javascript;base64,w6k=');
    assert.equal(dataUrlFor({ content: 'AAEC', base64: true, contentType: 'image/png' }), 'data:image/png;base64,AAEC');
  });
  it('page-only types make no network rule', () => {
    assert.deepEqual(toDnrRules(make('delay')), []);
    assert.deepEqual(toDnrRules(make('pause')), []);
  });
});
