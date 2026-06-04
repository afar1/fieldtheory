import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    const deletes: Array<{ field: string; value: unknown }> = [];
    const supabase = {
      from: (table: string) => {
        if (table === 'team_document_pins') {
          return {
            delete: () => ({
              async eq(field: string, value: unknown) {
                deletes.push({ field, value });
                return { error: null };
              },
            }),
          };
        }
        return {
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
        };
      },
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
    expect(deletes).toEqual([{ field: 'document_id', value: 'shared-1' }]);
    expect(fs.existsSync(cachePath)).toBe(false);
  });

  it('removes shared pin rows when unsharing the original source file', async () => {
    const deletes: Array<{ field: string; value: unknown }> = [];
    const supabase = {
      from: (table: string) => {
        if (table === 'team_document_pins') {
          return {
            delete: () => ({
              async eq(field: string, value: unknown) {
                deletes.push({ field, value });
                return { error: null };
              },
            }),
          };
        }
        return {
          update: () => ({
            eq() {
              return this;
            },
            async is() {
              return { error: null };
            },
          }),
        };
      },
    };
    const authManager = {
      getSupabaseClient: () => supabase,
      getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;
    const root = sharedFilesRoot();
    fs.mkdirSync(root, { recursive: true });
    const sourcePath = path.join(process.env.FT_LIBRARY_DIR ?? tempRoot, 'Commands', 'brief.md');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, '# brief\n');
    const cachePath = path.join(root, 'brief AM.md');
    fs.writeFileSync(cachePath, [
      '---',
      'shared: true',
      'shared_id: "shared-1"',
      'shared_type: "command"',
      'shared_original_source_path: "Commands/brief.md"',
      '---',
      '',
      'Body',
    ].join('\n'));

    const service = new SharedSyncService(authManager);
    const pinsChanged = vi.fn();
    service.on('pinsChanged', pinsChanged);

    await expect(service.unshareFile(sourcePath)).resolves.toBe(true);

    expect(deletes).toEqual([{ field: 'document_id', value: 'shared-1' }]);
    expect(pinsChanged).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(cachePath)).toBe(false);
  });

  it('removes a River cache file immediately when unsharing the original source file', async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'team_document_pins') {
          return {
            delete: () => ({
              async eq() {
                return { error: null };
              },
            }),
          };
        }
        return {
          update: () => ({
            eq() {
              return this;
            },
            async is() {
              return { error: null };
            },
          }),
        };
      },
    };
    const authManager = {
      getSupabaseClient: () => supabase,
      getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;
    const root = sharedFilesRoot();
    fs.mkdirSync(root, { recursive: true });
    const sourcePath = path.join(process.env.FT_LIBRARY_DIR ?? tempRoot, 'Commands', 'brief.md');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, '# brief\n');
    const cachePath = path.join(root, 'brief AM.md');
    fs.writeFileSync(cachePath, [
      '---',
      'shared: true',
      'shared_id: "shared-1"',
      'shared_type: "command"',
      'shared_original_source_path: "Commands/brief.md"',
      '---',
      '',
      'Body',
    ].join('\n'));

    await expect(new SharedSyncService(authManager).unshareFile(sourcePath)).resolves.toBe(true);

    expect(fs.existsSync(cachePath)).toBe(false);
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
      canWrite: false,
      hasTeamMembers: false,
      reason: 'no_team_members',
      currentTeamScopeUserId: null,
    });
  });

  it('makes River available for owners with a pending outgoing team invite', async () => {
    const authManager = {
      getSupabaseClient: () => ({}),
      getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;
    const teamService = {
      getTeamState: async () => ({
        available: true,
        currentTeamScopeUserId: 'user-1',
        isOwner: true,
        members: [],
        pendingIncoming: [],
        pendingOutgoing: [{ contactId: 'contact-1', ownerUserId: 'user-1', contactUserId: 'user-2', email: 'jamie@example.com', direction: 'outgoing' }],
      }),
    };

    await expect(new SharedSyncService(authManager, teamService as unknown as SharedTeamService).getAvailability()).resolves.toEqual({
      available: true,
      canWrite: true,
      hasTeamMembers: true,
      reason: undefined,
      currentTeamScopeUserId: 'user-1',
    });
  });

  it('makes River available for pending invitees under the owner team scope', async () => {
    const authManager = {
      getSupabaseClient: () => ({}),
      getSession: () => ({ user: { id: 'user-2', email: 'jamie@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;
    const teamService = {
      getTeamState: async () => ({
        available: true,
        currentTeamScopeUserId: 'owner-1',
        isOwner: false,
        members: [{ contactId: 'contact-1', userId: 'owner-1', email: '', role: 'owner', teamScopeUserId: 'owner-1' }],
        pendingIncoming: [{ contactId: 'contact-1', ownerUserId: 'owner-1', contactUserId: 'user-2', email: 'jamie@example.com', direction: 'incoming' }],
        pendingOutgoing: [],
      }),
    };

    await expect(new SharedSyncService(authManager, teamService as unknown as SharedTeamService).getAvailability()).resolves.toEqual({
      available: true,
      canWrite: false,
      hasTeamMembers: true,
      reason: undefined,
      currentTeamScopeUserId: 'owner-1',
    });
  });

  it('creates the River cache directory when a team scope is active', async () => {
    const supabase = {
      from: () => ({
        select() { return this; },
        eq() { return this; },
        async is() {
          return { data: [], error: null };
        },
      }),
    };
    const authManager = {
      getSupabaseClient: () => supabase,
      getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;
    const teamService = {
      getTeamState: async () => ({
        available: true,
        currentTeamScopeUserId: 'user-1',
        isOwner: true,
        members: [],
        pendingIncoming: [],
        pendingOutgoing: [],
      }),
    };

    expect(fs.existsSync(sharedFilesRoot())).toBe(false);

    await expect(new SharedSyncService(authManager, teamService as unknown as SharedTeamService).syncOnce()).resolves.toEqual({
      written: 0,
      removed: 0,
      created: 1,
      errors: [],
    });
    expect(fs.existsSync(sharedFilesRoot())).toBe(true);
  });

  it('removes stale River cache files after a team document realtime change', async () => {
    const root = sharedFilesRoot();
    fs.mkdirSync(root, { recursive: true });
    const cachePath = path.join(root, 'Removed AF.md');
    fs.writeFileSync(cachePath, [
      '---',
      'shared: true',
      'shared_id: "shared-removed"',
      'shared_type: "document"',
      '---',
      '',
      'Body',
    ].join('\n'));

    const realtimeHandlers: Record<string, (() => void) | undefined> = {};
    const channel = {
      on: vi.fn((_event: string, config: { table?: string }, handler: () => void) => {
        if (config.table) realtimeHandlers[config.table] = handler;
        return channel;
      }),
      subscribe: vi.fn(() => channel),
    };
    const supabase = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => undefined),
      from: () => ({
        select() { return this; },
        eq() { return this; },
        async is() {
          return { data: [], error: null };
        },
      }),
    };
    const authManager = {
      getSupabaseClient: () => supabase,
      getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;
    const teamService = {
      getTeamState: async () => ({
        available: true,
        currentTeamScopeUserId: 'user-1',
        isOwner: true,
        members: [],
        pendingIncoming: [],
        pendingOutgoing: [],
      }),
    };
    const cacheChanged = vi.fn();
    const pinsChanged = vi.fn();
    const service = new SharedSyncService(authManager, teamService as unknown as SharedTeamService);
    service.on('cacheChanged', cacheChanged);
    service.on('pinsChanged', pinsChanged);

    await service.startRemoteChangeSync();
    expect(realtimeHandlers.team_documents).toEqual(expect.any(Function));
    expect(realtimeHandlers.team_document_pins).toEqual(expect.any(Function));
    const handler = realtimeHandlers.team_documents as () => void;
    handler();
    await vi.waitFor(() => {
      expect(fs.existsSync(cachePath)).toBe(false);
    });

    expect(supabase.channel).toHaveBeenCalledWith('shared-team-documents:user-1');
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'team_documents',
        filter: 'team_scope_user_id=eq.user-1',
      },
      expect.any(Function),
    );
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'team_document_pins',
        filter: 'team_scope_user_id=eq.user-1',
      },
      expect.any(Function),
    );
    expect(cacheChanged).toHaveBeenCalledWith({
      written: 0,
      removed: 1,
      created: 0,
      errors: [],
    });
    expect(pinsChanged).toHaveBeenCalledTimes(1);
    const pinHandler = realtimeHandlers.team_document_pins as () => void;
    pinHandler();
    expect(pinsChanged).toHaveBeenCalledTimes(2);
  });

  it('resubscribes River realtime when the active team scope changes', async () => {
    let currentTeamScopeUserId = 'team-1';
    const channels: Array<{ name: string; on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }> = [];
    const removedChannels: string[] = [];
    const supabase = {
      channel: vi.fn((name: string) => {
        const channel = {
          name,
          on: vi.fn(() => channel),
          subscribe: vi.fn(() => channel),
        };
        channels.push(channel);
        return channel;
      }),
      removeChannel: vi.fn(async (channel: { name: string }) => {
        removedChannels.push(channel.name);
      }),
      from: () => ({
        select() { return this; },
        eq() { return this; },
        async is() {
          return { data: [], error: null };
        },
      }),
    };
    const authManager = {
      getSupabaseClient: () => supabase,
      getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;
    const teamService = {
      getTeamState: async () => ({
        available: true,
        currentTeamScopeUserId,
        isOwner: currentTeamScopeUserId === 'user-1',
        members: [],
        pendingIncoming: [],
        pendingOutgoing: [],
      }),
    };
    const service = new SharedSyncService(authManager, teamService as unknown as SharedTeamService);

    await service.startRemoteChangeSync();
    currentTeamScopeUserId = 'team-2';
    await service.startRemoteChangeSync();

    expect(supabase.channel).toHaveBeenCalledWith('shared-team-documents:team-1');
    expect(supabase.channel).toHaveBeenCalledWith('shared-team-documents:team-2');
    expect(removedChannels).toEqual(['shared-team-documents:team-1']);
    expect(channels).toHaveLength(2);
  });

  it('refreshes another local River cache and pin set from simulated team realtime events', async () => {
    const senderRoot = path.join(tempRoot, 'sender-library');
    const receiverRoot = path.join(tempRoot, 'receiver-library');
    const senderRiverRoot = path.join(senderRoot, 'River (shared)');
    const receiverRiverRoot = path.join(receiverRoot, 'River (shared)');
    const receiverCachePath = path.join(receiverRiverRoot, 'Plan AF.md');
    const currentRow = {
      id: 'shared-1',
      team_scope_user_id: 'team-1',
      kind: 'document',
      path: 'Docs/scratchpad/Plan.md',
      title: 'Plan',
      content: 'Old body\n',
      content_hash: null,
      client_id: 'shared-client',
      client_created_at_ms: 1,
      created_by: 'user-1',
      updated_by: 'user-1',
      deleted_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      original_source_path: 'scratchpad/Plan.md',
      shared_name: 'Plan',
      author_initials: 'AF',
      author_callsign: 'afar',
      revision: 1,
    };
    const server = {
      row: { ...currentRow },
      pins: new Set<string>(),
      handlers: {} as Record<string, Array<() => void>>,
      emit(table: string) {
        for (const handler of this.handlers[table] ?? []) handler();
      },
      client() {
        const serverRef = this;
        return {
          channel: () => {
            const channel = {
              on(_event: string, config: { table?: string }, handler: () => void) {
                if (config.table) {
                  serverRef.handlers[config.table] ??= [];
                  serverRef.handlers[config.table].push(handler);
                }
                return channel;
              },
              subscribe: () => channel,
            };
            return channel;
          },
          removeChannel: vi.fn(async () => undefined),
          from(table: string) {
            if (table === 'team_document_pins') {
              return {
                select() {
                  return {
                    async eq() {
                      return {
                        data: [...serverRef.pins].map((document_id) => ({ document_id })),
                        error: null,
                      };
                    },
                  };
                },
                upsert(row: { document_id: string }) {
                  serverRef.pins.add(row.document_id);
                  return { error: null };
                },
              };
            }
            return {
              select() {
                return {
                  eq() {
                    return {
                      is() {
                        return {
                          data: [serverRef.row],
                          error: null,
                          async single() {
                            return { data: serverRef.row, error: null };
                          },
                        };
                      },
                    };
                  },
                };
              },
              update(row: Record<string, unknown>) {
                serverRef.row = { ...serverRef.row, ...row, updated_at: '2026-01-01T00:00:01Z' };
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          is() {
                            return {
                              select() {
                                return {
                                  async single() {
                                    return { data: serverRef.row, error: null };
                                  },
                                };
                              },
                            };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
    const teamService = {
      getTeamState: async () => ({
        available: true,
        currentTeamScopeUserId: 'team-1',
        isOwner: true,
        members: [],
        pendingIncoming: [],
        pendingOutgoing: [],
      }),
    };
    const senderAuth = {
      getSupabaseClient: () => server.client(),
      getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;
    const receiverAuth = {
      getSupabaseClient: () => server.client(),
      getSession: () => ({ user: { id: 'user-2', email: 'js@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;
    const sender = new SharedSyncService(senderAuth, teamService as unknown as SharedTeamService);
    const receiver = new SharedSyncService(receiverAuth, teamService as unknown as SharedTeamService);
    const receiverCacheChanged = vi.fn();
    const receiverPinsChanged = vi.fn();
    receiver.on('cacheChanged', receiverCacheChanged);
    receiver.on('pinsChanged', receiverPinsChanged);

    process.env.FT_LIBRARY_DIR = receiverRoot;
    process.env.FT_SHARED_FILES_CACHE_DIR = receiverRiverRoot;
    process.env.FT_SHARED_FILES_DIR = receiverRiverRoot;
    fs.mkdirSync(receiverRiverRoot, { recursive: true });
    await receiver.syncOnce();
    await receiver.startRemoteChangeSync();
    expect(fs.readFileSync(receiverCachePath, 'utf-8')).toContain('Old body');

    process.env.FT_LIBRARY_DIR = senderRoot;
    process.env.FT_SHARED_FILES_CACHE_DIR = senderRiverRoot;
    process.env.FT_SHARED_FILES_DIR = senderRiverRoot;
    await expect(sender.updateSharedContent('shared-1', 'New body\n', 1, path.join(senderRoot, 'scratchpad', 'Plan.md')))
      .resolves.toMatchObject({ ok: true, revision: 2 });

    process.env.FT_LIBRARY_DIR = receiverRoot;
    process.env.FT_SHARED_FILES_CACHE_DIR = receiverRiverRoot;
    process.env.FT_SHARED_FILES_DIR = receiverRiverRoot;
    server.emit('team_documents');
    await vi.waitFor(() => {
      expect(fs.readFileSync(receiverCachePath, 'utf-8')).toContain('New body');
    });
    expect(receiverCacheChanged).toHaveBeenCalled();

    process.env.FT_LIBRARY_DIR = senderRoot;
    process.env.FT_SHARED_FILES_CACHE_DIR = senderRiverRoot;
    process.env.FT_SHARED_FILES_DIR = senderRiverRoot;
    await expect(sender.setPinned(path.join(senderRiverRoot, 'Plan AF.md'), true)).resolves.toEqual({ ok: true, pinned: true });
    process.env.FT_LIBRARY_DIR = receiverRoot;
    process.env.FT_SHARED_FILES_CACHE_DIR = receiverRiverRoot;
    process.env.FT_SHARED_FILES_DIR = receiverRiverRoot;
    server.emit('team_document_pins');
    expect(receiverPinsChanged).toHaveBeenCalled();
    await expect(receiver.getPinnedSidebarItemIds()).resolves.toEqual(['wiki:River (shared)/Plan AF']);
  });

  it('queues a second River realtime sync when another document event arrives mid-sync', async () => {
    const root = sharedFilesRoot();
    const cachePath = path.join(root, 'Plan AF.md');
    const realtimeHandlers: Record<string, (() => void) | undefined> = {};
    const releases: Array<() => void> = [];
    let queryCount = 0;
    let serverContent = 'Old body\n';
    const channel = {
      on: vi.fn((_event: string, config: { table?: string }, handler: () => void) => {
        if (config.table) realtimeHandlers[config.table] = handler;
        return channel;
      }),
      subscribe: vi.fn(() => channel),
    };
    const supabase = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => undefined),
      from: () => ({
        select() { return this; },
        eq() { return this; },
        async is() {
          queryCount++;
          const contentAtQueryStart = serverContent;
          await new Promise<void>((resolve) => {
            releases.push(resolve);
          });
          return {
            data: [{
              id: 'shared-1',
              team_scope_user_id: 'team-1',
              kind: 'document',
              path: 'Docs/scratchpad/Plan.md',
              title: 'Plan',
              content: contentAtQueryStart,
              content_hash: null,
              client_id: 'shared-client',
              client_created_at_ms: 1,
              created_by: 'user-1',
              updated_by: 'user-1',
              deleted_at: null,
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
              original_source_path: 'scratchpad/Plan.md',
              shared_name: 'Plan',
              author_initials: 'AF',
              author_callsign: 'afar',
              revision: queryCount,
            }],
            error: null,
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
        currentTeamScopeUserId: 'team-1',
        isOwner: true,
        members: [],
        pendingIncoming: [],
        pendingOutgoing: [],
      }),
    };
    const service = new SharedSyncService(authManager, teamService as unknown as SharedTeamService);
    const cacheChanged = vi.fn();
    service.on('cacheChanged', cacheChanged);

    await service.startRemoteChangeSync();
    const handler = realtimeHandlers.team_documents as () => void;
    handler();
    await vi.waitFor(() => expect(releases).toHaveLength(1));

    serverContent = 'New body\n';
    handler();
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();

    await vi.waitFor(() => {
      expect(fs.readFileSync(cachePath, 'utf-8')).toContain('New body');
    });
    expect(cacheChanged).toHaveBeenCalledTimes(2);
  });

  it('maps team River pins to sidebar item ids from the local cache', async () => {
    const root = sharedFilesRoot();
    fs.mkdirSync(root, { recursive: true });
    const pinnedPath = path.join(root, 'Pinned AF.md');
    const markdownPinnedPath = path.join(root, 'Markdown Pin AF.markdown');
    const unpinnedPath = path.join(root, 'Unpinned AF.md');
    fs.writeFileSync(pinnedPath, [
      '---',
      'shared: true',
      'shared_id: "shared-pinned"',
      'shared_type: "document"',
      '---',
      '',
      'Pinned',
    ].join('\n'));
    fs.writeFileSync(markdownPinnedPath, [
      '---',
      'shared: true',
      'shared_id: "shared-markdown-pinned"',
      'shared_type: "document"',
      '---',
      '',
      'Markdown pinned',
    ].join('\n'));
    fs.writeFileSync(unpinnedPath, [
      '---',
      'shared: true',
      'shared_id: "shared-other"',
      'shared_type: "document"',
      '---',
      '',
      'Other',
    ].join('\n'));

    const supabase = {
      from: () => ({
        select() { return this; },
        eq() {
          return { data: [{ document_id: 'shared-pinned' }, { document_id: 'shared-markdown-pinned' }], error: null };
        },
      }),
    };
    const authManager = {
      getSupabaseClient: () => supabase,
      getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;
    const teamService = {
      getTeamState: async () => ({
        available: true,
        currentTeamScopeUserId: 'user-1',
        isOwner: true,
        members: [],
        pendingIncoming: [],
        pendingOutgoing: [],
      }),
    };

    await expect(new SharedSyncService(authManager, teamService as unknown as SharedTeamService).getPinnedSidebarItemIds())
      .resolves.toEqual(['wiki:River (shared)/Markdown Pin AF', 'wiki:River (shared)/Pinned AF']);
  });

  it('pins and unpins a River cache file through shared team state', async () => {
    const root = sharedFilesRoot();
    fs.mkdirSync(root, { recursive: true });
    const cachePath = path.join(root, 'Pinned AF.md');
    fs.writeFileSync(cachePath, [
      '---',
      'shared: true',
      'shared_id: "shared-1"',
      'shared_type: "document"',
      '---',
      '',
      'Pinned',
    ].join('\n'));

    const upserts: Array<Record<string, unknown>> = [];
    const deletes: Array<{ field: string; value: unknown }> = [];
    const supabase = {
      from: () => ({
        upsert(row: Record<string, unknown>) {
          upserts.push(row);
          return { error: null };
        },
        delete() {
          return {
            eq(field: string, value: unknown) {
              deletes.push({ field, value });
              return this;
            },
          };
        },
      }),
    };
    const authManager = {
      getSupabaseClient: () => supabase,
      getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;
    const teamService = {
      getTeamState: async () => ({
        available: true,
        currentTeamScopeUserId: 'scope-1',
        isOwner: true,
        members: [],
        pendingIncoming: [],
        pendingOutgoing: [],
      }),
    };
    const service = new SharedSyncService(authManager, teamService as unknown as SharedTeamService);
    const pinsChanged = vi.fn();
    service.on('pinsChanged', pinsChanged);

    await expect(service.setPinned(cachePath, true)).resolves.toEqual({ ok: true, pinned: true });
    await expect(service.setPinned(cachePath, false)).resolves.toEqual({ ok: true, pinned: false });

    expect(upserts).toEqual([{
      team_scope_user_id: 'scope-1',
      document_id: 'shared-1',
      pinned_by: 'user-1',
    }]);
    expect(deletes).toEqual([
      { field: 'team_scope_user_id', value: 'scope-1' },
      { field: 'document_id', value: 'shared-1' },
    ]);
    expect(pinsChanged).toHaveBeenCalledTimes(2);
  });

  it('fills a missing current-user callsign while syncing cached River rows', async () => {
    const supabase = {
      from(table: string) {
        if (table === 'profiles') {
          return {
            select() { return this; },
            eq() { return this; },
            async maybeSingle() {
              return { data: { callsign: 'afar' }, error: null };
            },
          };
        }
        return {
          select() { return this; },
          eq() { return this; },
          async is() {
            return {
              data: [{
                id: 'shared-1',
                team_scope_user_id: 'user-1',
                kind: 'command',
                path: 'Commands/Commands/brief.md',
                title: 'brief',
                content: 'Body\n',
                content_hash: null,
                client_id: 'shared-client',
                client_created_at_ms: 1,
                created_by: 'user-1',
                updated_by: 'user-1',
                deleted_at: null,
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
                original_source_path: 'Commands/brief.md',
                shared_name: 'brief',
                author_initials: 'AM',
                author_callsign: null,
                revision: 1,
              }],
              error: null,
            };
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
        available: true,
        currentTeamScopeUserId: 'user-1',
        isOwner: true,
        members: [],
        pendingIncoming: [],
        pendingOutgoing: [],
      }),
    };

    await expect(new SharedSyncService(authManager, teamService as unknown as SharedTeamService).syncOnce()).resolves.toEqual({
      written: 1,
      removed: 0,
      created: 1,
      errors: [],
    });

    const cachePath = path.join(sharedFilesRoot(), 'brief AM.md');
    const cachedContent = fs.readFileSync(cachePath, 'utf-8');
    expect(cachedContent).toContain('title: "brief"');
    expect(cachedContent).toContain('shared_author_callsign: "afar"');
    expect(cachedContent).toContain('shared_updated_at: "2026-01-01T00:00:00Z"');
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

  it('blocks pending invitees from sharing before hitting River RLS', async () => {
    const fromCalls: string[] = [];
    const supabase = {
      from(table: string) {
        fromCalls.push(table);
        return {};
      },
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
        members: [{ contactId: 'contact-1', userId: 'owner-1', email: '', role: 'owner', teamScopeUserId: 'owner-1' }],
        pendingIncoming: [{ contactId: 'contact-1', ownerUserId: 'owner-1', contactUserId: 'user-2', email: 'js@example.com', direction: 'incoming' }],
        pendingOutgoing: [],
      }),
    };

    await expect(new SharedSyncService(authManager, teamService as unknown as SharedTeamService).shareFile({
      filePath: path.join(process.env.FT_LIBRARY_DIR ?? tempRoot, 'scratchpad', 'Note.md'),
      title: 'Note',
      content: 'Body\n',
      type: 'document',
    })).resolves.toEqual({
      shared: false,
      error: 'Accept the team invite before sharing to River',
    });
    expect(fromCalls).toEqual([]);
  });

  it('uploads only image assets referenced by the shared file content', async () => {
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
    const sourcePath = path.join(process.env.FT_LIBRARY_DIR ?? tempRoot, 'Commands', 'Note.md');
    const assetsDir = path.join(process.env.FT_LIBRARY_DIR ?? tempRoot, '.assets');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, 'used.png'), Buffer.from([1, 2, 3]));
    fs.writeFileSync(path.join(assetsDir, 'unused.png'), Buffer.from([4, 5, 6]));

    await expect(new SharedSyncService(authManager, teamService as unknown as SharedTeamService).shareFile({
      filePath: sourcePath,
      title: 'Note',
      content: 'Body\n![Used](<../.assets/used.png>)\n',
      type: 'document',
    })).resolves.toMatchObject({ shared: true, sharedId: 'shared-1' });

    expect(upsertedRow).not.toBeNull();
    const sharedContent = String((upsertedRow as unknown as Record<string, unknown>).content ?? '');
    expect(sharedContent).toContain('data:image/png;base64,AQID');
    expect(sharedContent).not.toContain('BAUG');
    expect(sharedContent).not.toContain('unused.png');
  });

  it('uploads only newly referenced image assets when updating shared content', async () => {
    let updatedRow: Record<string, unknown> | null = null;
    const currentRow = {
      id: 'shared-1',
      team_scope_user_id: 'owner-1',
      kind: 'document',
      path: 'Commands/Note.md',
      title: 'Note',
      content: 'Old body\n',
      content_hash: null,
      client_id: 'shared-client',
      client_created_at_ms: 1,
      created_by: 'user-2',
      updated_by: 'user-2',
      deleted_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      original_source_path: 'Commands/Note.md',
      shared_name: 'Note',
      author_initials: 'JS',
      author_callsign: null,
      revision: 1,
    };
    const supabase = {
      from: () => ({
        select() {
          return {
            eq() {
              return {
                is() {
                  return {
                    async single() {
                      return { data: currentRow, error: null };
                    },
                  };
                },
              };
            },
          };
        },
        update(row: Record<string, unknown>) {
          updatedRow = row;
          return {
            eq() {
              return {
                eq() {
                  return {
                    is() {
                      return {
                        select() {
                          return {
                            async single() {
                              return { data: { ...currentRow, ...row }, error: null };
                            },
                          };
                        },
                      };
                    },
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
    const documentPath = path.join(process.env.FT_LIBRARY_DIR ?? tempRoot, 'Commands', 'Note.md');
    const assetsDir = path.join(process.env.FT_LIBRARY_DIR ?? tempRoot, '.assets');
    fs.mkdirSync(path.dirname(documentPath), { recursive: true });
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, 'new.png'), Buffer.from([7, 8, 9]));
    fs.writeFileSync(path.join(assetsDir, 'old-unused.png'), Buffer.from([1, 1, 1]));

    await expect(new SharedSyncService(authManager).updateSharedContent(
      'shared-1',
      'Updated\n![New](<../.assets/new.png>)\n',
      1,
      documentPath,
    )).resolves.toMatchObject({ ok: true, revision: 2 });

    expect(updatedRow).not.toBeNull();
    const uploadedContent = String((updatedRow as unknown as Record<string, unknown>).content ?? '');
    expect(uploadedContent).toContain('data:image/png;base64,BwgJ');
    expect(uploadedContent).not.toContain('AQEB');
    expect(uploadedContent).not.toContain('old-unused.png');
  });

  it('uses the full profile callsign when sharing a file', async () => {
    let upsertedRow: Record<string, unknown> | null = null;
    const supabase = {
      from(table: string) {
        if (table === 'profiles') {
          return {
            select() { return this; },
            eq() { return this; },
            async maybeSingle() {
              return { data: { callsign: 'afar' }, error: null };
            },
          };
        }
        return {
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
        };
      },
    };
    const authManager = {
      getSupabaseClient: () => supabase,
      getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;
    const teamService = {
      getTeamState: async () => ({
        available: true,
        currentTeamScopeUserId: 'user-1',
        isOwner: true,
        members: [],
        pendingIncoming: [],
        pendingOutgoing: [],
      }),
    };

    const status = await new SharedSyncService(authManager, teamService as unknown as SharedTeamService).shareFile({
      filePath: path.join(process.env.FT_LIBRARY_DIR ?? tempRoot, 'scratchpad', 'Note.md'),
      title: 'Note',
      content: 'Body\n',
      type: 'document',
    });

    expect(status.shared).toBe(true);
    expect(upsertedRow).toMatchObject({ author_callsign: 'afar' });
    const cachedContent = fs.readFileSync(status.cachePath ?? '', 'utf-8');
    expect(cachedContent).toContain('title: "Note"');
    expect(cachedContent).toContain('shared_author_callsign: "afar"');
  });

  it('returns the database error when sharing is blocked', async () => {
    const supabase = {
      from: () => ({
        upsert() {
          return {
            select() {
              return {
                async single() {
                  return {
                    data: null,
                    error: { message: 'new row violates row-level security policy for table "team_documents"' },
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
      getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;
    const teamService = {
      getTeamState: async () => ({
        available: true,
        currentTeamScopeUserId: 'user-1',
        isOwner: true,
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
    })).resolves.toEqual({
      shared: false,
      error: 'new row violates row-level security policy for table "team_documents"',
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

  it('does not throw when presence subscribe fails before the socket connects', async () => {
    const channel = {
      on: vi.fn(() => channel),
      subscribe: vi.fn(() => {
        throw new Error('WebSocket was closed before the connection was established');
      }),
      presenceState: vi.fn(() => ({})),
    };
    const supabase = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(() => {
        throw new Error('WebSocket was closed before the connection was established');
      }),
    };
    const authManager = {
      getSupabaseClient: () => supabase,
      getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;

    await expect(new SharedSyncService(authManager).setActivePresence('shared-1')).resolves.toEqual([]);
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('does not reject when presence track fails after subscribe', async () => {
    let subscribeCallback: ((status: string, err?: unknown) => void) | null = null;
    const channel = {
      on: vi.fn(() => channel),
      subscribe: vi.fn((callback: (status: string, err?: unknown) => void) => {
        subscribeCallback = callback;
        return channel;
      }),
      track: vi.fn(async () => {
        throw new Error('offline');
      }),
      presenceState: vi.fn(() => ({})),
      untrack: vi.fn(async () => undefined),
    };
    const supabase = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => undefined),
    };
    const authManager = {
      getSupabaseClient: () => supabase,
      getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
    } as unknown as AuthManager;

    const service = new SharedSyncService(authManager);
    await expect(service.setActivePresence('shared-1')).resolves.toEqual([]);
    expect(subscribeCallback).toEqual(expect.any(Function));
    expect(() => subscribeCallback?.('SUBSCRIBED')).not.toThrow();
    await Promise.resolve();
    expect(channel.track).toHaveBeenCalled();
  });
});
