import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUrl,
  isSameSite,
  isCrawlablePage,
  extractCrawlTargets,
} from '../src/crawler.js';

test('normalizeUrl: resolves relative links, strips hash and trailing slash', () => {
  assert.equal(
    normalizeUrl('/about/#team', 'https://site.com/page'),
    'https://site.com/about'
  );
});

test('normalizeUrl: strips tracking params, keeps meaningful ones', () => {
  assert.equal(
    normalizeUrl('https://site.com/list?page=2&utm_source=fb&gclid=1', 'https://site.com'),
    'https://site.com/list?page=2'
  );
});

test('normalizeUrl: rejects non-http protocols', () => {
  assert.equal(normalizeUrl('mailto:a@b.com', 'https://site.com'), null);
  assert.equal(normalizeUrl('tel:+380501112233', 'https://site.com'), null);
  assert.equal(normalizeUrl('javascript:void(0)', 'https://site.com'), null);
});

test('isSameSite: same origin only', () => {
  assert.equal(isSameSite('https://site.com/a', 'https://site.com/'), true);
  assert.equal(isSameSite('https://sub.site.com/a', 'https://site.com/'), false);
  assert.equal(isSameSite('http://site.com/a', 'https://site.com/'), false);
});

test('isCrawlablePage: skips binary and asset extensions', () => {
  assert.equal(isCrawlablePage('https://site.com/doc.pdf'), false);
  assert.equal(isCrawlablePage('https://site.com/pic.jpg?v=2'), false);
  assert.equal(isCrawlablePage('https://site.com/sitemap.xml'), false);
  assert.equal(isCrawlablePage('https://site.com/about'), true);
  assert.equal(isCrawlablePage('https://site.com/about.html'), true);
});

test('extractCrawlTargets: dedupes, filters and respects the limit', () => {
  const seen = new Set(['https://site.com/']);
  const links = [
    'https://site.com/about#a',
    'https://site.com/about/',
    'https://site.com/services',
    'https://other.com/page',
    'https://site.com/file.pdf',
    'mailto:hi@site.com',
    'https://site.com/contacts',
  ];
  const targets = extractCrawlTargets(links, 'https://site.com/', seen, 2);
  assert.deepEqual(targets, ['https://site.com/about', 'https://site.com/services']);
  // seen now contains what was returned
  assert.equal(seen.has('https://site.com/about'), true);
});
