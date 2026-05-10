import { describe, it, expect } from 'vitest';
import {
  deletedRemoteRecordTimestamp,
  filterPendingDeletesByCollection,
  filterRecordsDeletedRemotely,
  mergeByLastWriteWins,
  withUpdatedAt,
} from '../../../services/syncUtils';

type TestRecord = {
  id: string;
  text: string;
  createdAt: number;
  updatedAt?: number;
};

describe('withUpdatedAt', () => {
  it('returns updatedAt unchanged when present', () => {
    const record: TestRecord = {
      id: '1',
      text: 'test',
      createdAt: 1000,
      updatedAt: 2000,
    };
    const result = withUpdatedAt(record);
    expect(result.updatedAt).toBe(2000);
  });

  it('uses createdAt when updatedAt is missing', () => {
    const record: TestRecord = {
      id: '1',
      text: 'test',
      createdAt: 1000,
    };
    const result = withUpdatedAt(record);
    expect(result.updatedAt).toBe(1000);
  });

  it('preserves all other fields', () => {
    const record: TestRecord = {
      id: '123',
      text: 'hello world',
      createdAt: 1000,
    };
    const result = withUpdatedAt(record);
    expect(result.id).toBe('123');
    expect(result.text).toBe('hello world');
    expect(result.createdAt).toBe(1000);
  });
});

describe('mergeByLastWriteWins', () => {
  describe('basic merging', () => {
    it('returns local records when remote is empty', () => {
      const local: TestRecord[] = [
        { id: '1', text: 'local', createdAt: 1000, updatedAt: 1000 },
      ];
      const result = mergeByLastWriteWins(local, []);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('local');
    });

    it('returns remote records when local is empty', () => {
      const remote: TestRecord[] = [
        { id: '1', text: 'remote', createdAt: 1000, updatedAt: 1000 },
      ];
      const result = mergeByLastWriteWins([], remote);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('remote');
    });

    it('returns empty array when both are empty', () => {
      const result = mergeByLastWriteWins<TestRecord>([], []);
      expect(result).toHaveLength(0);
    });

    it('merges records with different IDs', () => {
      const local: TestRecord[] = [
        { id: '1', text: 'local', createdAt: 1000, updatedAt: 1000 },
      ];
      const remote: TestRecord[] = [
        { id: '2', text: 'remote', createdAt: 1000, updatedAt: 1000 },
      ];
      const result = mergeByLastWriteWins(local, remote);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.id).sort()).toEqual(['1', '2']);
    });
  });

  describe('conflict resolution', () => {
    it('remote wins when remote timestamp is newer', () => {
      const local: TestRecord[] = [
        { id: '1', text: 'local', createdAt: 1000, updatedAt: 1000 },
      ];
      const remote: TestRecord[] = [
        { id: '1', text: 'remote', createdAt: 1000, updatedAt: 2000 },
      ];
      const result = mergeByLastWriteWins(local, remote);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('remote');
      expect(result[0].updatedAt).toBe(2000);
    });

    it('local wins when local timestamp is newer', () => {
      const local: TestRecord[] = [
        { id: '1', text: 'local', createdAt: 1000, updatedAt: 3000 },
      ];
      const remote: TestRecord[] = [
        { id: '1', text: 'remote', createdAt: 1000, updatedAt: 2000 },
      ];
      const result = mergeByLastWriteWins(local, remote);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('local');
      expect(result[0].updatedAt).toBe(3000);
    });

    it('remote wins on tie (same timestamp)', () => {
      const local: TestRecord[] = [
        { id: '1', text: 'local', createdAt: 1000, updatedAt: 2000 },
      ];
      const remote: TestRecord[] = [
        { id: '1', text: 'remote', createdAt: 1000, updatedAt: 2000 },
      ];
      const result = mergeByLastWriteWins(local, remote);
      expect(result).toHaveLength(1);
      // With >= comparison, remote wins ties
      expect(result[0].text).toBe('remote');
    });
  });

  describe('missing updatedAt handling', () => {
    it('uses createdAt when local has no updatedAt', () => {
      const local: TestRecord[] = [
        { id: '1', text: 'local', createdAt: 1000 },
      ];
      const remote: TestRecord[] = [
        { id: '1', text: 'remote', createdAt: 1000, updatedAt: 2000 },
      ];
      const result = mergeByLastWriteWins(local, remote);
      expect(result[0].text).toBe('remote');
    });

    it('uses createdAt when remote has no updatedAt', () => {
      const local: TestRecord[] = [
        { id: '1', text: 'local', createdAt: 1000, updatedAt: 2000 },
      ];
      const remote: TestRecord[] = [
        { id: '1', text: 'remote', createdAt: 1000 },
      ];
      const result = mergeByLastWriteWins(local, remote);
      expect(result[0].text).toBe('local');
    });

    it('uses createdAt when both have no updatedAt - remote wins tie', () => {
      const local: TestRecord[] = [
        { id: '1', text: 'local', createdAt: 1000 },
      ];
      const remote: TestRecord[] = [
        { id: '1', text: 'remote', createdAt: 1000 },
      ];
      const result = mergeByLastWriteWins(local, remote);
      // Both normalize to updatedAt: 1000, remote wins tie
      expect(result[0].text).toBe('remote');
    });
  });

  describe('multiple records', () => {
    it('handles mixed conflicts and new records', () => {
      const local: TestRecord[] = [
        { id: '1', text: 'local-old', createdAt: 1000, updatedAt: 1000 },
        { id: '2', text: 'local-new', createdAt: 1000, updatedAt: 3000 },
        { id: '3', text: 'local-only', createdAt: 1000, updatedAt: 1000 },
      ];
      const remote: TestRecord[] = [
        { id: '1', text: 'remote-new', createdAt: 1000, updatedAt: 2000 },
        { id: '2', text: 'remote-old', createdAt: 1000, updatedAt: 2000 },
        { id: '4', text: 'remote-only', createdAt: 1000, updatedAt: 1000 },
      ];
      const result = mergeByLastWriteWins(local, remote);

      expect(result).toHaveLength(4);

      const byId = new Map(result.map((r) => [r.id, r]));
      expect(byId.get('1')?.text).toBe('remote-new'); // remote wins (2000 > 1000)
      expect(byId.get('2')?.text).toBe('local-new'); // local wins (3000 > 2000)
      expect(byId.get('3')?.text).toBe('local-only'); // only in local
      expect(byId.get('4')?.text).toBe('remote-only'); // only in remote
    });

    it('handles large number of records efficiently', () => {
      const local: TestRecord[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `local-${i}`,
        text: `local-${i}`,
        createdAt: 1000,
        updatedAt: 1000,
      }));
      const remote: TestRecord[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `remote-${i}`,
        text: `remote-${i}`,
        createdAt: 1000,
        updatedAt: 1000,
      }));

      const start = performance.now();
      const result = mergeByLastWriteWins(local, remote);
      const duration = performance.now() - start;

      expect(result).toHaveLength(2000);
      expect(duration).toBeLessThan(100); // Should be fast
    });
  });

  describe('edge cases', () => {
    it('handles duplicate IDs in local array (last wins)', () => {
      const local: TestRecord[] = [
        { id: '1', text: 'first', createdAt: 1000, updatedAt: 1000 },
        { id: '1', text: 'second', createdAt: 1000, updatedAt: 1000 },
      ];
      const result = mergeByLastWriteWins(local, []);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('second');
    });

    it('handles duplicate IDs in remote array (last wins)', () => {
      const remote: TestRecord[] = [
        { id: '1', text: 'first', createdAt: 1000, updatedAt: 1000 },
        { id: '1', text: 'second', createdAt: 1000, updatedAt: 1000 },
      ];
      const result = mergeByLastWriteWins([], remote);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('second');
    });

    it('preserves record structure exactly', () => {
      type ExtendedRecord = TestRecord & { extra: string };
      const local: ExtendedRecord[] = [
        { id: '1', text: 'test', createdAt: 1000, updatedAt: 2000, extra: 'data' },
      ];
      const result = mergeByLastWriteWins(local, []);
      expect((result[0] as ExtendedRecord).extra).toBe('data');
    });
  });
});

describe('mobile sync delete helpers', () => {
  it('filters local records when the remote delete is newer', () => {
    const records: TestRecord[] = [
      { id: '1', text: 'stale local', createdAt: 1000, updatedAt: 2000 },
      { id: '2', text: 'keep me', createdAt: 1000, updatedAt: 2000 },
    ];

    const result = filterRecordsDeletedRemotely(records, [
      {
        client_id: '1',
        client_updated_at_ms: 3000,
        deleted_at: new Date(3000).toISOString(),
      },
    ]);

    expect(result.map((record) => record.id)).toEqual(['2']);
  });

  it('keeps local records when the local edit is newer than the remote delete', () => {
    const records: TestRecord[] = [
      { id: '1', text: 'newer local', createdAt: 1000, updatedAt: 4000 },
    ];

    const result = filterRecordsDeletedRemotely(records, [
      {
        client_id: '1',
        client_updated_at_ms: 3000,
        deleted_at: new Date(3000).toISOString(),
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('newer local');
  });

  it('does not let a late server write time make an older delete win', () => {
    const row = {
      client_id: '1',
      client_updated_at_ms: 2000,
      deleted_at: new Date(2000).toISOString(),
      updated_at: new Date(9000).toISOString(),
    };

    expect(deletedRemoteRecordTimestamp(row)).toBe(2000);
  });

  it('filters pending deletes only for the requested collection', () => {
    const records: TestRecord[] = [
      { id: '1', text: 'todo delete', createdAt: 1000, updatedAt: 1000 },
      { id: '2', text: 'keep', createdAt: 1000, updatedAt: 1000 },
    ];

    const result = filterPendingDeletesByCollection(records, [
      { collection: 'todos', id: '1', deletedAt: 3000 },
      { collection: 'transcripts', id: '2', deletedAt: 3000 },
    ], 'todos');

    expect(result.map((record) => record.id)).toEqual(['2']);
  });
});
