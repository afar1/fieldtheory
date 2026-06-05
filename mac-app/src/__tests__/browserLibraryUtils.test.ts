import { describe, expect, it } from 'vitest';
import { mergeBrowserHelperRefreshDetail } from '../browser-library';

describe('mergeBrowserHelperRefreshDetail', () => {
  it('drops stale recent entries when the latest coalesced event has no payload', () => {
    const merged = mergeBrowserHelperRefreshDetail(
      'recent:changed',
      {
        entries: [{ kind: 'wiki', path: 'entries/old', title: 'Old', lastOpenedAt: 1 }],
        sources: ['recent:changed'],
      },
      {},
      ['recent:changed'],
    );

    expect(merged).toEqual({ sources: ['recent:changed'] });
  });

  it('keeps recent entries when the latest coalesced event carries them', () => {
    const entries = [{ kind: 'wiki', path: 'entries/new', title: 'New', lastOpenedAt: 2 }];

    expect(mergeBrowserHelperRefreshDetail(
      'recent:changed',
      {},
      { entries },
      ['recent:changed'],
    )).toEqual({ entries, sources: ['recent:changed'] });
  });
});
