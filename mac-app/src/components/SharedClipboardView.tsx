/**
 * SharedClipboardView - Wrapper for shared/team clipboard items.
 * 
 * This component handles:
 * - Authentication (OTP-based sign in)
 * - Fetching data from sharedClipboardAPI (Supabase)
 * - Cache-first display with background sync
 * - Team member management
 * - Shared-specific actions (copy to personal, unshare)
 * 
 * Uses ClipboardList for all rendering and interaction.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import ClipboardList from './ClipboardList';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../supabaseClient';
import type { Session } from '@supabase/supabase-js';
import type { BaseClipboardItem, StackInfo } from './ClipboardList/types';
import { KeyCap } from './ClipboardList/components';

// =============================================================================
// Types
// =============================================================================

type ClipboardItemType = 'text' | 'image' | 'transcript' | 'screenshot';

// Shared clipboard item from Supabase
interface SharedClipboardItem extends BaseClipboardItem<string> {
  id: string;
  userId: string;
  sharedByEmail: string | null;
  type: ClipboardItemType;
  content: string | null;
  imageData: string | null;
  imagePath: string | null;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageSize: number | null;
  improvedContent: string | null;
  stackId: string | null;
  sourceApp: string | null;
  sourceAppName: string | null;
  wordCount: number | null;
  charCount: number | null;
  clientId: string;
  clientCreatedAtMs: number;
  createdAt: number;
  updatedAt: number;
}

interface TeamMember {
  id: string;
  email: string;
  addedByMe: boolean;
  createdAt: number;
}

// =============================================================================
// Props
// =============================================================================

interface SharedClipboardViewProps {
  onSyncingChange?: (syncing: boolean) => void;
  onFeedback?: (message: string) => void;
}

// =============================================================================
// Component
// =============================================================================

export default function SharedClipboardView({ onSyncingChange, onFeedback }: SharedClipboardViewProps) {
  const { theme } = useTheme();

  // Auth state
  const [session, setSession] = useState<Session | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);

  // Team members state
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [showMembers, setShowMembers] = useState(() => {
    const saved = localStorage.getItem('teamMembersVisible');
    return saved === 'true';
  });
  const [addMemberEmail, setAddMemberEmail] = useState('');
  const [addMemberError, setAddMemberError] = useState<string | null>(null);
  const [addingMember, setAddingMember] = useState(false);

  // Data state - initialize from localStorage cache for instant display
  const [items, setItems] = useState<SharedClipboardItem[]>(() => {
    try {
      const cached = localStorage.getItem('teamItemsCache');
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      // Ignore parse errors, start fresh
    }
    return [];
  });
  const [stacks, setStacks] = useState<StackInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Copy to personal state
  const [copyingToPersonal, setCopyingToPersonal] = useState<string | null>(null);

  // ==========================================================================
  // Auth
  // ==========================================================================

  useEffect(() => {
    if (!supabase) {
      console.warn('[SharedClipboardView] Supabase client not available');
      setCheckingAuth(false);
      return;
    }

    // Get session - supabase caches this so it should be fast on remount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setCheckingAuth(false);
      if (session) {
        window.clipboardAPI?.setSyncSession?.(session.access_token, session.refresh_token);
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setCheckingAuth(false);
      if (session) {
        window.clipboardAPI?.setSyncSession?.(session.access_token, session.refresh_token);
      } else {
        window.clipboardAPI?.clearSyncSession?.();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = authEmail.toLowerCase().trim();

    if (!email) {
      setAuthError('Please enter your email address');
      return;
    }

    setIsRequestingOtp(true);
    setAuthError(null);

    try {
      const { error } = await supabase!.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });

      if (error) throw error;
      setOtpSent(true);
    } catch (err: any) {
      setAuthError(err.message || 'Failed to send code');
    } finally {
      setIsRequestingOtp(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = authEmail.toLowerCase().trim();
    const token = otpCode.trim();

    if (!token || token.length !== 6) {
      setAuthError('Please enter a 6-digit code');
      return;
    }

    setIsVerifyingOtp(true);
    setAuthError(null);

    try {
      const { error } = await supabase!.auth.verifyOtp({
        email,
        token,
        type: 'email',
      });

      if (error) throw error;
      // Session will be set by onAuthStateChange
    } catch (err: any) {
      setAuthError(err.message || 'Failed to verify code');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  // ==========================================================================
  // Data Loading
  // ==========================================================================

  const loadTeamMembers = useCallback(async () => {
    if (!window.sharedClipboardAPI) return;
    const members = await window.sharedClipboardAPI.getTeamMembers();
    setTeamMembers(members);
  }, []);

  const loadItems = useCallback(async (isBackgroundSync: boolean = false) => {
    if (!window.sharedClipboardAPI) return;

    if (isBackgroundSync) {
      setSyncing(true);
      onSyncingChange?.(true);
    } else {
      setLoading(true);
    }

    try {
      const fetchedItems = await window.sharedClipboardAPI.queryItems({ limit: 100 });
      setItems(fetchedItems as SharedClipboardItem[]);

      // Build stacks from items
      const stackMap = new Map<string, SharedClipboardItem[]>();
      for (const item of fetchedItems) {
        if (item.stackId) {
          const existing = stackMap.get(item.stackId) || [];
          existing.push(item);
          stackMap.set(item.stackId, existing);
        }
      }

      const stackInfos: StackInfo[] = [];
      stackMap.forEach((stackItems, stackId) => {
        if (stackItems.length > 1) {
          const imageCount = stackItems.filter(i => i.type === 'image' || i.type === 'screenshot').length;
          const textCount = stackItems.filter(i => i.type === 'text' || i.type === 'transcript').length;
          const firstTextItem = stackItems.find(i => i.content);
          stackInfos.push({
            stackId,
            itemCount: stackItems.length,
            imageCount,
            textCount,
            createdAt: Math.min(...stackItems.map(i => i.createdAt)),
            firstTextPreview: firstTextItem?.content?.substring(0, 100) || null,
          });
        }
      });
      setStacks(stackInfos);

      // Save to localStorage cache
      try {
        localStorage.setItem('teamItemsCache', JSON.stringify(fetchedItems));
      } catch (e) {
        // Ignore storage errors
      }
    } catch (error) {
      console.error('[SharedClipboardView] Failed to load items:', error);
    } finally {
      setLoading(false);
      setSyncing(false);
      onSyncingChange?.(false);
    }
  }, [onSyncingChange]);

  // Load data when authenticated
  useEffect(() => {
    if (session) {
      const hasCachedItems = items.length > 0;
      loadTeamMembers();
      loadItems(hasCachedItems);
    }
  }, [session, loadTeamMembers, loadItems]);

  // Persist showMembers state
  useEffect(() => {
    localStorage.setItem('teamMembersVisible', String(showMembers));
  }, [showMembers]);

  // ==========================================================================
  // Action Handlers
  // ==========================================================================

  const handlePaste = useCallback(async (item: SharedClipboardItem) => {
    if (!window.clipboardAPI || !window.sharedClipboardAPI) return;

    // Copy to personal clipboard first
    const localId = await window.sharedClipboardAPI.copyToPersonal(item.id);
    if (localId) {
      await window.clipboardAPI.pasteItem(localId);
      await window.clipboardAPI.closeWindow();
    }
  }, []);

  const handlePasteStack = useCallback(async (stackItems: SharedClipboardItem[]) => {
    if (!window.clipboardAPI || !window.sharedClipboardAPI) return;

    // Copy all items to personal clipboard
    const localIds: number[] = [];
    for (const item of stackItems) {
      const localId = await window.sharedClipboardAPI.copyToPersonal(item.id);
      if (localId) {
        localIds.push(localId);
      }
    }

    if (localIds.length > 0) {
      await window.clipboardAPI.pasteStack?.(localIds);
      await window.clipboardAPI.closeWindow();
    }
  }, []);

  const handleDelete = useCallback(async (ids: (string | number)[]) => {
    if (!window.sharedClipboardAPI) return;

    for (const id of ids) {
      await window.sharedClipboardAPI.deleteItem(id as string);
    }

    // Optimistically update local state
    setItems(prev => prev.filter(item => !ids.includes(item.id)));
    onFeedback?.('Unshared from team');
  }, [onFeedback]);

  const handleStack = useCallback(async (ids: (string | number)[], newStackId: string) => {
    if (!window.sharedClipboardAPI) return;

    await window.sharedClipboardAPI.updateStackId(ids as string[], newStackId);

    // Optimistically update local state
    setItems(prev => prev.map(item =>
      ids.includes(item.id) ? { ...item, stackId: newStackId } : item
    ));

    loadItems(true);
  }, [loadItems]);

  const handleUnstack = useCallback(async (stackId: string) => {
    if (!window.sharedClipboardAPI) return;

    const stackItems = items.filter(i => i.stackId === stackId);
    const itemIds = stackItems.map(i => i.id);

    await window.sharedClipboardAPI.updateStackId(itemIds, null);

    // Optimistically update local state
    setItems(prev => prev.map(item =>
      itemIds.includes(item.id) ? { ...item, stackId: null } : item
    ));

    loadItems(true);
  }, [items, loadItems]);

  const handleCopyToPersonal = useCallback(async (item: SharedClipboardItem) => {
    if (!window.sharedClipboardAPI) return;
    setCopyingToPersonal(item.id);
    await window.sharedClipboardAPI.copyToPersonal(item.id);
    setCopyingToPersonal(null);
    onFeedback?.('Copied to personal clipboard');
  }, [onFeedback]);

  const handleAddMember = useCallback(async () => {
    if (!window.sharedClipboardAPI || !addMemberEmail.trim()) return;

    setAddingMember(true);
    setAddMemberError(null);

    const result = await window.sharedClipboardAPI.addTeamMember(addMemberEmail.trim());

    if (result?.success) {
      setAddMemberEmail('');
      await loadTeamMembers();
      onFeedback?.('Team member added');
    } else {
      setAddMemberError(result?.error || 'Failed to add team member');
    }

    setAddingMember(false);
  }, [addMemberEmail, loadTeamMembers, onFeedback]);

  // ==========================================================================
  // Render row actions
  // ==========================================================================

  const renderRowActions = useCallback((item: SharedClipboardItem, isHovered: boolean, isSelected: boolean) => {
    if (!isHovered && !isSelected) return null;

    return (
      <>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleCopyToPersonal(item);
          }}
          disabled={copyingToPersonal === item.id}
          style={{
            padding: '4px 8px',
            fontSize: '10px',
            backgroundColor: 'transparent',
            color: theme.textSecondary,
            border: `1px solid ${theme.border}`,
            borderRadius: '4px',
            cursor: copyingToPersonal === item.id ? 'wait' : 'pointer',
            opacity: copyingToPersonal === item.id ? 0.5 : 1,
          }}
        >
          {copyingToPersonal === item.id ? 'Copying...' : 'Copy'}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDelete([item.id]);
          }}
          style={{
            padding: '4px 8px',
            fontSize: '10px',
            backgroundColor: 'transparent',
            color: theme.textSecondary,
            border: `1px solid ${theme.border}`,
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Unshare
        </button>
      </>
    );
  }, [handleCopyToPersonal, handleDelete, copyingToPersonal, theme]);

  // ==========================================================================
  // Render multi-select actions
  // ==========================================================================

  const renderMultiSelectActions = useCallback((selectedIds: Set<string | number>) => {
    return (
      <button
        onClick={async () => {
          for (const id of selectedIds) {
            await window.sharedClipboardAPI?.copyToPersonal(id as string);
          }
          onFeedback?.(`${selectedIds.size} items copied to personal clipboard`);
        }}
        style={{
          padding: '2px 6px',
          fontSize: '10px',
          backgroundColor: 'transparent',
          color: theme.textSecondary,
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        copy all <KeyCap small>c</KeyCap>
      </button>
    );
  }, [onFeedback, theme]);

  // ==========================================================================
  // Team members panel
  // ==========================================================================

  const teamMembersPanel = session ? (
    <div style={{ marginBottom: '12px' }}>
      <button
        onClick={() => setShowMembers(!showMembers)}
        style={{
          width: '100%',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: theme.bgSecondary,
          border: `1px solid ${theme.border}`,
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '11px',
          color: theme.text,
        }}
      >
        <span>Team Members ({teamMembers.length})</span>
        <span>{showMembers ? '▼' : '▶'}</span>
      </button>

      {showMembers && (
        <div style={{
          marginTop: '8px',
          padding: '12px',
          backgroundColor: theme.bgSecondary,
          borderRadius: '6px',
          border: `1px solid ${theme.border}`,
        }}>
          {/* Add member form */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <input
              type="email"
              placeholder="Add team member by email..."
              value={addMemberEmail}
              onChange={(e) => setAddMemberEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddMember()}
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: '11px',
                border: `1px solid ${theme.inputBorder}`,
                borderRadius: '4px',
                backgroundColor: theme.inputBg,
                color: theme.text,
              }}
            />
            <button
              onClick={handleAddMember}
              disabled={addingMember || !addMemberEmail.trim()}
              style={{
                padding: '6px 12px',
                fontSize: '11px',
                backgroundColor: theme.accent,
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: addingMember ? 'wait' : 'pointer',
                opacity: addingMember || !addMemberEmail.trim() ? 0.5 : 1,
              }}
            >
              {addingMember ? '...' : 'Add'}
            </button>
          </div>

          {addMemberError && (
            <div style={{ color: '#ef4444', fontSize: '11px', marginBottom: '8px' }}>
              {addMemberError}
            </div>
          )}

          {/* Member list */}
          {teamMembers.length === 0 ? (
            <div style={{ fontSize: '11px', color: theme.textSecondary }}>
              No team members yet. Add someone to start sharing!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {teamMembers.map((member) => (
                <div
                  key={member.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '4px 0',
                    fontSize: '11px',
                    color: theme.text,
                  }}
                >
                  <span>{member.email}</span>
                  {member.addedByMe && (
                    <button
                      onClick={async () => {
                        await window.sharedClipboardAPI?.removeTeamMember(member.id);
                        loadTeamMembers();
                      }}
                      style={{
                        padding: '2px 6px',
                        fontSize: '10px',
                        backgroundColor: 'transparent',
                        color: theme.textSecondary,
                        border: `1px solid ${theme.border}`,
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  ) : null;

  // ==========================================================================
  // Render: Loading
  // ==========================================================================

  if (checkingAuth) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: theme.textSecondary }}>
        Loading...
      </div>
    );
  }

  // ==========================================================================
  // Render: Sign In
  // ==========================================================================

  if (!session) {
    const inputStyle = {
      width: '100%',
      padding: '10px 12px',
      fontSize: '13px',
      border: `1px solid ${theme.inputBorder}`,
      borderRadius: '6px',
      backgroundColor: theme.inputBg,
      color: theme.text,
      boxSizing: 'border-box' as const,
    };

    const buttonStyle = {
      width: '100%',
      padding: '10px 16px',
      fontSize: '13px',
      fontWeight: 500,
      backgroundColor: theme.accent,
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
    };

    return (
      <div style={{ padding: '16px', flex: 1, overflow: 'auto' }}>
        <div style={{
          maxWidth: '320px',
          margin: '40px auto',
          padding: '24px',
          backgroundColor: theme.bgSecondary,
          borderRadius: '12px',
          border: `1px solid ${theme.border}`,
        }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: theme.text }}>
            Sign in to Field Theory
          </h3>
          <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: theme.textSecondary }}>
            Share clipboard items with your team and sync across devices.
          </p>

          {!otpSent ? (
            <form onSubmit={handleRequestOtp}>
              <input
                type="email"
                placeholder="Email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                disabled={isRequestingOtp}
                style={{ ...inputStyle, marginBottom: '12px' }}
              />
              {authError && (
                <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#ef4444' }}>
                  {authError}
                </p>
              )}
              <button
                type="submit"
                disabled={isRequestingOtp || !authEmail.trim()}
                style={{
                  ...buttonStyle,
                  opacity: isRequestingOtp || !authEmail.trim() ? 0.6 : 1,
                }}
              >
                {isRequestingOtp ? 'Sending...' : 'Send Code'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp}>
              <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: theme.textSecondary }}>
                Enter the 6-digit code sent to {authEmail}
              </p>
              <input
                type="text"
                placeholder="000000"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={isVerifyingOtp}
                maxLength={6}
                style={{
                  ...inputStyle,
                  marginBottom: '12px',
                  textAlign: 'center',
                  letterSpacing: '0.5em',
                  fontSize: '18px',
                }}
              />
              {authError && (
                <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#ef4444' }}>
                  {authError}
                </p>
              )}
              <button
                type="submit"
                disabled={isVerifyingOtp || otpCode.length !== 6}
                style={{
                  ...buttonStyle,
                  opacity: isVerifyingOtp || otpCode.length !== 6 ? 0.6 : 1,
                }}
              >
                {isVerifyingOtp ? 'Verifying...' : 'Verify'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOtpSent(false);
                  setOtpCode('');
                  setAuthError(null);
                }}
                style={{
                  width: '100%',
                  marginTop: '8px',
                  padding: '8px',
                  fontSize: '12px',
                  backgroundColor: 'transparent',
                  color: theme.textSecondary,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Use a different email
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: Authenticated
  // ==========================================================================

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', padding: '0 16px 16px 16px' }}>
      {/* Team members panel */}
      {teamMembersPanel}

      {/* Syncing indicator */}
      {syncing && (
        <div style={{
          fontSize: '10px',
          color: theme.textSecondary,
          marginBottom: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: theme.accent,
            animation: 'pulse 1s infinite',
          }} />
          Syncing...
        </div>
      )}

      {/* ClipboardList */}
      <ClipboardList
        items={items}
        stacks={stacks}
        loading={loading}
        syncing={syncing}
        hasMore={false}
        source="shared"
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onPaste={handlePaste}
        onPasteStack={handlePasteStack}
        onDelete={handleDelete}
        onStack={handleStack}
        onUnstack={handleUnstack}
        onFeedback={onFeedback}
        renderRowActions={renderRowActions}
        renderMultiSelectActions={renderMultiSelectActions}
      />
    </div>
  );
}
