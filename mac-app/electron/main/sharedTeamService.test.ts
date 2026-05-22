import { describe, expect, it, vi } from 'vitest';
import type { AuthManager } from './authManager';
import { SharedTeamService } from './sharedTeamService';

interface MockContactRow {
  id: string;
  owner_user_id: string;
  contact_email: string | null;
  contact_user_id: string | null;
  relationship_type: string | null;
  status: string | null;
  created_at?: string | null;
}

interface MockSupabaseOptions {
  contacts?: MockContactRow[];
  profileUserId?: string | null;
  existingOwnedContact?: Pick<MockContactRow, 'id' | 'relationship_type' | 'status'> | null;
  error?: { message: string } | null;
}

function makeAuthManager(options: MockSupabaseOptions = {}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const contacts = options.contacts ?? [];

  function record(table: string, method: string, args: unknown[]) {
    calls.push({ table, method, args });
  }

  function makeMutationQuery(table: string) {
    return {
      error: options.error ?? null,
      select(...args: unknown[]) { record(table, 'select', args); return this; },
      eq(...args: unknown[]) { record(table, 'eq', args); return this; },
      or(...args: unknown[]) { record(table, 'or', args); return this; },
      ilike(...args: unknown[]) { record(table, 'ilike', args); return this; },
      maybeSingle: vi.fn(async () => ({ data: options.profileUserId ? { id: options.profileUserId } : null, error: null })),
      single: vi.fn(async () => ({ data: null, error: options.error ?? null })),
    };
  }

  const supabase = {
    from(table: string) {
      record(table, 'from', []);
      if (table === 'contacts') {
        return {
          error: options.error ?? null,
          select(...args: unknown[]) { record(table, 'select', args); return this; },
          eq(...args: unknown[]) { record(table, 'eq', args); return this; },
          or(...args: unknown[]) { record(table, 'or', args); return this; },
          ilike(...args: unknown[]) { record(table, 'ilike', args); return this; },
          maybeSingle: vi.fn(async () => ({ data: options.existingOwnedContact ?? null, error: options.error ?? null })),
          order: vi.fn(async (...args: unknown[]) => {
            record(table, 'order', args);
            return { data: contacts, error: options.error ?? null };
          }),
          insert: vi.fn((payload: unknown) => {
            record(table, 'insert', [payload]);
            return { error: options.error ?? null };
          }),
          update: vi.fn((payload: unknown) => {
            record(table, 'update', [payload]);
            return makeMutationQuery(table);
          }),
          delete: vi.fn(() => {
            record(table, 'delete', []);
            return makeMutationQuery(table);
          }),
        };
      }
      if (table === 'profiles') {
        return makeMutationQuery(table);
      }
      return makeMutationQuery(table);
    },
  };

  const authManager = {
    getSupabaseClient: () => supabase,
    getSession: () => ({ user: { id: 'user-1', email: 'af@example.com', user_metadata: {} } }),
  } as unknown as AuthManager;

  return { authManager, calls };
}

describe('SharedTeamService', () => {
  it('returns unavailable for a solo user', async () => {
    const { authManager } = makeAuthManager({ contacts: [] });

    await expect(new SharedTeamService(authManager).getTeamState()).resolves.toMatchObject({
      available: false,
      currentTeamScopeUserId: null,
      reason: 'no_team_members',
    });
  });

  it('keeps pending outgoing invites separate from team availability', async () => {
    const { authManager } = makeAuthManager({
      contacts: [{
        id: 'contact-1',
        owner_user_id: 'user-1',
        contact_email: 'jamie@example.com',
        contact_user_id: 'user-2',
        relationship_type: 'team',
        status: 'pending',
        created_at: '2026-01-01T00:00:00Z',
      }],
    });

    const state = await new SharedTeamService(authManager).getTeamState();

    expect(state.available).toBe(false);
    expect(state.currentTeamScopeUserId).toBeNull();
    expect(state.reason).toBe('pending_only');
    expect(state.pendingOutgoing).toEqual([{
      contactId: 'contact-1',
      ownerUserId: 'user-1',
      contactUserId: 'user-2',
      email: 'jamie@example.com',
      direction: 'outgoing',
      createdAt: '2026-01-01T00:00:00Z',
    }]);
  });

  it('keeps pending incoming invites separate from team availability', async () => {
    const { authManager } = makeAuthManager({
      contacts: [{
        id: 'contact-1',
        owner_user_id: 'owner-1',
        contact_email: 'af@example.com',
        contact_user_id: null,
        relationship_type: 'team',
        status: 'pending',
      }],
    });

    const state = await new SharedTeamService(authManager).getTeamState();

    expect(state.available).toBe(false);
    expect(state.reason).toBe('pending_only');
    expect(state.pendingIncoming[0]).toMatchObject({
      contactId: 'contact-1',
      ownerUserId: 'owner-1',
      direction: 'incoming',
    });
  });

  it('resolves the owner user as team scope after an accepted owned contact exists', async () => {
    const { authManager } = makeAuthManager({
      contacts: [{
        id: 'contact-1',
        owner_user_id: 'user-1',
        contact_email: 'jamie@example.com',
        contact_user_id: 'user-2',
        relationship_type: 'team',
        status: 'accepted',
      }],
    });

    const state = await new SharedTeamService(authManager).getTeamState();

    expect(state.available).toBe(true);
    expect(state.currentTeamScopeUserId).toBe('user-1');
    expect(state.isOwner).toBe(true);
    expect(state.members).toEqual([{
      contactId: 'contact-1',
      userId: 'user-2',
      email: 'jamie@example.com',
      role: 'member',
      teamScopeUserId: 'user-1',
    }]);
  });

  it('resolves an accepted invite member to the owner team scope', async () => {
    const { authManager } = makeAuthManager({
      contacts: [{
        id: 'contact-1',
        owner_user_id: 'owner-1',
        contact_email: 'af@example.com',
        contact_user_id: 'user-1',
        relationship_type: 'team',
        status: 'accepted',
      }],
    });

    const state = await new SharedTeamService(authManager).getTeamState();

    expect(state.available).toBe(true);
    expect(state.currentTeamScopeUserId).toBe('owner-1');
    expect(state.isOwner).toBe(false);
    expect(state.members).toEqual([{
      contactId: 'contact-1',
      userId: 'owner-1',
      email: '',
      role: 'owner',
      teamScopeUserId: 'owner-1',
    }]);
  });

  it('creates team invites as pending team contacts', async () => {
    const { authManager, calls } = makeAuthManager({ profileUserId: 'user-2' });

    await expect(new SharedTeamService(authManager).inviteMember(' Jamie@Example.com ')).resolves.toEqual({ ok: true });

    expect(calls).toContainEqual({ table: 'profiles', method: 'ilike', args: ['email', 'jamie@example.com'] });
    expect(calls).toContainEqual({ table: 'contacts', method: 'ilike', args: ['contact_email', 'jamie@example.com'] });
    expect(calls).toContainEqual({
      table: 'contacts',
      method: 'insert',
      args: [{
        owner_user_id: 'user-1',
        contact_email: 'jamie@example.com',
        contact_user_id: 'user-2',
        relationship_type: 'team',
        status: 'pending',
      }],
    });
  });

  it('treats an existing team contact as an already-created invite', async () => {
    const { authManager, calls } = makeAuthManager({
      existingOwnedContact: {
        id: 'contact-1',
        relationship_type: 'team',
        status: 'pending',
      },
    });

    await expect(new SharedTeamService(authManager).inviteMember('jamie@example.com')).resolves.toEqual({
      ok: true,
      alreadyExists: true,
    });
    expect(calls.some((call) => call.table === 'contacts' && call.method === 'insert')).toBe(false);
  });

  it('promotes an existing non-team contact to a pending team invite', async () => {
    const { authManager, calls } = makeAuthManager({
      profileUserId: 'user-2',
      existingOwnedContact: {
        id: 'contact-1',
        relationship_type: 'friend',
        status: 'accepted',
      },
    });

    await expect(new SharedTeamService(authManager).inviteMember('jamie@example.com')).resolves.toEqual({ ok: true });

    expect(calls).toContainEqual({
      table: 'contacts',
      method: 'update',
      args: [{
        contact_user_id: 'user-2',
        relationship_type: 'team',
        status: 'pending',
      }],
    });
    expect(calls).toContainEqual({ table: 'contacts', method: 'eq', args: ['id', 'contact-1'] });
    expect(calls).toContainEqual({ table: 'contacts', method: 'eq', args: ['owner_user_id', 'user-1'] });
  });

  it('accepts an incoming team invite as the invited user', async () => {
    const { authManager, calls } = makeAuthManager();

    await expect(new SharedTeamService(authManager).respondToInvite('contact-1', true)).resolves.toEqual({ ok: true });

    expect(calls).toContainEqual({
      table: 'contacts',
      method: 'update',
      args: [{ status: 'accepted', contact_user_id: 'user-1' }],
    });
    expect(calls).toContainEqual({ table: 'contacts', method: 'eq', args: ['id', 'contact-1'] });
    expect(calls).toContainEqual({ table: 'contacts', method: 'eq', args: ['relationship_type', 'team'] });
    expect(calls).toContainEqual({ table: 'contacts', method: 'eq', args: ['status', 'pending'] });
  });

  it('declines an incoming team invite as the invited user', async () => {
    const { authManager, calls } = makeAuthManager();

    await expect(new SharedTeamService(authManager).respondToInvite('contact-1', false)).resolves.toEqual({ ok: true });

    expect(calls).toContainEqual({ table: 'contacts', method: 'delete', args: [] });
    expect(calls).toContainEqual({ table: 'contacts', method: 'eq', args: ['id', 'contact-1'] });
    expect(calls).toContainEqual({ table: 'contacts', method: 'eq', args: ['relationship_type', 'team'] });
  });

  it('lets the owner remove a team member by contact id', async () => {
    const { authManager, calls } = makeAuthManager();

    await expect(new SharedTeamService(authManager).removeMember('contact-1')).resolves.toEqual({ ok: true });

    expect(calls).toContainEqual({ table: 'contacts', method: 'delete', args: [] });
    expect(calls).toContainEqual({ table: 'contacts', method: 'eq', args: ['id', 'contact-1'] });
    expect(calls).toContainEqual({ table: 'contacts', method: 'eq', args: ['relationship_type', 'team'] });
    expect(calls).toContainEqual({ table: 'contacts', method: 'eq', args: ['owner_user_id', 'user-1'] });
  });

  it('lets a member leave accepted teams that target them', async () => {
    const { authManager, calls } = makeAuthManager();

    await expect(new SharedTeamService(authManager).leaveTeam()).resolves.toEqual({ ok: true });

    expect(calls).toContainEqual({ table: 'contacts', method: 'delete', args: [] });
    expect(calls).toContainEqual({ table: 'contacts', method: 'eq', args: ['relationship_type', 'team'] });
    expect(calls).toContainEqual({ table: 'contacts', method: 'eq', args: ['status', 'accepted'] });
    expect(calls).toContainEqual({
      table: 'contacts',
      method: 'or',
      args: ['contact_user_id.eq.user-1,contact_email.ilike.af@example.com'],
    });
  });

  it('returns an explicit unsupported state for multiple accepted owner scopes', async () => {
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

    const state = await new SharedTeamService(authManager).getTeamState();

    expect(state.available).toBe(false);
    expect(state.currentTeamScopeUserId).toBeNull();
    expect(state.reason).toBe('ambiguous_team_scope');
  });
});
