import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthManager } from './authManager';
import { sharedFilesRoot } from './sharedFiles';
import { SharedSyncService } from './sharedSyncService';
import type { SharedTeamService } from './sharedTeamService';

describe('SharedSyncService cache behavior', () => {
  let tempRoot: string;
  let originalLibraryDir: string | undefined;
  let originalSharedFilesCacheDir: string | undefined;
  let originalSharedFilesDir: string | undefined;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-sync-service-test-'));
    originalLibraryDir = process.env.FT_LIBRARY_DIR;
    originalSharedFilesCacheDir = process.env.FT_SHARED_FILES_CACHE_DIR;
    originalSharedFilesDir = process.env.FT_SHARED_FILES_DIR;
    process.env.FT_LIBRARY_DIR = path.join(tempRoot, 'library');
    process.env.FT_SHARED_FILES_CACHE_DIR = path.join(tempRoot, 'library', 'River (shared)');
    process.env.FT_SHARED_FILES_DIR = process.env.FT_SHARED_FILES_CACHE_DIR;
  });

  afterEach(() => {
    if (originalLibraryDir === undefined) delete process.env.FT_LIBRARY_DIR;
    else process.env.FT_LIBRARY_DIR = originalLibraryDir;
    if (originalSharedFilesCacheDir === undefined) delete process.env.FT_SHARED_FILES_CACHE_DIR;
    else process.env.FT_SHARED_FILES_CACHE_DIR = originalSharedFilesCacheDir;
    if (originalSharedFilesDir === undefined) delete process.env.FT_SHARED_FILES_DIR;
    else process.env.FT_SHARED_FILES_DIR = originalSharedFilesDir;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('unshares an open River cache file by shared row id', async () => {
    const updates: Array<{ field: string; value: unknown }> = [];
    const supabase = {
      from: () => ({
        update: () => ({
          eq(field: string, value: unknown) {
            updates.push({ field, value });
            return this;
          },
          async is(field: string, value: unknown) {
            updates.push({ field, value });
            return { error: null };
          },
        }),
      }),
    };
    const authManager = {
      getSupabaseClient: () => supabase,
      getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;
    const root = sharedFilesRoot();
    fs.mkdirSync(root, { recursive: true });
    const cachePath = path.join(root, 'Roadmap AF.md');
    fs.writeFileSync(cachePath, '---\nshared: true\nshared_id: "shared-1"\nshared_type: "document"\n---\n\nBody\n');

    await expect(new SharedSyncService(authManager).unshareFile(cachePath)).resolves.toBe(true);

    expect(updates).toEqual([
      { field: 'created_by', value: 'user-1' },
      { field: 'id', value: 'shared-1' },
      { field: 'deleted_at', value: null },
    ]);
  });

  it('reuses the existing cache file for a shared row', () => {
    const root = sharedFilesRoot();
    fs.mkdirSync(root, { recursive: true });
    const cachePath = path.join(root, 'Original AF.md');
    fs.writeFileSync(cachePath, '---\nshared: true\nshared_id: "shared-1"\nshared_type: "document"\n---\n\nBody\n');

    const service = new SharedSyncService({} as AuthManager);

    expect(service.cachePathForRow({
      id: 'shared-1',
      title: 'Renamed',
      shared_name: 'Renamed',
      author_initials: 'AF',
    })).toBe(cachePath);
  });

  it('keeps River unavailable for solo users without accepted team contacts', async () => {
    const authManager = {
      getSupabaseClient: () => ({}),
      getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;
    const teamService = {
      getTeamState: async () => ({
        available: false,
        currentTeamScopeUserId: null,
        reason: 'no_team_members',
        isOwner: false,
        members: [],
        pendingIncoming: [],
        pendingOutgoing: [],
      }),
    };

    await expect(new SharedSyncService(authManager, teamService as unknown as SharedTeamService).getAvailability()).resolves.toEqual({
      available: false,
      hasTeamMembers: false,
      reason: 'no_team_members',
      currentTeamScopeUserId: null,
    });
  });

  it('does not create a shared row for solo users', async () => {
    const fromCalls: string[] = [];
    const supabase = {
      from(table: string) {
        fromCalls.push(table);
        return {
          select() { return this; },
          eq() { return this; },
          or() { return this; },
          async limit() {
            return { data: [], error: null };
          },
        };
      },
    };
    const authManager = {
      getSupabaseClient: () => supabase,
      getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;
    const teamService = {
      getTeamState: async () => ({
        available: false,
        currentTeamScopeUserId: null,
        reason: 'no_team_members',
        isOwner: false,
        members: [],
        pendingIncoming: [],
        pendingOutgoing: [],
      }),
    };

    await expect(new SharedSyncService(authManager, teamService as unknown as SharedTeamService).shareFile({
      filePath: path.join(process.env.FT_LIBRARY_DIR ?? tempRoot, 'scratchpad', 'Note.md'),
      title: 'Note',
      content: 'Body\n',
      type: 'document',
    })).resolves.toEqual({ shared: false });
    expect(fromCalls).toEqual([]);
  });

  it('creates shared rows under the resolved team scope', async () => {
    let upsertedRow: Record<string, unknown> | null = null;
    const supabase = {
      from: () => ({
        upsert(row: Record<string, unknown>) {
          upsertedRow = row;
          return {
            select() {
              return {
                async single() {
                  return {
                    data: {
                      id: 'shared-1',
                      created_at: '2026-01-01T00:00:00Z',
                      updated_at: '2026-01-01T00:00:00Z',
                      ...row,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      }),
    };
    const authManager = {
      getSupabaseClient: () => supabase,
      getSession: () => ({ user: { id: 'user-2', email: 'js@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;
    const teamService = {
      getTeamState: async () => ({
        available: true,
        currentTeamScopeUserId: 'owner-1',
        isOwner: false,
        members: [],
        pendingIncoming: [],
        pendingOutgoing: [],
      }),
    };

    await expect(new SharedSyncService(authManager, teamService as unknown as SharedTeamService).shareFile({
      filePath: path.join(process.env.FT_LIBRARY_DIR ?? tempRoot, 'scratchpad', 'Note.md'),
      title: 'Note',
      content: 'Body\n',
      type: 'document',
    })).resolves.toMatchObject({ shared: true, sharedId: 'shared-1' });
    expect(upsertedRow).toMatchObject({
      team_scope_user_id: 'owner-1',
      created_by: 'user-2',
      updated_by: 'user-2',
    });
  });

  it('excludes the current user from open-file presence chips', () => {
    const service = new SharedSyncService({} as AuthManager);
    const users = (service as unknown as {
      presenceUsersFromState: (
        state: Record<string, Array<Record<string, unknown>>>,
        currentUserId?: string,
      ) => Array<{ userId: string; email: string | null; initials: string }>;
    }).presenceUsersFromState({
      'user-1': [{ userId: 'user-1', email: 'af@example.com', initials: 'AF' }],
      'user-2': [{ userId: 'user-2', email: 'js@example.com', initials: 'JS' }],
    }, 'user-1');

    expect(users).toEqual([{ userId: 'user-2', email: 'js@example.com', initials: 'JS' }]);
  });
});
