import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthManager } from './authManager';
import { RiverTargetService } from './riverTargetService';

interface MockOptions {
  contacts?: unknown[];
  groups?: unknown[];
  defaults?: unknown[];
  preferences?: unknown[];
  betaEnabled?: boolean;
}

function makeAuthManager(options: MockOptions = {}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];

  function dataFor(table: string) {
    if (table === 'contacts') return options.contacts ?? [];
    if (table === 'river_share_groups') return options.groups ?? [];
    if (table === 'river_default_destinations') return options.defaults ?? [];
    if (table === 'river_source_preferences') return options.preferences ?? [];
    return [];
  }

  function makeSelectQuery(table: string) {
    const query = {
      select(...args: unknown[]) { calls.push({ table, method: 'select', args }); return query; },
      eq(...args: unknown[]) { calls.push({ table, method: 'eq', args }); return query; },
      or(...args: unknown[]) { calls.push({ table, method: 'or', args }); return query; },
      is(...args: unknown[]) { calls.push({ table, method: 'is', args }); return query; },
      maybeSingle: async () => ({ data: { enabled: options.betaEnabled !== false }, error: null }),
      order: async (...args: unknown[]) => {
        calls.push({ table, method: 'order', args });
        return { data: dataFor(table), error: null };
      },
    };
    return query;
  }

  const supabase = {
    rpc: async () => ({ data: true, error: null }),
    from(table: string) {
      calls.push({ table, method: 'from', args: [] });
      return {
        ...makeSelectQuery(table),
        delete: () => ({
          eq: async (...args: unknown[]) => {
            calls.push({ table, method: 'delete.eq', args });
            return { error: null };
          },
        }),
        insert: async (...args: unknown[]) => {
          calls.push({ table, method: 'insert', args });
          return { error: null };
        },
        upsert: async (...args: unknown[]) => {
          calls.push({ table, method: 'upsert', args });
          return { error: null };
        },
      };
    },
  };

  const authManager = {
    getSupabaseClient: () => supabase,
    getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
  } as unknown as AuthManager;

  return { authManager, calls };
}

describe('RiverTargetService', () => {
  let tempRoot: string;
  let originalCachePath: string | undefined;
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'river-targets-test-'));
    originalCachePath = process.env.FT_SHARED_TEAM_ENTITLEMENT_CACHE_PATH;
    process.env.FT_SHARED_TEAM_ENTITLEMENT_CACHE_PATH = path.join(tempRoot, 'entitlement.json');
  });
  afterEach(() => {
    if (originalCachePath === undefined) delete process.env.FT_SHARED_TEAM_ENTITLEMENT_CACHE_PATH;
    else process.env.FT_SHARED_TEAM_ENTITLEMENT_CACHE_PATH = originalCachePath;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  it('lists accepted, pending, legacy team, and public targets with defaults separate', async () => {
    const { authManager } = makeAuthManager({
      contacts: [
        {
          id: 'contact-1',
          owner_user_id: 'user-1',
          contact_email: 'jamie@example.com',
          contact_user_id: 'user-2',
          relationship_type: 'team',
          status: 'accepted',
        },
        {
          id: 'contact-2',
          owner_user_id: 'user-1',
          contact_email: 'casey@example.com',
          contact_user_id: 'user-3',
          relationship_type: 'team',
          status: 'pending',
        },
      ],
      defaults: [{ target_kind: 'group', target_id: 'user-1', position: 0 }],
    });

    const targets = await new RiverTargetService(authManager).listTargets();

    expect(targets).toMatchObject([
      {
        id: 'group:user-1',
        kind: 'group',
        label: 'My Team',
        status: 'accepted',
        committable: true,
        isDefault: true,
        recipientUserIds: ['user-2'],
      },
      {
        id: 'person:user-2',
        kind: 'person',
        label: 'jamie@example.com',
        status: 'accepted',
        committable: true,
        recipientUserIds: ['user-2'],
      },
      {
        id: 'person:user-3',
        kind: 'person',
        label: 'casey@example.com',
        status: 'pending',
        committable: false,
        recipientUserIds: [],
      },
      {
        id: 'public:public',
        kind: 'public',
        label: 'Public River',
        status: 'accepted',
        committable: true,
      },
    ]);
  });

  it('does not collapse multiple accepted incoming teams into an ambiguous state', async () => {
    const { authManager } = makeAuthManager({
      contacts: [
        {
          id: 'contact-1',
          owner_user_id: 'owner-1',
          contact_email: 'af@example.com',
          contact_user_id: 'user-1',
          relationship_type: 'team',
          status: 'accepted',
        },
        {
          id: 'contact-2',
          owner_user_id: 'owner-2',
          contact_email: 'af@example.com',
          contact_user_id: 'user-1',
          relationship_type: 'team',
          status: 'accepted',
        },
      ],
    });

    const targets = await new RiverTargetService(authManager).listTargets();

    expect(targets.map((target) => target.id)).toEqual([
      'person:owner-1',
      'person:owner-2',
      'public:public',
    ]);
    expect(targets.every((target) => target.id !== 'ambiguous_team_scope')).toBe(true);
  });

  it('lists multiple joined groups, includes the owner as a recipient, and deduplicates migrated legacy teams', async () => {
    const { authManager } = makeAuthManager({
      betaEnabled: false,
      contacts: [{ id: 'c', owner_user_id: 'user-1', contact_user_id: 'user-2', contact_email: 'member@example.com', status: 'accepted' }],
      groups: [
        { id: 'group-1', owner_user_id: 'user-1', legacy_owner_user_id: 'user-1', name: 'Design', river_share_group_members: [{ member_user_id: 'user-2', status: 'accepted' }] },
        { id: 'group-2', owner_user_id: 'owner-2', name: 'Research', river_share_group_members: [{ member_user_id: 'user-1', status: 'accepted' }, { member_user_id: 'pending', status: 'pending' }] },
      ],
    });
    const service = new RiverTargetService(authManager);
    const targets = await service.listTargets();
    expect(targets.map((target) => target.id)).toEqual(['group:group-1', 'group:group-2', 'person:user-2']);
    expect(targets[1]).toMatchObject({ committable: true, recipientUserIds: ['owner-2'], memberCount: 2 });
    await expect(service.resolveShareTargets([{ kind: 'public', id: 'public:public' }]))
      .resolves.toMatchObject({ targets: [], recipients: [], error: 'Choose an approved River destination' });
  });

  it('lets an owner post to a new team before anyone accepts an invitation', async () => {
    const { authManager } = makeAuthManager({ betaEnabled: false, groups: [{ id: 'new', owner_user_id: 'user-1', name: 'New team', river_share_group_members: [] }] });
    expect(await new RiverTargetService(authManager).listTargets()).toMatchObject([
      { id: 'group:new', committable: true, memberCount: 1, recipientUserIds: [] },
    ]);
  });

  it('drops stale defaults that do not match a current target', async () => {
    const { authManager } = makeAuthManager({
      contacts: [{
        id: 'contact-1',
        owner_user_id: 'user-1',
        contact_email: 'jamie@example.com',
        contact_user_id: 'user-2',
        relationship_type: 'team',
        status: 'accepted',
      }],
      defaults: [{ target_kind: 'person', target_id: 'missing-user', position: 0 }],
    });

    const targets = await new RiverTargetService(authManager).listTargets();

    expect(targets.some((target) => target.isDefault)).toBe(false);
  });

  it('persists default destinations as user-scoped rows', async () => {
    const { authManager, calls } = makeAuthManager();

    await expect(new RiverTargetService(authManager).setDefaultDestinations([
      { kind: 'group', targetId: 'group-1' },
      { kind: 'person', targetId: 'user-2', position: 5 },
    ])).resolves.toEqual({ ok: true });

    expect(calls).toContainEqual({
      table: 'river_default_destinations',
      method: 'delete.eq',
      args: ['user_id', 'user-1'],
    });
    expect(calls).toContainEqual({
      table: 'river_default_destinations',
      method: 'insert',
      args: [[
        { user_id: 'user-1', target_kind: 'group', target_id: 'group-1', position: 0 },
        { user_id: 'user-1', target_kind: 'person', target_id: 'user-2', position: 5 },
      ]],
    });
  });
});
