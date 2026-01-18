/**
 * Pure utility functions for sync operations.
 * Extracted for testability (no external dependencies).
 */

export type SyncRecord = {
  id: string;
  createdAt: number;
  updatedAt?: number;
};

/**
 * Ensures a record has an updatedAt timestamp.
 * Uses createdAt as fallback if updatedAt is missing.
 */
export const withUpdatedAt = <T extends SyncRecord>(record: T): T => ({
  ...record,
  updatedAt: record.updatedAt ?? record.createdAt,
});

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
