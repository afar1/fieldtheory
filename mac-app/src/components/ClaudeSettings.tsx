/**
 * ClaudeSettings - Configure Claude Code terminal command allowlist.
 *
 * Allows users to manage which terminal commands Claude Code can run automatically.
 * Provides quick-add tiers (Minimal, Recommended, Dev) and manual management.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface PermissionProfile {
  id: string;
  name: string;
  description: string;
  permissionCount: number;
  permissions: string[];
}

interface PermissionStatus {
  currentProfile: string | null;
  managedPermissions: string[];
  allClaudePermissions: string[];
}

export default function ClaudeSettings() {
  const { theme } = useTheme();

  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<PermissionProfile[]>([]);
  const [status, setStatus] = useState<PermissionStatus | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null);
  const [newPermission, setNewPermission] = useState('');
  const [addingPermission, setAddingPermission] = useState(false);
  const [figuresPath, setFiguresPath] = useState<string>('');

  // Load profiles and status
  const loadData = useCallback(async () => {
    if (!window.claudeAPI) {
      setLoading(false);
      return;
    }

    try {
      const [profilesData, statusData, figuresPathData] = await Promise.all([
        window.claudeAPI.getAvailableProfiles(),
        window.claudeAPI.getPermissionStatus(),
        window.claudeAPI.getFiguresPath?.() ?? Promise.resolve(''),
      ]);
      setProfiles(profilesData);
      setStatus(statusData);
      setFiguresPath(figuresPathData);
    } catch (err) {
      console.error('Failed to load Claude settings:', err);
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddProfilePermissions = useCallback(async (profileId: string) => {
    if (!window.claudeAPI || applying) return;

    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;

    setApplying(true);
    setError(null);

    try {
      // Add the profile's permissions to the allowlist (additive, not replacing)
      const success = await window.claudeAPI.addPermissions(profile.permissions);
      if (success) {
        await loadData();
      } else {
        setError('Failed to add permissions');
      }
    } catch (err) {
      console.error('Failed to add profile permissions:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setApplying(false);
    }
  }, [applying, loadData, profiles]);

  const handleClearPermissions = useCallback(async () => {
    if (!window.claudeAPI || applying) return;

    setApplying(true);
    setError(null);

    try {
      const success = await window.claudeAPI.clearManagedPermissions();
      if (success) {
        await loadData();
      } else {
        setError('Failed to clear permissions');
      }
    } catch (err) {
      console.error('Failed to clear permissions:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setApplying(false);
    }
  }, [applying, loadData]);

  const handleAddPermission = useCallback(async () => {
    if (!window.claudeAPI || !newPermission.trim() || addingPermission) return;

    setAddingPermission(true);
    setError(null);

    try {
      const success = await window.claudeAPI.addPermissions([newPermission.trim()]);
      if (success) {
        setNewPermission('');
        await loadData();
      } else {
        setError('Failed to add permission');
      }
    } catch (err) {
      console.error('Failed to add permission:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setAddingPermission(false);
    }
  }, [newPermission, addingPermission, loadData]);

  const handleRemovePermission = useCallback(async (permission: string) => {
    if (!window.claudeAPI || applying) return;

    setApplying(true);
    setError(null);

    try {
      const success = await window.claudeAPI.removePermissions([permission]);
      if (success) {
        await loadData();
      } else {
        setError('Failed to remove permission');
      }
    } catch (err) {
      console.error('Failed to remove permission:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setApplying(false);
    }
  }, [applying, loadData]);

  if (loading) {
    return (
      <div style={{ padding: '16px' }}>
        <span style={{ color: theme.textSecondary, fontSize: '12px' }}>Loading...</span>
      </div>
    );
  }

  const managedCount = status?.managedPermissions.length ?? 0;

  // Profile display names (capitalize properly)
  const profileDisplayNames: Record<string, string> = {
    minimal: 'Minimal',
    recommended: 'Recommended',
    dev: 'Dev',
  };

  // Field Theory permissions - all granted together
  const fieldTheoryPermissions = [
    'Read(.cursor/commands/*)',
    ...(figuresPath ? [`Read(${figuresPath}/*)`] : []),
    'Bash(git diff *)',
  ];

  // Check if all Field Theory permissions are granted
  const allPermissionsGranted = fieldTheoryPermissions.every(
    perm => status?.allClaudePermissions.includes(perm)
  );

  const handleToggleAllPermissions = async () => {
    if (!window.claudeAPI || applying) return;

    setApplying(true);
    setError(null);

    try {
      const success = allPermissionsGranted
        ? await window.claudeAPI.removePermissions(fieldTheoryPermissions)
        : await window.claudeAPI.addPermissions(fieldTheoryPermissions);
      if (success) {
        await loadData();
      } else {
        setError(`Failed to ${allPermissionsGranted ? 'remove' : 'add'} permissions`);
      }
    } catch (err) {
      console.error('Failed to toggle permissions:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Field Theory Permissions - Single Connect/Disconnect */}
      <div
        style={{
          padding: '16px',
          borderRadius: '8px',
          backgroundColor: theme.isDark ? theme.bgSecondary : '#f9fafb',
          border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
              Read Access
            </span>
            {allPermissionsGranted ? (
              <span style={{
                fontSize: '10px',
                color: theme.success,
                padding: '2px 6px',
                backgroundColor: theme.isDark ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)',
                borderRadius: '4px',
              }}>
                Connected
              </span>
            ) : (
              <span style={{
                fontSize: '10px',
                color: theme.warning,
                padding: '2px 6px',
                backgroundColor: theme.isDark ? 'rgba(234, 179, 8, 0.15)' : 'rgba(234, 179, 8, 0.1)',
                borderRadius: '4px',
              }}>
                Setup needed
              </span>
            )}
          </div>
          <button
            onClick={handleToggleAllPermissions}
            disabled={applying}
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 500,
              color: theme.text,
              backgroundColor: 'transparent',
              border: `1px solid ${theme.border}`,
              borderRadius: '4px',
              cursor: applying ? 'wait' : 'pointer',
              opacity: applying ? 0.5 : 1,
            }}
          >
            {applying ? '...' : allPermissionsGranted ? 'Disconnect' : 'Connect'}
          </button>
        </div>
        <div style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '8px' }}>
          Let Claude Code read screenshots and portable commands (does not affect Librarian)
        </div>
      </div>

      {/* Terminal Command Allowlist - Hidden until ready */}
      {false && (
      <div
        style={{
          padding: '16px',
          borderRadius: '8px',
          backgroundColor: theme.isDark ? theme.bgSecondary : '#f9fafb',
          border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
        }}
      >
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>
            Terminal Command Allowlist
          </div>
          <div style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '4px' }}>
            Commands that can run automatically
          </div>
        </div>

        {/* Quick Add - Profile Buttons */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', color: theme.textSecondary, marginBottom: '8px', fontWeight: 500 }}>
            Quick Add:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {profiles.map((profile) => {
              const isExpanded = expandedProfile === profile.id;
              const displayName = profileDisplayNames[profile.id] || profile.name;
              return (
                <div
                  key={profile.id}
                  style={{
                    borderRadius: '6px',
                    backgroundColor: theme.isDark ? theme.surface2 : '#fff',
                    border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
                          {displayName}
                        </span>
                        <button
                          onClick={() => setExpandedProfile(isExpanded ? null : profile.id)}
                          style={{
                            fontSize: '10px',
                            color: theme.textSecondary,
                            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          {profile.permissionCount} permissions
                          <span style={{ fontSize: '8px' }}>{isExpanded ? '▼' : '▶'}</span>
                        </button>
                      </div>
                      <div style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '2px' }}>
                        {profile.description}
                      </div>
                    </div>
                    <button
                      onClick={() => handleAddProfilePermissions(profile.id)}
                      disabled={applying}
                      style={{
                        padding: '6px 14px',
                        fontSize: '11px',
                        fontWeight: 500,
                        color: '#fff',
                        backgroundColor: theme.accent,
                        border: 'none',
                        borderRadius: '6px',
                        cursor: applying ? 'wait' : 'pointer',
                        opacity: applying ? 0.6 : 1,
                      }}
                    >
                      Add
                    </button>
                  </div>

                  {/* Expanded permissions list */}
                  {isExpanded && (
                    <div
                      style={{
                        padding: '0 12px 12px 12px',
                        borderTop: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
                        paddingTop: '10px',
                      }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {profile.permissions.map((perm, idx) => (
                          <code
                            key={idx}
                            style={{
                              fontSize: '10px',
                              color: theme.textSecondary,
                              fontFamily: "'SF Mono', Monaco, monospace",
                              padding: '3px 6px',
                              backgroundColor: theme.isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.03)',
                              borderRadius: '4px',
                            }}
                          >
                            {perm}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Divider */}
        <div style={{
          height: '1px',
          backgroundColor: theme.isDark ? theme.border : '#e5e7eb',
          margin: '16px 0',
        }} />

        {/* Current Allowlist */}
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '10px',
          }}>
            <div style={{ fontSize: '11px', color: theme.textSecondary, fontWeight: 500 }}>
              Current Allowlist ({managedCount}):
            </div>
            {managedCount > 0 && (
              <button
                onClick={handleClearPermissions}
                disabled={applying}
                style={{
                  padding: '3px 8px',
                  fontSize: '10px',
                  fontWeight: 500,
                  color: theme.textSecondary,
                  backgroundColor: 'transparent',
                  border: `1px solid ${theme.border}`,
                  borderRadius: '4px',
                  cursor: applying ? 'wait' : 'pointer',
                }}
              >
                Clear All
              </button>
            )}
          </div>

          {/* Permission chips */}
          {managedCount > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
              {status?.managedPermissions.map((perm) => (
                <div
                  key={perm}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 8px',
                    backgroundColor: theme.isDark ? theme.surface2 : '#fff',
                    border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
                    borderRadius: '4px',
                  }}
                >
                  <code
                    style={{
                      fontSize: '10px',
                      color: theme.text,
                      fontFamily: "'SF Mono', Monaco, monospace",
                    }}
                  >
                    {perm}
                  </code>
                  <button
                    onClick={() => handleRemovePermission(perm)}
                    disabled={applying}
                    style={{
                      padding: '0',
                      fontSize: '12px',
                      lineHeight: '1',
                      color: theme.textSecondary,
                      backgroundColor: 'transparent',
                      border: 'none',
                      cursor: applying ? 'wait' : 'pointer',
                      opacity: 0.6,
                      marginLeft: '2px',
                    }}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              padding: '12px',
              fontSize: '11px',
              color: theme.textSecondary,
              textAlign: 'center',
              backgroundColor: theme.isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)',
              borderRadius: '6px',
              marginBottom: '12px',
            }}>
              No commands in allowlist. Use Quick Add or add manually below.
            </div>
          )}

          {/* Add custom permission */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={newPermission}
              onChange={(e) => setNewPermission(e.target.value)}
              placeholder="e.g., Bash(npm run dev)"
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: '11px',
                fontFamily: "'SF Mono', Monaco, monospace",
                backgroundColor: theme.isDark ? theme.surface2 : '#fff',
                border: `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
                borderRadius: '6px',
                color: theme.text,
                outline: 'none',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleAddPermission();
                }
              }}
            />
            <button
              onClick={handleAddPermission}
              disabled={!newPermission.trim() || addingPermission}
              style={{
                padding: '8px 16px',
                fontSize: '11px',
                fontWeight: 500,
                color: newPermission.trim() ? '#fff' : theme.textSecondary,
                backgroundColor: newPermission.trim() ? theme.accent : 'transparent',
                border: newPermission.trim() ? 'none' : `1px solid ${theme.border}`,
                borderRadius: '6px',
                cursor: newPermission.trim() && !addingPermission ? 'pointer' : 'default',
              }}
            >
              Add
            </button>
          </div>
        </div>

        {error && (
          <p style={{ fontSize: '11px', color: theme.error, marginTop: '12px', marginBottom: 0 }}>
            {error}
          </p>
        )}
      </div>
      )}

      {/* Info Footer */}
      <p style={{ fontSize: '10px', color: theme.textSecondary, lineHeight: '1.5', margin: 0 }}>
        Stored in <code style={{
          fontSize: '9px',
          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
          padding: '1px 4px',
          borderRadius: '3px'
        }}>~/.claude/settings.json</code>. Librarian write permissions are configured separately per-project.
      </p>
    </div>
  );
}
