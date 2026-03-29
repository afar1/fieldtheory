import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBookmarkStatus, formatBookmarkSummary } from '../src/bookmarks-service.js';

test('formatBookmarkStatus produces human-readable summary', () => {
  const text = formatBookmarkStatus({
    connected: true,
    bookmarkCount: 99,
    lastUpdated: '2026-03-28T17:23:00Z',
    mode: 'GraphQL full + API incremental',
    cachePath: '/tmp/x-bookmarks.jsonl',
    datasetInitialized: true,
  });

  assert.match(text, /Field Theory Bookmarks/);
  assert.match(text, /bookmarks: 99/);
  assert.match(text, /last updated: 2026-03-28T17:23:00Z/);
  assert.match(text, /sync mode: GraphQL full \+ API incremental/);
  assert.match(text, /dataset: initialized/);
  assert.match(text, /cache: \/tmp\/x-bookmarks\.jsonl/);
});

test('formatBookmarkSummary produces concise operator-friendly output', () => {
  const text = formatBookmarkSummary({
    connected: true,
    bookmarkCount: 99,
    lastUpdated: '2026-03-28T17:23:00Z',
    mode: 'API sync',
    cachePath: '/tmp/x-bookmarks.jsonl',
    datasetInitialized: true,
  });

  assert.match(text, /bookmarks=99/);
  assert.match(text, /updated=2026-03-28T17:23:00Z/);
  assert.match(text, /mode="API sync"/);
});
