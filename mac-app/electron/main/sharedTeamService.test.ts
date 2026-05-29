import { describe, expect, it, vi } from 'vitest';
import type { AuthManager } from './authManager';
import { SharedTeamService } from './sharedTeamService';

interface MockContactRow {
  id: string;
  owner_user_id: string;
  contact_email: string | null;
  contact_user_id?: string | null;
  relationship_type: string | null;
  status: string | null;
  created_at?: string | null;
}

interface MockSupabaseOptions {
  contacts?: MockContactRow[];
  profileUserId?: string | null;
  existingOwnedContact?: Pick<MockContactRow, 'id' | 'relationship_type' | 'status'> | null;
  mutationReturnsNoRows?: boolean;
  missingContactUserId?: boolean;
  error?: { message: string } | null;
}

function makeAuthManager(options: MockSupabaseOptions = {}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const contacts = options.contacts ?? [];
  const missingContactUserIdError = { message: 'column contacts.contact_user_id does not exist' };

  function record(table: string, method: string, args: unknown[]) {
    calls.push({ table, method, args });
  }

  function hasContactUserId(value: unknown): boolean {
    return JSON.stringify(value).includes('contact_user_id');
  }

  function makeMutationQuery(table: string, startsWithContactUserId = false) {
    let usesContactUserId = startsWithContactUserId;

    function currentError() {
      if (options.missingContactUserId && table === 'contacts' && usesContactUserId) {
        return missingContactUserIdError;
      }
      return options.error ?? null;
    }

    return {
      error: currentError(),
      select(...args: unknown[]) { record(table, 'select', args); usesContactUserId ||= hasContactUserId(args); return this; },
      eq(...args: unknown[]) { record(table, 'eq', args); return this; },
      or(...args: unknown[]) { record(table, 'or', args); usesContactUserId ||= hasContactUserId(args); return this; },
      ilike(...args: unknown[]) { record(table, 'ilike', args); return this; },
      maybeSingle: vi.fn(async () => ({
        data: table === 'profiles'
          ? (options.profileUserId ? { id: options.profileUserId } : null)
          : (options.mutationReturnsNoRows ? null : { id: 'contact-1' }),
        error: currentError(),
      })),
      single: vi.fn(async () => ({ data: null, error: currentError() })),
    };
  }

  const supabase = {
    from(table: string) {
      record(table, 'from', []);
      if (table === 'contacts') {
        let usesContactUserId = false;

        function currentError() {
          if (options.missingContactUserId && usesContactUserId) {
            return missingContactUserIdError;
          }
          return options.error ?? null;
        }

        return {
          error: currentError(),
          select(...args: unknown[]) { record(table, 'select', args); usesContactUserId ||= hasContactUserId(args); return this; },
          eq(...args: unknown[]) { record(table, 'eq', args); return this; },
          or(...args: unknown[]) { record(table, 'or', args); usesContactUserId ||= hasContactUserId(args); return this; },
          ilike(...args: unknown[]) { record(table, 'ilike', args); return this; },
          maybeSingle: vi.fn(async () => ({ data: options.existingOwnedContact ?? null, error: currentError() })),
          order: vi.fn(async (...args: unknown[]) => {
            record(table, 'order', args);
            return { data: contacts, error: currentError() };
          }),
          insert: vi.fn((payload: unknown) => {
            record(table, 'insert', [payload]);
            return { error: options.missingContactUserId && hasContactUserId(payload) ? missingContactUserIdError : options.error ?? null };
          }),
          update: vi.fn((payload: unknown) => {
            record(table, 'update', [payload]);
            return makeMutationQuery(table, hasContactUserId(payload));
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

  it('lets owners populate River while the first team invite is pending', async () => {
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

    expect(state.available).toBe(true);
    expect(state.currentTeamScopeUserId).toBe('user-1');
    expect(state.isOwner).toBe(true);
    expect(state.reason).toBeUndefined();
    expect(state.pendingOutgoing).toEqual([{
      contactId: 'contact-1',
      ownerUserId: 'user-1',
      contactUserId: 'user-2',
      email: 'jamie@example.com',
      direction: 'outgoing',
      createdAt: '2026-01-01T00:00:00Z',
    }]);
  });

  it('falls back to email lookups when the contacts table lacks contact_user_id', async () => {
    const { authManager, calls } = makeAuthManager({
      missingContactUserId: true,
      contacts: [{
        id: 'contact-1',
        owner_user_id: 'owner-1',
        contact_email: 'af@example.com',
        relationship_type: 'team',
        status: 'pending',
      }],
    });

    const state = await new SharedTeamService(authManager).getTeamState();

    expect(state.available).toBe(true);
    expect(state.currentTeamScopeUserId).toBe('owner-1');
    expect(calls).toContainEqual({
      table: 'contacts',
      method: 'or',
      args: ['owner_user_id.eq.user-1,contact_user_id.eq.user-1,contact_email.ilike.af@example.com'],
    });
    expect(calls).toContainEqual({
      table: 'contacts',
      method: 'or',
      args: ['owner_user_id.eq.user-1,contact_email.ilike.af@example.com'],
    });
  });

  it('lets pending invitees read River from the owner team scope', async () => {
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

    expect(state.available).toBe(true);
    expect(state.currentTeamScopeUserId).toBe('owner-1');
    expect(state.isOwner).toBe(false);
    expect(state.reason).toBeUndefined();
    expect(state.members).toEqual([{
      contactId: 'contact-1',
      userId: 'owner-1',
      email: '',
      role: 'owner',
      teamScopeUserId: 'owner-1',
    }]);
    expect(state.pendingIncoming[0]).toMatchObject({
      contactId: 'contact-1',
      ownerUserId: 'owner-1',
      direction: 'incoming',
    });
  });

  it('returns an explicit unsupported state for multiple pending incoming team scopes', async () => {
    const { authManager } = makeAuthManager({
      contacts: [
        {
          id: 'contact-1',
          owner_user_id: 'owner-1',
          contact_email: 'af@example.com',
          contact_user_id: null,
          relationship_type: 'team',
          status: 'pending',
        },
        {
          id: 'contact-2',
          owner_user_id: 'owner-2',
          contact_email: 'af@example.com',
          contact_user_id: null,
          relationship_type: 'team',
          status: 'pending',
        },
      ],
    });

    const state = await new SharedTeamService(authManager).getTeamState();

    expect(state.available).toBe(false);
    expect(state.currentTeamScopeUserId).toBeNull();
    expect(state.reason).toBe('ambiguous_team_scope');
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

  it('keeps team invite creation dependent on contact_user_id when the invited user exists', async () => {
    const { authManager, calls } = makeAuthManager({
      missingContactUserId: true,
      profileUserId: 'user-2',
    });

    await expect(new SharedTeamService(authManager).inviteMember('jamie@example.com')).resolves.toEqual({
      ok: false,
      error: 'column contacts.contact_user_id does not exist',
    });

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
    expect(calls.filter((call) => call.table === 'contacts' && call.method === 'insert')).toHaveLength(1);
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
    expect(calls).toContainEqual({ table: 'contacts', method: 'select', args: ['id'] });
  });

  it('accepts incoming team invites by email on older contacts schemas', async () => {
    const { authManager, calls } = makeAuthManager({ missingContactUserId: true });

    await expect(new SharedTeamService(authManager).respondToInvite('contact-1', true)).resolves.toEqual({ ok: true });

    expect(calls).toContainEqual({
      table: 'contacts',
      method: 'update',
      args: [{ status: 'accepted', contact_user_id: 'user-1' }],
    });
    expect(calls).toContainEqual({
      table: 'contacts',
      method: 'update',
      args: [{ status: 'accepted' }],
    });
    expect(calls).toContainEqual({
      table: 'contacts',
      method: 'or',
      args: ['contact_email.ilike.af@example.com'],
    });
  });

  it('returns an error when accepting an invite updates no rows', async () => {
    const { authManager } = makeAuthManager({ mutationReturnsNoRows: true });

    await expect(new SharedTeamService(authManager).respondToInvite('contact-1', true)).resolves.toEqual({
      ok: false,
      error: 'Invite response failed because no invite row was updated',
    });
  });

  it('declines an incoming team invite as the invited user', async () => {
    const { authManager, calls } = makeAuthManager();

    await expect(new SharedTeamService(authManager).respondToInvite('contact-1', false)).resolves.toEqual({ ok: true });

    expect(calls).toContainEqual({ table: 'contacts', method: 'delete', args: [] });
    expect(calls).toContainEqual({ table: 'contacts', method: 'eq', args: ['id', 'contact-1'] });
    expect(calls).toContainEqual({ table: 'contacts', method: 'eq', args: ['relationship_type', 'team'] });
  });

  it('declines incoming team invites by email on older contacts schemas', async () => {
    const { authManager, calls } = makeAuthManager({ missingContactUserId: true });

    await expect(new SharedTeamService(authManager).respondToInvite('contact-1', false)).resolves.toEqual({ ok: true });

    expect(calls).toContainEqual({ table: 'contacts', method: 'delete', args: [] });
    expect(calls).toContainEqual({
      table: 'contacts',
      method: 'or',
      args: ['contact_user_id.eq.user-1,contact_email.ilike.af@example.com'],
    });
    expect(calls).toContainEqual({
      table: 'contacts',
      method: 'or',
      args: ['contact_email.ilike.af@example.com'],
    });
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

  it('lets a member leave accepted teams by email on older contacts schemas', async () => {
    const { authManager, calls } = makeAuthManager({ missingContactUserId: true });

    await expect(new SharedTeamService(authManager).leaveTeam()).resolves.toEqual({ ok: true });

    expect(calls).toContainEqual({
      table: 'contacts',
      method: 'or',
      args: ['contact_user_id.eq.user-1,contact_email.ilike.af@example.com'],
    });
    expect(calls).toContainEqual({
      table: 'contacts',
      method: 'or',
      args: ['contact_email.ilike.af@example.com'],
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
