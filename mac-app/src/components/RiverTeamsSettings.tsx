import { useCallback, useEffect, useRef, useState, Fragment, type CSSProperties, type FormEvent } from 'react';
import type { RiverTeamAction, RiverTeamResult, RiverTeamsState } from '../../electron/shared/riverTeams';
import { useTheme, type Theme } from '../contexts/ThemeContext';
import { SettingsBadge, SettingsCard, SettingsInsetGroup, SettingsRow, SettingsSectionHeading } from './settings/SettingsPrimitives';

export interface RiverTeamsSettingsProps {
  loadTeams: () => Promise<RiverTeamsState>;
  mutateTeam: (action: RiverTeamAction) => Promise<RiverTeamResult>;
  currentUserId: string | null;
  disabled?: boolean;
  subscribe?: (callback: () => void) => () => void;
  onChanged?: () => void;
}

interface Confirmation {
  action: RiverTeamAction;
  title: string;
  description: string;
  button: string;
}

const emptyState: RiverTeamsState = { teams: [], incomingInvites: [] };
const roleLabels = { owner: 'Owner', admin: 'Admin', member: 'Member' };

function getStyles(theme: Theme) {
  return {
    stack: { display: 'flex', flexDirection: 'column', gap: '14px' } as CSSProperties,
    actions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' } as CSSProperties,
    form: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px' } as CSSProperties,
    input: {
      flex: 1, minWidth: 0, height: '30px', padding: '0 10px', borderRadius: '6px',
      border: `1px solid ${theme.border}`, backgroundColor: theme.bg, color: theme.text,
      fontSize: '12px', boxSizing: 'border-box',
    } as CSSProperties,
    button: {
      height: '30px', padding: '0 11px', borderRadius: '6px', border: `1px solid ${theme.border}`,
      backgroundColor: theme.surface1, color: theme.text, fontSize: '12px', fontWeight: 500,
      cursor: 'pointer', whiteSpace: 'nowrap',
    } as CSSProperties,
    primary: { backgroundColor: theme.accent, borderColor: theme.accent, color: '#fff' },
    danger: { color: theme.error },
    muted: { fontSize: '12px', color: theme.textSecondary, lineHeight: 1.5, margin: 0 },
    error: { fontSize: '12px', color: theme.error, lineHeight: 1.5, margin: 0 },
    identity: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '7px', overflowWrap: 'anywhere' } as CSSProperties,
    confirmation: { padding: '12px', border: `1px solid ${theme.border}`, borderRadius: '6px', backgroundColor: theme.surface2 },
  };
}

export default function RiverTeamsSettings({
  loadTeams, mutateTeam, currentUserId, disabled = false, subscribe, onChanged,
}: RiverTeamsSettingsProps) {
  const { theme } = useTheme();
  const styles = getStyles(theme);
  const [state, setState] = useState<RiverTeamsState>(emptyState);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<RiverTeamAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [email, setEmail] = useState('');
  const [rename, setRename] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const loadSequence = useRef(0);
  const accountEpoch = useRef(0);
  const actionInFlight = useRef(false);

  const refresh = useCallback(async (preferTeamId?: string) => {
    if (!currentUserId) return;
    const sequence = ++loadSequence.current;
    try {
      const next = await loadTeams();
      if (sequence !== loadSequence.current) return;
      if (next.error) {
        setError(next.error);
        return;
      }
      setState(next);
      setSelectedId(previous => {
        if (preferTeamId && next.teams.some(team => team.id === preferTeamId)) return preferTeamId;
        return next.teams.some(team => team.id === previous) ? previous : next.teams[0]?.id ?? '';
      });
    } catch (cause) {
      if (sequence === loadSequence.current) {
        setError(cause instanceof Error ? cause.message : 'Could not load your teams. Try again.');
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [loadTeams, currentUserId]);

  useEffect(() => {
    accountEpoch.current += 1;
    actionInFlight.current = false;
    setState(emptyState);
    setSelectedId('');
    setLoading(!!currentUserId);
    setPending(null);
    setError(null);
    setEmail('');
    setNewName('');
    setCreating(false);
    setRename(null);
    setConfirmation(null);
    void refresh();
    return () => {
      accountEpoch.current += 1;
      loadSequence.current += 1;
    };
  }, [refresh, currentUserId]);

  useEffect(() => subscribe?.(() => { void refresh(); }), [subscribe, refresh]);

  const selected = state.teams.find(team => team.id === selectedId);
  const isOwner = selected?.role === 'owner';
  const canManage = isOwner || selected?.role === 'admin';
  const busy = disabled || loading || pending !== null || !currentUserId;

  const runAction = async (action: RiverTeamAction, onSuccess?: () => void) => {
    if (busy || actionInFlight.current) return;
    actionInFlight.current = true;
    const epoch = accountEpoch.current;
    setPending(action);
    setError(null);
    try {
      const result = await mutateTeam(action);
      if (epoch !== accountEpoch.current) return;
      if (!result.ok) {
        setError(result.error || 'That change could not be saved. Try again.');
        return;
      }
      setConfirmation(null);
      onSuccess?.();
      await refresh(result.teamId);
      if (epoch === accountEpoch.current) onChanged?.();
    } catch (cause) {
      if (epoch === accountEpoch.current) {
        setError(cause instanceof Error ? cause.message : 'That change could not be saved. Try again.');
      }
    } finally {
      if (epoch === accountEpoch.current) {
        actionInFlight.current = false;
        setPending(null);
      }
    }
  };

  const selectTeam = (id: string) => {
    setSelectedId(id);
    setEmail('');
    setRename(null);
    setConfirmation(null);
    setError(null);
  };

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    void runAction({ kind: 'create', name: newName.trim() }, () => { setNewName(''); setCreating(false); });
  };

  const submitInvite = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !email.trim()) return;
    void runAction({ kind: 'invite', teamId: selected.id, email: email.trim() }, () => setEmail(''));
  };

  const buttonStyle = (primary = false, danger = false, unavailable = busy): CSSProperties => ({
    ...styles.button, ...(primary ? styles.primary : {}), ...(danger ? styles.danger : {}),
    ...(unavailable ? { opacity: 0.55, cursor: 'not-allowed' } : {}),
  });

  const confirmationPanel = confirmation && (
    <div role="group" aria-label={confirmation.title} style={styles.confirmation}>
      <SettingsSectionHeading theme={theme} title={confirmation.title} description={confirmation.description} />
      <div style={styles.actions}>
        <button type="button" disabled={busy} style={buttonStyle(false, true)} onClick={() => void runAction(confirmation.action)}>{pending ? 'Saving…' : confirmation.button}</button>
        <button type="button" disabled={busy} style={buttonStyle()} onClick={() => setConfirmation(null)}>Cancel</button>
      </div>
    </div>
  );

  return (
    <SettingsCard theme={theme}>
      <SettingsSectionHeading
        theme={theme}
        title="Teams"
        description="Create teams and join as many as you like. Each team shares its own River history."
      />
      <div style={styles.stack}>
        {!currentUserId && <p style={styles.muted}>Sign in to create or join teams.</p>}
        {disabled && currentUserId && <p style={styles.muted}>Team changes are temporarily unavailable.</p>}
        {error && (
          <div role="alert" style={styles.actions}>
            <p style={styles.error}>{error}</p>
            <button type="button" disabled={busy} style={buttonStyle()} onClick={() => { setError(null); void refresh(); }}>Refresh</button>
          </div>
        )}
        {loading && <p role="status" style={styles.muted}>Loading teams…</p>}

        {state.incomingInvites.length > 0 && (
          <SettingsInsetGroup theme={theme}>
            <SettingsSectionHeading theme={theme} title="Invitations" />
            {state.incomingInvites.map((invite, index) => (
              <SettingsRow
                key={invite.id}
                theme={theme}
                label={invite.teamName}
                hint={`Invited as ${invite.email}. Joining includes this team’s past River posts.`}
                last={index === state.incomingInvites.length - 1}
                control={(
                  <div style={styles.actions}>
                    <button type="button" aria-label={`Accept invitation to ${invite.teamName}`} disabled={busy} style={buttonStyle(true)} onClick={() => void runAction({ kind: 'respond', inviteId: invite.id, accept: true })}>
                      {pending?.kind === 'respond' && pending.inviteId === invite.id && pending.accept ? 'Joining…' : 'Accept'}
                    </button>
                    <button type="button" aria-label={`Decline invitation to ${invite.teamName}`} disabled={busy} style={buttonStyle()} onClick={() => void runAction({ kind: 'respond', inviteId: invite.id, accept: false })}>Decline</button>
                  </div>
                )}
              />
            ))}
          </SettingsInsetGroup>
        )}

        <div style={styles.actions}>
          {state.teams.length > 0 && (
            <select aria-label="Selected team" value={selectedId} onChange={event => selectTeam(event.target.value)} disabled={busy} style={styles.input}>
              {state.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          )}
          {selected && <SettingsBadge theme={theme} tone={canManage ? 'info' : 'neutral'}>{roleLabels[selected.role]}</SettingsBadge>}
          <button type="button" disabled={busy} aria-expanded={creating} style={buttonStyle()} onClick={() => setCreating(value => !value)}>New team</button>
        </div>

        {!loading && currentUserId && state.teams.length === 0 && <p style={styles.muted}>You haven’t joined a team yet. Create one or accept an invitation.</p>}
        {creating && (
          <SettingsInsetGroup theme={theme}>
            <SettingsSectionHeading theme={theme} title="Create a team" description="You’ll be its owner. You can invite people and choose admins after creating it." />
            <form style={styles.form} onSubmit={submitCreate}>
              <input autoFocus type="text" required maxLength={80} aria-label="New team name" placeholder="Team name" value={newName} onChange={event => setNewName(event.target.value)} disabled={busy} style={styles.input} />
              <button type="submit" disabled={busy || !newName.trim()} style={buttonStyle(true, false, busy || !newName.trim())}>{pending?.kind === 'create' ? 'Creating…' : 'Create team'}</button>
            </form>
          </SettingsInsetGroup>
        )}

        {selected && (
          <>
            {canManage && (
              rename === null ? (
                <div><button type="button" disabled={busy} style={buttonStyle()} onClick={() => setRename(selected.name)}>Rename team</button></div>
              ) : (
                <form style={styles.form} onSubmit={event => { event.preventDefault(); if (rename.trim()) void runAction({ kind: 'rename', teamId: selected.id, name: rename.trim() }, () => setRename(null)); }}>
                  <input autoFocus type="text" required maxLength={80} aria-label="Team name" value={rename} onChange={event => setRename(event.target.value)} disabled={busy} style={styles.input} />
                  <button type="submit" disabled={busy || !rename.trim()} style={buttonStyle(true, false, busy || !rename.trim())}>{pending?.kind === 'rename' ? 'Saving…' : 'Save name'}</button>
                  <button type="button" disabled={busy} style={buttonStyle()} onClick={() => setRename(null)}>Cancel</button>
                </form>
              )
            )}

            <SettingsInsetGroup theme={theme}>
              <SettingsSectionHeading theme={theme} title={`Members (${selected.members.length})`} />
              {selected.members.map((member, index) => {
                const isSelf = member.userId === currentUserId;
                const canRemove = !isSelf && (isOwner || (canManage && member.role === 'member'));
                const requestRemove = () => setConfirmation({
                  action: { kind: 'remove', teamId: selected.id, userId: member.userId },
                  title: `Remove ${member.email}?`,
                  description: `They’ll lose access to ${selected.name} and its River posts. Any private copies they saved will remain.`,
                  button: 'Remove member',
                });
                return (
                  <Fragment key={member.userId}>
                    <SettingsRow
                      theme={theme}
                      label={<span style={styles.identity}>{member.email}{isSelf && <SettingsBadge theme={theme}>You</SettingsBadge>}</span>}
                      last={index === selected.members.length - 1}
                      control={(
                        <div style={styles.actions}>
                          <SettingsBadge theme={theme}>{roleLabels[member.role]}</SettingsBadge>
                          {isOwner && !isSelf && member.role !== 'owner' ? (
                            <select
                              aria-label={`Manage ${member.email}`}
                              value=""
                              disabled={busy}
                              style={{ ...styles.input, flex: 'none', maxWidth: '150px' }}
                              onChange={event => {
                                const choice = event.target.value;
                                if (choice === 'remove') requestRemove();
                                else if (choice === 'transfer') setConfirmation({
                                  action: { kind: 'transfer', teamId: selected.id, userId: member.userId },
                                  title: `Make ${member.email} the owner?`,
                                  description: `They’ll manage ownership of ${selected.name}. You’ll become an admin.`,
                                  button: 'Transfer ownership',
                                });
                                else if (choice === 'admin' || choice === 'member') void runAction({ kind: 'role', teamId: selected.id, userId: member.userId, role: choice });
                              }}
                            >
                              <option value="">Manage…</option>
                              <option value={member.role === 'admin' ? 'member' : 'admin'}>{member.role === 'admin' ? 'Make member' : 'Make admin'}</option>
                              <option value="transfer">Transfer ownership</option>
                              <option value="remove">Remove member</option>
                            </select>
                          ) : canRemove && (
                            <button type="button" aria-label={`Remove ${member.email}`} disabled={busy} style={buttonStyle(false, true)} onClick={requestRemove}>Remove</button>
                          )}
                        </div>
                      )}
                    />
                    {confirmation && 'userId' in confirmation.action && confirmation.action.userId === member.userId && confirmationPanel}
                  </Fragment>
                );
              })}
            </SettingsInsetGroup>

            {canManage && (
              <SettingsInsetGroup theme={theme}>
                <SettingsSectionHeading theme={theme} title="Invite people" description="Invite by email, even before they have an account. They’ll join after signing in and accepting." />
                <form style={styles.form} onSubmit={submitInvite}>
                  <input type="email" required aria-label="Teammate email" placeholder="teammate@example.com" value={email} onChange={event => setEmail(event.target.value)} disabled={busy} style={styles.input} />
                  <button type="submit" disabled={busy || !email.trim()} style={buttonStyle(true, false, busy || !email.trim())}>{pending?.kind === 'invite' ? 'Inviting…' : 'Invite'}</button>
                </form>
                {selected.pendingInvites.map((invite, index) => (
                  <SettingsRow
                    key={invite.id}
                    theme={theme}
                    label={<span style={styles.identity}>{invite.email}<SettingsBadge theme={theme} tone="warning">Invited</SettingsBadge></span>}
                    last={index === selected.pendingInvites.length - 1}
                    control={<button type="button" aria-label={`Cancel invitation for ${invite.email}`} disabled={busy} style={buttonStyle()} onClick={() => void runAction({ kind: 'cancelInvite', inviteId: invite.id })}>Cancel invite</button>}
                  />
                ))}
              </SettingsInsetGroup>
            )}

            {confirmation ? (
              !('userId' in confirmation.action) && confirmationPanel
            ) : isOwner ? (
              <div style={styles.stack}>
                <p style={styles.muted}>To leave this team, transfer ownership to another member first.</p>
                <div><button type="button" disabled={busy} style={buttonStyle(false, true)} onClick={() => setConfirmation({
                  action: { kind: 'delete', teamId: selected.id },
                  title: `Delete ${selected.name}?`,
                  description: 'Everyone will lose access to this team and its shared River posts. Private copies people already saved will remain.',
                  button: 'Delete team',
                })}>Delete team</button></div>
              </div>
            ) : (
              <div><button type="button" disabled={busy} style={buttonStyle(false, true)} onClick={() => setConfirmation({
                action: { kind: 'leave', teamId: selected.id },
                title: `Leave ${selected.name}?`,
                description: 'You’ll lose access to this team’s River posts. Your saved private copies will remain.',
                button: 'Leave team',
              })}>Leave team</button></div>
            )}
          </>
        )}
      </div>
    </SettingsCard>
  );
}
