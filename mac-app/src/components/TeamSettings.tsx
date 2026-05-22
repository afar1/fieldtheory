import { FormEvent, useMemo, useState } from 'react';
import { useTheme, type Theme } from '../contexts/ThemeContext';
import {
  SettingsBadge,
  SettingsCard,
  SettingsInsetGroup,
  SettingsRow,
  SettingsSectionHeading,
} from './settings/SettingsPrimitives';

export type TeamMemberRole = 'owner' | 'member';

export interface TeamMemberView {
  contactId: string;
  email: string;
  displayName?: string | null;
  initials: string;
  role: TeamMemberRole;
  isCurrentUser?: boolean;
}

export interface TeamPendingInviteView {
  contactId: string;
  email: string;
  direction: 'outgoing' | 'incoming';
  invitedByName?: string | null;
  initials?: string | null;
}

export interface TeamSettingsState {
  loading?: boolean;
  error?: string | null;
  currentUserRole: TeamMemberRole | null;
  members: TeamMemberView[];
  pendingInvites: TeamPendingInviteView[];
}

interface TeamSettingsProps {
  state: TeamSettingsState;
  onInviteMember?: (email: string) => Promise<boolean | void> | boolean | void;
  onRespondToInvite?: (contactId: string, accept: boolean) => Promise<boolean | void> | boolean | void;
  onRemoveMember?: (contactId: string) => Promise<boolean | void> | boolean | void;
  onLeaveTeam?: () => Promise<boolean | void> | boolean | void;
}

type PendingAction =
  | { kind: 'invite' }
  | { kind: 'accept'; contactId: string }
  | { kind: 'decline'; contactId: string }
  | { kind: 'remove'; contactId: string }
  | { kind: 'leave' }
  | null;

function getStyles(theme: Theme) {
  return {
    stack: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '14px',
    },
    form: {
      display: 'flex',
      gap: '8px',
      alignItems: 'center',
      marginTop: '10px',
    },
    input: {
      flex: 1,
      minWidth: 0,
      height: '30px',
      padding: '0 10px',
      borderRadius: '6px',
      border: `1px solid ${theme.border}`,
      backgroundColor: theme.bg,
      color: theme.text,
      fontSize: '12px',
      outline: 'none',
      boxSizing: 'border-box' as const,
    },
    button: {
      height: '30px',
      padding: '0 11px',
      borderRadius: '6px',
      border: `1px solid ${theme.border}`,
      backgroundColor: theme.surface1,
      color: theme.text,
      fontSize: '12px',
      fontWeight: 500,
      cursor: 'pointer',
      whiteSpace: 'nowrap' as const,
    },
    primaryButton: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
      color: '#fff',
    },
    dangerButton: {
      color: theme.error,
    },
    disabled: {
      opacity: 0.55,
      cursor: 'not-allowed',
    },
    identity: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      minWidth: 0,
    },
    initials: {
      width: '28px',
      height: '28px',
      borderRadius: '999px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: '0 0 28px',
      fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: '10px',
      fontWeight: 600,
      color: theme.accent,
      backgroundColor: theme.isDark ? 'rgba(96, 165, 250, 0.16)' : 'rgba(37, 99, 235, 0.1)',
    },
    nameStack: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '2px',
      minWidth: 0,
    },
    name: {
      fontSize: '13px',
      color: theme.text,
      fontWeight: 500,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap' as const,
    },
    email: {
      fontSize: '11.5px',
      color: theme.textSecondary,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap' as const,
    },
    rowActions: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      flexShrink: 0,
    },
    muted: {
      fontSize: '12px',
      color: theme.textSecondary,
      lineHeight: 1.5,
      margin: 0,
    },
    error: {
      fontSize: '12px',
      color: theme.error,
      lineHeight: 1.5,
      margin: 0,
    },
  };
}

function displayNameForMember(member: TeamMemberView): string {
  if (member.displayName?.trim()) return member.displayName.trim();
  if (member.isCurrentUser) return 'You';
  return member.email;
}

function disabledStyle(disabled: boolean, styles: ReturnType<typeof getStyles>) {
  return disabled ? styles.disabled : null;
}

export default function TeamSettings({
  state,
  onInviteMember,
  onRespondToInvite,
  onRemoveMember,
  onLeaveTeam,
}: TeamSettingsProps) {
  const { theme } = useTheme();
  const styles = getStyles(theme);
  const [email, setEmail] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const owner = useMemo(() => state.members.find((member) => member.role === 'owner'), [state.members]);
  const isOwner = state.currentUserRole === 'owner';
  const isMember = state.currentUserRole === 'member';
  const canInvite = isOwner || state.currentUserRole === null;
  const hasAcceptedTeam = state.members.length >= 2;
  const outgoingInvites = state.pendingInvites.filter((invite) => invite.direction === 'outgoing');
  const incomingInvites = state.pendingInvites.filter((invite) => invite.direction === 'incoming');
  const trimmedEmail = email.trim();
  const isBusy = pendingAction !== null || !!state.loading;
  const inviteDisabled = !onInviteMember || !trimmedEmail || isBusy;

  const runAction = async (action: PendingAction, callback: () => Promise<boolean | void> | boolean | void) => {
    if (!action) return;
    setPendingAction(action);
    try {
      await callback();
    } finally {
      setPendingAction(null);
    }
  };

  const handleInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inviteDisabled) return;
    await runAction({ kind: 'invite' }, async () => {
      const result = await onInviteMember?.(trimmedEmail);
      if (result !== false) setEmail('');
    });
  };

  const renderInviteForm = () => {
    if (!canInvite) return null;

    return (
      <form style={styles.form} onSubmit={handleInvite}>
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="teammate@example.com"
          type="email"
          aria-label="Teammate email"
          style={styles.input}
          disabled={isBusy}
        />
        <button
          type="submit"
          disabled={inviteDisabled}
          style={{
            ...styles.button,
            ...styles.primaryButton,
            ...disabledStyle(inviteDisabled, styles),
          }}
        >
          {pendingAction?.kind === 'invite' ? 'Inviting...' : 'Invite teammate'}
        </button>
      </form>
    );
  };

  return (
    <SettingsCard theme={theme}>
      <SettingsSectionHeading
        theme={theme}
        title="Team"
        description="Invite teammates so River files can be shared with the people who accepted."
      />

      <div style={styles.stack}>
        {state.loading ? (
          <p style={styles.muted}>Loading team...</p>
        ) : (
          <>
            {state.error && <p style={styles.error}>{state.error}</p>}

            {!hasAcceptedTeam && incomingInvites.length === 0 && (
              <SettingsInsetGroup theme={theme}>
                <p style={styles.muted}>You do not have a team yet.</p>
                {renderInviteForm()}
              </SettingsInsetGroup>
            )}

            {incomingInvites.length > 0 && (
              <SettingsInsetGroup theme={theme}>
                <SettingsSectionHeading theme={theme} title="Invites" />
                {incomingInvites.map((invite, index) => {
                  const accepting = pendingAction?.kind === 'accept' && pendingAction.contactId === invite.contactId;
                  const declining = pendingAction?.kind === 'decline' && pendingAction.contactId === invite.contactId;
                  const actionDisabled = isBusy;
                  return (
                    <SettingsRow
                      key={invite.contactId}
                      theme={theme}
                      label={invite.invitedByName || invite.email}
                      hint={`Invited ${invite.email}`}
                      last={index === incomingInvites.length - 1}
                      control={(
                        <div style={styles.rowActions}>
                          <button
                            type="button"
                            disabled={!onRespondToInvite || actionDisabled}
                            onClick={() => runAction({ kind: 'accept', contactId: invite.contactId }, () => onRespondToInvite?.(invite.contactId, true))}
                            style={{ ...styles.button, ...styles.primaryButton, ...disabledStyle(!onRespondToInvite || actionDisabled, styles) }}
                          >
                            {accepting ? 'Accepting...' : 'Accept'}
                          </button>
                          <button
                            type="button"
                            disabled={!onRespondToInvite || actionDisabled}
                            onClick={() => runAction({ kind: 'decline', contactId: invite.contactId }, () => onRespondToInvite?.(invite.contactId, false))}
                            style={{ ...styles.button, ...disabledStyle(!onRespondToInvite || actionDisabled, styles) }}
                          >
                            {declining ? 'Declining...' : 'Decline'}
                          </button>
                        </div>
                      )}
                    />
                  );
                })}
              </SettingsInsetGroup>
            )}

            {hasAcceptedTeam && (
              <SettingsInsetGroup theme={theme}>
                <SettingsSectionHeading theme={theme} title="Members" />
                {state.members.map((member, index) => {
                  const removing = pendingAction?.kind === 'remove' && pendingAction.contactId === member.contactId;
                  const canRemove = isOwner && member.role !== 'owner' && !member.isCurrentUser;
                  return (
                    <SettingsRow
                      key={member.contactId}
                      theme={theme}
                      label={(
                        <span style={styles.identity}>
                          <span style={styles.initials}>{member.initials}</span>
                          <span style={styles.nameStack}>
                            <span style={styles.name}>{displayNameForMember(member)}</span>
                            <span style={styles.email}>{member.email}</span>
                          </span>
                        </span>
                      )}
                      last={index === state.members.length - 1}
                      control={(
                        <div style={styles.rowActions}>
                          <SettingsBadge theme={theme} tone={member.role === 'owner' ? 'info' : 'neutral'}>
                            {member.role === 'owner' ? 'Owner' : 'Member'}
                          </SettingsBadge>
                          {member.isCurrentUser && <SettingsBadge theme={theme}>You</SettingsBadge>}
                          {canRemove && (
                            <button
                              type="button"
                              disabled={!onRemoveMember || isBusy}
                              onClick={() => runAction({ kind: 'remove', contactId: member.contactId }, () => onRemoveMember?.(member.contactId))}
                              style={{
                                ...styles.button,
                                ...styles.dangerButton,
                                ...disabledStyle(!onRemoveMember || isBusy, styles),
                              }}
                            >
                              {removing ? 'Removing...' : 'Remove'}
                            </button>
                          )}
                        </div>
                      )}
                    />
                  );
                })}
              </SettingsInsetGroup>
            )}

            {outgoingInvites.length > 0 && (
              <SettingsInsetGroup theme={theme}>
                <SettingsSectionHeading theme={theme} title="Pending" />
                {outgoingInvites.map((invite, index) => (
                  <SettingsRow
                    key={invite.contactId}
                    theme={theme}
                    label={invite.email}
                    last={index === outgoingInvites.length - 1}
                    control={<SettingsBadge theme={theme} tone="warning">Invited</SettingsBadge>}
                  />
                ))}
              </SettingsInsetGroup>
            )}

            {hasAcceptedTeam && canInvite && renderInviteForm()}

            {hasAcceptedTeam && isMember && (
              <div>
                <button
                  type="button"
                  disabled={!onLeaveTeam || isBusy}
                  onClick={() => runAction({ kind: 'leave' }, () => onLeaveTeam?.())}
                  style={{
                    ...styles.button,
                    ...styles.dangerButton,
                    ...disabledStyle(!onLeaveTeam || isBusy, styles),
                  }}
                >
                  {pendingAction?.kind === 'leave' ? 'Leaving...' : `Leave ${owner?.displayName || owner?.email || 'team'}`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </SettingsCard>
  );
}
