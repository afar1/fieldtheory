import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildIndex, searchBookmarks, getStats, formatSearchResults } from '../src/bookmarks-db.js';

async function setupFixture(): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'ft-db-'));
  await mkdir(path.join(cwd, 'automation', 'sources'), { recursive: true });
  const records = [
    { id: '1', tweetId: '1', url: 'https://x.com/alice/status/1', text: 'Machine learning is transforming healthcare', authorHandle: 'alice', authorName: 'Alice Smith', syncedAt: '2026-01-01T00:00:00Z', postedAt: 'Mon Jan 01 12:00:00 +0000 2026', language: 'en', engagement: { likeCount: 100, repostCount: 10 }, media: [], links: ['https://example.com'], tags: [], ingestedVia: 'graphql' },
    { id: '2', tweetId: '2', url: 'https://x.com/bob/status/2', text: 'Rust is a great systems programming language', authorHandle: 'bob', authorName: 'Bob Jones', syncedAt: '2026-02-01T00:00:00Z', postedAt: 'Sat Feb 01 12:00:00 +0000 2026', language: 'en', engagement: { likeCount: 50 }, media: [], links: [], tags: [], ingestedVia: 'graphql' },
    { id: '3', tweetId: '3', url: 'https://x.com/alice/status/3', text: 'Deep learning models need massive compute', authorHandle: 'alice', authorName: 'Alice Smith', syncedAt: '2026-03-01T00:00:00Z', postedAt: 'Sat Mar 01 12:00:00 +0000 2026', language: 'en', engagement: { likeCount: 200, repostCount: 30 }, media: ['https://img.com/1.jpg'], links: [], tags: [], ingestedVia: 'graphql' },
  ];
  const jsonl = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(path.join(cwd, 'automation', 'sources', 'x-bookmarks.jsonl'), jsonl);
  return cwd;
}

test('buildIndex creates a searchable database', async () => {
  const cwd = await setupFixture();
  const result = await buildIndex(cwd);
  assert.equal(result.recordCount, 3);
  assert.ok(result.dbPath.endsWith('x-bookmarks.db'));
});

test('searchBookmarks: full-text search returns matching results', async () => {
  const cwd = await setupFixture();
  await buildIndex(cwd);

  const results = await searchBookmarks({ query: 'learning', limit: 10 }, cwd);
  assert.equal(results.length, 2);
  assert.ok(results.some((r) => r.id === '1'));
  assert.ok(results.some((r) => r.id === '3'));
});

test('searchBookmarks: author filter works', async () => {
  const cwd = await setupFixture();
  await buildIndex(cwd);

  const results = await searchBookmarks({ query: '', author: 'alice', limit: 10 }, cwd);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.authorHandle === 'alice'));
});

test('searchBookmarks: combined query + author filter', async () => {
  const cwd = await setupFixture();
  await buildIndex(cwd);

  const results = await searchBookmarks({ query: 'learning', author: 'alice', limit: 10 }, cwd);
  assert.equal(results.length, 2);
});

test('searchBookmarks: no results for unmatched query', async () => {
  const cwd = await setupFixture();
  await buildIndex(cwd);

  const results = await searchBookmarks({ query: 'cryptocurrency', limit: 10 }, cwd);
  assert.equal(results.length, 0);
});

test('getStats returns correct aggregate data', async () => {
  const cwd = await setupFixture();
  await buildIndex(cwd);

  const stats = await getStats(cwd);
  assert.equal(stats.totalBookmarks, 3);
  assert.equal(stats.uniqueAuthors, 2);
  assert.equal(stats.topAuthors[0].handle, 'alice');
  assert.equal(stats.topAuthors[0].count, 2);
  assert.equal(stats.languageBreakdown[0].language, 'en');
  assert.equal(stats.languageBreakdown[0].count, 3);
});

test('formatSearchResults: formats results with author, date, text, url', () => {
  const results = [
    { id: '1', url: 'https://x.com/test/status/1', text: 'Hello world', authorHandle: 'test', authorName: 'Test', postedAt: '2026-01-15T00:00:00Z', score: -1.5 },
  ];
  const formatted = formatSearchResults(results);
  assert.ok(formatted.includes('@test'));
  assert.ok(formatted.includes('2026-01-15'));
  assert.ok(formatted.includes('Hello world'));
  assert.ok(formatted.includes('https://x.com/test/status/1'));
});

test('formatSearchResults: returns message for empty results', () => {
  assert.equal(formatSearchResults([]), 'No results found.');
});
