/**
 * Pure utility functions for sync operations.
 * Extracted for testability (no external dependencies).
 */

export type SyncRecord = {
  id: string;
  createdAt: number;
  updatedAt?: number;
};

export type RemoteDeletedSyncRecord = {
  client_id: string;
  client_updated_at_ms?: number | null;
  deleted_at?: string | null;
  updated_at?: string;
};

export type SyncDeleteTombstone = {
  collection: string;
  id: string;
  deletedAt: number;
};

/**
 * Ensures a record has an updatedAt timestamp.
 * Uses createdAt as fallback if updatedAt is missing.
 */
export const withUpdatedAt = <T extends SyncRecord>(record: T): T => ({
  ...record,
  updatedAt: record.updatedAt ?? record.createdAt,
});

export const timestampFromIso = (value: string | null | undefined) => {
  if (!value) return -Infinity;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : -Infinity;
};

export const deletedRemoteRecordTimestamp = (row: RemoteDeletedSyncRecord) =>
  Math.max(row.client_updated_at_ms ?? -Infinity, timestampFromIso(row.deleted_at));

/**
 * Merges local and remote records using last-write-wins strategy.
 *
 * Conflict resolution:
 * - Remote wins if remoteTimestamp >= localTimestamp
 * - Local wins if localTimestamp > remoteTimestamp
 *
 * Note: Remote wins ties (>=), which means in a true concurrent edit,
 * the server's version takes precedence. This is intentional for consistency.
 */
export const mergeByLastWriteWins = <T extends SyncRecord>(
  localRecords: T[],
  remoteRecords: T[],
): T[] => {
  const merged = new Map<string, T>();

  localRecords.forEach((record) => {
    merged.set(record.id, withUpdatedAt(record));
  });

  remoteRecords.forEach((record) => {
    const normalizedRemote = withUpdatedAt(record);
    const current = merged.get(normalizedRemote.id);
    const remoteTimestamp = normalizedRemote.updatedAt ?? normalizedRemote.createdAt;
    const localTimestamp = current ? current.updatedAt ?? current.createdAt : -Infinity;

    if (!current || remoteTimestamp >= localTimestamp) {
      merged.set(normalizedRemote.id, normalizedRemote);
    }
  });

  return Array.from(merged.values());
};

export const filterPendingDeletesByCollection = <T extends { id: string }>(
  records: T[],
  tombstones: SyncDeleteTombstone[],
  collection: string,
) => {
  const deletedIds = new Set(
    tombstones
      .filter((tombstone) => tombstone.collection === collection)
      .map((tombstone) => tombstone.id),
  );

  return records.filter((record) => !deletedIds.has(record.id));
};

export const filterRecordsDeletedRemotely = <T extends SyncRecord>(
  records: T[],
  deletedRows: RemoteDeletedSyncRecord[],
) => {
  const deletedAtById = new Map<string, number>();

  deletedRows.forEach((row) => {
    const deletedAt = deletedRemoteRecordTimestamp(row);
    const current = deletedAtById.get(row.client_id) ?? -Infinity;
    if (deletedAt > current) {
      deletedAtById.set(row.client_id, deletedAt);
    }
  });

  return records.filter((record) => {
    const deletedAt = deletedAtById.get(record.id);
    if (deletedAt === undefined) return true;
    return (record.updatedAt ?? record.createdAt) > deletedAt;
  });
};
