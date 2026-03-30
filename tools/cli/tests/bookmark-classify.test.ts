import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBookmark, classifyCorpus } from '../src/bookmark-classify.js';
import type { BookmarkRecord } from '../src/types.js';

function makeBookmark(overrides: Partial<BookmarkRecord> = {}): BookmarkRecord {
  return {
    id: '1',
    tweetId: '1',
    url: 'https://x.com/user/status/1',
    text: '',
    syncedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('classifyBookmark', () => {
  test('classifies GitHub URL in text as tool', () => {
    const b = makeBookmark({ text: 'Check out https://github.com/vercel/next.js for SSR' });
    const result = classifyBookmark(b);
    assert.ok(result.categories.includes('tool'));
    assert.equal(result.githubUrls.length, 1);
    assert.match(result.githubUrls[0], /github\.com\/vercel\/next\.js/);
  });

  test('classifies GitHub URL in links field as tool', () => {
    const b = makeBookmark({ text: 'Cool project', links: ['https://github.com/foo/bar'] });
    const result = classifyBookmark(b);
    assert.ok(result.categories.includes('tool'));
  });

  test('classifies CVE mention as security', () => {
    const b = makeBookmark({ text: 'CVE-2024-1234 affects all versions of openssl' });
    const result = classifyBookmark(b);
    assert.ok(result.categories.includes('security'));
    assert.equal(result.primary, 'security');
  });

  test('classifies vulnerability language as security', () => {
    const b = makeBookmark({ text: 'Critical zero-day vulnerability found in popular npm package' });
    const result = classifyBookmark(b);
    assert.ok(result.categories.includes('security'));
  });

  test('classifies tutorial language as technique', () => {
    const b = makeBookmark({ text: 'How I built a real-time dashboard with WebSockets' });
    const result = classifyBookmark(b);
    assert.ok(result.categories.includes('technique'));
  });

  test('classifies product launch as launch', () => {
    const b = makeBookmark({ text: 'We just shipped v2.0 of our CLI tool! Now available on npm' });
    const result = classifyBookmark(b);
    assert.ok(result.categories.includes('launch'));
  });

  test('classifies arxiv link as research', () => {
    const b = makeBookmark({ text: 'New paper on attention mechanisms', links: ['https://arxiv.org/abs/2401.12345'] });
    const result = classifyBookmark(b);
    assert.ok(result.categories.includes('research'));
  });

  test('classifies shopping content as commerce', () => {
    const b = makeBookmark({ text: 'Amazing deal on Amazon! Shop here: https://www.amazon.com/dp/B08XYZ' });
    const result = classifyBookmark(b);
    assert.ok(result.categories.includes('commerce'));
  });

  test('returns unclassified for generic content', () => {
    const b = makeBookmark({ text: 'Just vibing on a Saturday afternoon 🌴' });
    const result = classifyBookmark(b);
    assert.equal(result.categories.length, 0);
    assert.equal(result.primary, 'unclassified');
  });

  test('can have multiple categories', () => {
    const b = makeBookmark({ text: 'Just open-sourced our security scanner https://github.com/org/scanner — finds zero-day vulnerabilities' });
    const result = classifyBookmark(b);
    assert.ok(result.categories.includes('security'));
    assert.ok(result.categories.includes('tool'));
  });

  test('security takes priority over tool when both match', () => {
    const b = makeBookmark({ text: 'CVE-2024-5678 in popular GitHub project https://github.com/foo/bar compromised' });
    const result = classifyBookmark(b);
    assert.equal(result.primary, 'security');
  });
});

describe('classifyCorpus', () => {
  test('returns summary with correct counts', () => {
    const bookmarks = [
      makeBookmark({ id: '1', text: 'Check https://github.com/foo/bar' }),
      makeBookmark({ id: '2', text: 'CVE-2024-1234 is bad' }),
      makeBookmark({ id: '3', text: 'Nice sunset photo' }),
    ];
    const { results, summary } = classifyCorpus(bookmarks);
    assert.equal(summary.total, 3);
    assert.equal(summary.unclassified, 1);
    assert.equal(summary.classified, 2);
    assert.equal(results.size, 3);
  });
});
