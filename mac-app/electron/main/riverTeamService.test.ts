import { describe, expect, it, vi } from 'vitest';
import type { AuthManager } from './authManager';
import { RiverTeamService } from './riverTeamService';

const TEAM = '11111111-1111-4111-8111-111111111111';
const INVITE = '22222222-2222-4222-8222-222222222222';

function fixture(data: unknown = { ok: true }) {
  let session: { user: { id: string }; access_token: string } | null = { user: { id: 'user' }, access_token: 'token' };
  const rpc = vi.fn(async () => ({ data, error: null as { message: string } | null }));
  const events: Array<{ table: string; changed: () => void }> = [];
  let subscribed: (status: string) => void = () => {};
  const channel = {
    on: vi.fn((_type: string, filter: { table: string }, changed: () => void) => { events.push({ table: filter.table, changed }); return channel; }),
    subscribe: vi.fn((callback: (status: string) => void) => { subscribed = callback; return channel; }),
  };
  const supabase = { rpc, channel: vi.fn(() => channel), removeChannel: vi.fn(async () => 'ok') };
  const auth = { getSupabaseClient: () => supabase, getSession: () => session } as unknown as AuthManager;
  return { service: new RiverTeamService(auth), rpc, events, supabase, subscribed: (status: string) => subscribed(status), setSession: (next: typeof session) => { session = next; } };
}

describe('RiverTeamService', () => {
  it('lists several teams and incoming invitations through the authenticated RPC', async () => {
    const state = { teams: [{ id: TEAM, name: 'Design', role: 'owner', members: [], pendingInvites: [] }, { id: INVITE, name: 'Research', role: 'member', members: [], pendingInvites: [] }], incomingInvites: [] };
    const { service, rpc } = fixture(state);
    await expect(service.listTeams()).resolves.toEqual(state);
    expect(rpc).toHaveBeenCalledWith('river_team_state');
  });

  it('normalizes names and invitation emails, including people without accounts', async () => {
    const { service, rpc } = fixture();
    await expect(service.mutateTeam({ kind: 'create', name: '  Design  ' })).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith('river_team_mutate', { action: { kind: 'create', name: 'Design' } });
    await expect(service.mutateTeam({ kind: 'invite', teamId: TEAM, email: ' New.Member@Example.COM ' })).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith('river_team_mutate', { action: { kind: 'invite', teamId: TEAM, email: 'new.member@example.com' } });
  });

  it('rejects malformed actions before a request and preserves explicit invite acceptance', async () => {
    const { service, rpc } = fixture();
    for (const invalid of [null, { kind: 'create', name: ' ' }, { kind: 'invite', teamId: TEAM, email: 'bad' }, { kind: 'role', teamId: TEAM, userId: INVITE, role: 'owner' }, { kind: 'delete', teamId: 'bad' }, { kind: 'respond', inviteId: INVITE, accept: 'yes' }]) {
      await expect(service.mutateTeam(invalid as never)).resolves.toMatchObject({ ok: false });
    }
    expect(rpc).not.toHaveBeenCalled();
    await service.mutateTeam({ kind: 'respond', inviteId: INVITE, accept: false });
    expect(rpc).toHaveBeenCalledWith('river_team_mutate', { action: { kind: 'respond', inviteId: INVITE, accept: false } });
  });

  it('requires sign-in and returns a useful missing-schema error without legacy fallback', async () => {
    const { service, rpc, setSession } = fixture();
    rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function public.river_team_state in the schema cache' } });
    await expect(service.listTeams()).resolves.toMatchObject({ teams: [], error: expect.stringContaining('not available on the server yet') });
    expect(rpc).toHaveBeenCalledTimes(1);
    setSession(null);
    await expect(service.mutateTeam({ kind: 'create', name: 'Design' })).resolves.toMatchObject({ ok: false, error: 'Sign in to manage teams.' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('discards pending responses after an account change', async () => {
    const { service, rpc, setSession } = fixture();
    let resolve!: (data: { data: unknown; error: null }) => void;
    rpc.mockReturnValue(new Promise((done) => { resolve = done; }));
    const pending = service.listTeams();
    setSession({ user: { id: 'other' }, access_token: 'other-token' });
    resolve({ data: { teams: [{ id: TEAM }], incomingInvites: [] }, error: null });
    await expect(pending).resolves.toMatchObject({ teams: [], error: expect.stringContaining('account changed') });
  });

  it('refreshes on reconnect and visible roster changes, fencing account changes and disposal', async () => {
    const { service, events, subscribed, setSession, supabase } = fixture();
    const changed = vi.fn();
    const stop = service.subscribe(changed);
    expect(events.map(({ table }) => table)).toEqual(['river_share_groups', 'river_share_group_members', 'river_share_group_invites']);
    subscribed('SUBSCRIBED');
    events[1].changed();
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(2);
    setSession(null);
    events[2].changed();
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
    subscribed('SUBSCRIBED');
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
