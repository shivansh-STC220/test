import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeRules, deepMerge, isRuleActive, newRule, normalizeSite, pageRulesFor, ruleMatchesRequest, siteMatches, urlMatches, validateRule,
} from '../../src/shared/rules.js';

describe('matching (O1)', () => {
  it('contains is not case sensitive', () => {
    assert.ok(urlMatches({ urlType: 'contains', url: '/API/cart' }, 'https://x.com/api/cart?x=1'));
    assert.ok(!urlMatches({ urlType: 'contains', url: '/api/carts' }, 'https://x.com/api/cart'));
  });
  it('exact, wildcard and regex', () => {
    assert.ok(urlMatches({ urlType: 'exact', url: 'https://x.com/a' }, 'https://x.com/a'));
    assert.ok(!urlMatches({ urlType: 'exact', url: 'https://x.com/a' }, 'https://x.com/a?b'));
    assert.ok(urlMatches({ urlType: 'wildcard', url: 'https://*.x.com/api/*' }, 'https://shop.x.com/api/v1'));
    assert.ok(!urlMatches({ urlType: 'wildcard', url: 'https://*.x.com/api/*' }, 'https://x.com/other'));
    assert.ok(urlMatches({ urlType: 'regex', url: '/products/\\d+$' }, 'https://x.com/products/42'));
    assert.ok(!urlMatches({ urlType: 'regex', url: '([' }, 'https://x.com/'), 'bad regex never matches');
  });
  it('empty URL matches everything', () => {
    assert.ok(urlMatches({ urlType: 'contains', url: '' }, 'https://any.com/'));
  });
  it('site matching ignores scheme, port and path, and includes subdomains', () => {
    assert.equal(normalizeSite('https://Shop.Example.com:8080/x'), 'shop.example.com');
    assert.ok(siteMatches('example.com', 'shop.example.com'));
    assert.ok(siteMatches('localhost:4100', 'localhost'));
    assert.ok(!siteMatches('example.com', 'notexample.com'));
    assert.ok(siteMatches('', 'anything'));
  });
  it('method and site together', () => {
    const r = newRule('block');
    r.match = { urlType: 'contains', url: '/cart', methods: ['POST'], site: 'shop.com' };
    assert.ok(ruleMatchesRequest(r, 'https://shop.com/cart/add', 'post', 'shop.com'));
    assert.ok(!ruleMatchesRequest(r, 'https://shop.com/cart/add', 'GET', 'shop.com'));
    assert.ok(!ruleMatchesRequest(r, 'https://shop.com/cart/add', 'POST', 'other.com'));
  });
});

describe('on / off and groups (O2, O3)', () => {
  const g = [{ id: 'g', enabled: false }];
  it('rule, group and main switch', () => {
    assert.ok(isRuleActive({ enabled: true }, [], { enabled: true }));
    assert.ok(!isRuleActive({ enabled: false }, [], {}));
    assert.ok(!isRuleActive({ enabled: true, groupId: 'g' }, g, {}));
    assert.ok(!isRuleActive({ enabled: true }, [], { enabled: false }));
  });
  it('page rules are only the page types for the frame site', () => {
    const a = newRule('delay'); a.match.site = 'shop.com';
    const b = newRule('redirect');
    const c = newRule('responseMock');
    const state = { rules: [a, b, c], groups: [], settings: { enabled: true } };
    assert.deepEqual(pageRulesFor(state, 'https://shop.com/x').map((r) => r.type), ['delay', 'responseMock']);
    assert.deepEqual(pageRulesFor(state, 'https://other.com/').map((r) => r.type), ['responseMock']);
    assert.equal(activeRules(state).length, 3);
  });
});

describe('validateRule', () => {
  const make = (type, match, config) => ({ ...newRule(type), match: { ...newRule(type).match, ...match }, config: { ...newRule(type).config, ...config } });
  it('catches loops and bad input', () => {
    assert.match(validateRule(make('redirect', { url: '/api/' }, { target: 'https://x.com/api/v2' })), /loop forever/);
    assert.equal(validateRule(make('redirect', { url: '/api/v1' }, { target: 'https://x.com/api/v2' })), '');
    assert.match(validateRule(make('replace', {}, { from: 'a', to: 'aa' })), /must not contain/);
    assert.match(validateRule(make('mapRemote', {}, { from: 'https://a.com/', to: 'https://a.com/v2/' })), /must not start/);
    assert.match(validateRule(make('responseEdit', {}, { mode: 'merge', value: '{bad' })), /not valid/);
    assert.match(validateRule(make('responseMock', {}, { status: 99 })), /Status/);
    assert.equal(validateRule(make('responseMock', {}, { status: 0 })), '');
    assert.match(validateRule(make('block', { urlType: 'regex', url: '(' }, {})), /Bad regex/);
  });
});

describe('deepMerge', () => {
  it('merges objects and replaces arrays', () => {
    assert.deepEqual(deepMerge({ a: 1, b: { c: 2, d: 3 }, e: [1, 2] }, { b: { c: 9 }, e: [] }), { a: 1, b: { c: 9, d: 3 }, e: [] });
  });
});
