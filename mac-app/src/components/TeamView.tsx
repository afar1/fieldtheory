// =============================================================================
// TeamView - Team clipboard with auth gating and member management.
// Shows sign-in form if not authenticated, otherwise shows team items and members.
// Matches the same interaction model as ClipboardHistory (j/k nav, Enter paste, etc.)
// =============================================================================

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../supabaseClient';
import { Session } from '@supabase/supabase-js';

// =============================================================================
// Types
// =============================================================================

interface TeamClipboardItem {
  id: string;
  userId: string;
  sharedByEmail: string | null;
  type: 'text' | 'image' | 'transcript' | 'screenshot';
  content: string | null;
  imageData: string | null;    // Legacy: base64-encoded image from bytea column.
  imagePath: string | null;    // New: path in Supabase Storage bucket.
  imageUrl: string | null;     // New: signed URL for storage bucket access.
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

// Stack info for grouping items.
interface TeamStackInfo {
  stackId: string;
  itemCount: number;
  imageCount: number;
  textCount: number;
  createdByEmail: string | null;
  createdAt: number;
}

// List row can be an individual item or a stack of items.
type TeamListRow =
  | { type: 'item'; item: TeamClipboardItem }
  | { type: 'stack'; stack: TeamStackInfo; items: TeamClipboardItem[]; expanded: boolean };

// =============================================================================
// Helpers
// =============================================================================

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

// Smart truncation that shows beginning and end of text.
function smartTruncateText(text: string, targetWords: number = 8): {
  firstPart: string;
  lastPart: string;
  needsTruncation: boolean;
} {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= targetWords * 2 + 2) {
    return { firstPart: text, lastPart: '', needsTruncation: false };
  }
  const firstPart = words.slice(0, targetWords).join(' ');
  const lastPart = words.slice(-targetWords).join(' ');
  return { firstPart, lastPart, needsTruncation: true };
}

// Extract initials from email (first.last@domain -> FL, or first letter of email).
function getInitials(email: string | null): string {
  if (!email) return '?';
  const localPart = email.split('@')[0];
  // Try to split by common separators.
  const parts = localPart.split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  // Just use first two letters.
  return localPart.slice(0, 2).toUpperCase();
}

// Format file size for images.
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Combine text from multiple items in a stack.
function combineStackText(items: TeamClipboardItem[]): string {
  return items
    .filter(item => item.type === 'text' || item.type === 'transcript')
    .map(item => item.content || '')
    .filter(Boolean)
    .join('\n\n');
}

// =============================================================================
// KeyCap component - renders a keyboard key with 3D styling.
// =============================================================================

function KeyCap({ children, small = false }: { children: React.ReactNode; small?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: small ? '10px' : '12px',
        height: small ? '10px' : '12px',
        padding: '0 3px',
        fontSize: small ? '7px' : '8px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
        fontWeight: 500,
        color: '#666',
        backgroundColor: '#f0f0f0',
        border: '1px solid #ccc',
        borderRadius: '2px',
        boxShadow: '0 1px 0 #aaa',
        marginRight: '2px',
      }}
    >
      {children}
    </span>
  );
}

// =============================================================================
// InitialsBadge - shows user initials in a small colored circle (inline).
// =============================================================================

function InitialsBadge({ email }: { email: string | null }) {
  const initials = getInitials(email);
  
  // Generate a consistent color from the email.
  const getColorFromEmail = (email: string | null): string => {
    if (!email) return '#888';
    let hash = 0;
    for (let i = 0; i < email.length; i++) {
      hash = email.charCodeAt(i) + ((hash << 5) - hash);
    }
    // Generate a hue from the hash, keep saturation and lightness fixed for readability.
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 65%, 55%)`;
  };
  
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '16px',
        height: '16px',
        borderRadius: '50%',
        backgroundColor: getColorFromEmail(email),
        fontSize: '8px',
        fontWeight: 600,
        color: '#fff',
        marginLeft: '4px',
        verticalAlign: 'middle',
      }}
      title={email || 'Unknown'}
    >
      {initials}
    </span>
  );
}

// =============================================================================
// Component
// =============================================================================

export default function TeamView() {
  const { theme } = useTheme();
  const listRef = useRef<HTMLDivElement>(null);

  // Auth state.
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<'signIn' | 'signUp' | 'forgotPassword'>('signIn');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Team members state.
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [addMemberEmail, setAddMemberEmail] = useState('');
  const [addMemberError, setAddMemberError] = useState<string | null>(null);
  const [addingMember, setAddingMember] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  // Team items state.
  const [teamItems, setTeamItems] = useState<TeamClipboardItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [copyingToPersonal, setCopyingToPersonal] = useState<string | null>(null);

  // Selection and navigation state (matching ClipboardHistory).
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);
  const [keyboardNavActive, setKeyboardNavActive] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  // Check session on mount and listen for changes.
  useEffect(() => {
    // Get session - supabase caches this so it should be fast on remount.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setCheckingAuth(false);
      if (session) {
        window.clipboardAPI?.setSyncSession?.(session.access_token, session.refresh_token);
      }
    });

    // Listen for auth state changes (sign in, sign out, token refresh).
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

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = authEmail.toLowerCase().trim();
    const password = authPassword;

    if (!email || !password) {
      setAuthError('Please enter your email and password');
      return;
    }

    setAuthLoading(true);
    setAuthError(null);

    if (!window.authAPI?.signInWithPassword) {
      setAuthError('Auth not available');
      setAuthLoading(false);
      return;
    }

    const result = await window.authAPI.signInWithPassword(email, password);

    if (result?.error) {
      setAuthError(result.error);
    } else if (result?.session) {
      // Set session in renderer's supabase client so it persists across tab switches.
      await supabase.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      });
      setSession(result.session);
      setAuthEmail('');
      setAuthPassword('');
    } else {
      setAuthError('Sign in failed - no session returned');
    }

    setAuthLoading(false);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = authEmail.toLowerCase().trim();
    const password = authPassword;

    if (!email || !password) {
      setAuthError('Please enter your email and password');
      return;
    }

    if (password !== confirmPassword) {
      setAuthError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setAuthError('Password must be at least 6 characters');
      return;
    }

    setAuthLoading(true);
    setAuthError(null);

    if (!window.authAPI?.signUp) {
      setAuthError('Sign up not available');
      setAuthLoading(false);
      return;
    }

    const result = await window.authAPI.signUp(email, password);

    if (result?.error) {
      setAuthError(result.error);
    } else {
      setSuccessMessage('Check your email to verify your account. You\'ll need to click the verification link before you can sign in.');
      setAuthEmail('');
      setAuthPassword('');
      setConfirmPassword('');
    }

    setAuthLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = authEmail.toLowerCase().trim();

    if (!email) {
      setAuthError('Please enter your email address');
      return;
    }

    setAuthLoading(true);
    setAuthError(null);

    if (!window.authAPI?.resetPasswordForEmail) {
      setAuthError('Password reset not available');
      setAuthLoading(false);
      return;
    }

    const result = await window.authAPI.resetPasswordForEmail(email);

    if (result?.error) {
      setAuthError(result.error);
    } else {
      setSuccessMessage('Check your email for a password reset link.');
    }

    setAuthLoading(false);
  };

  const switchAuthMode = (mode: 'signIn' | 'signUp' | 'forgotPassword') => {
    setAuthMode(mode);
    setAuthError(null);
    setSuccessMessage(null);
    setAuthPassword('');
    setConfirmPassword('');
  };

  // ---------------------------------------------------------------------------
  // Team Members
  // ---------------------------------------------------------------------------

  const loadTeamMembers = useCallback(async () => {
    if (!window.teamClipboardAPI) return;
    setMembersLoading(true);
    const members = await window.teamClipboardAPI.getTeamMembers();
    setTeamMembers(members);
    setMembersLoading(false);
    // Auto-expand team panel if no teammates yet.
    if (members.length === 0) {
      setShowMembers(true);
    }
  }, []);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = addMemberEmail.toLowerCase().trim();

    if (!email) {
      setAddMemberError('Please enter an email address');
      return;
    }

    setAddingMember(true);
    setAddMemberError(null);

    const result = await window.teamClipboardAPI?.addTeamMember(email);

    if (result?.success) {
      setAddMemberEmail('');
      await loadTeamMembers();
      await loadTeamItems();
    } else {
      setAddMemberError(result?.error || 'Failed to add team member');
    }

    setAddingMember(false);
  };

  const handleRemoveMember = async (membershipId: string) => {
    const result = await window.teamClipboardAPI?.removeTeamMember(membershipId);
    if (result?.success) {
      await loadTeamMembers();
      await loadTeamItems();
    }
  };

  // ---------------------------------------------------------------------------
  // Team Items
  // ---------------------------------------------------------------------------

  const loadTeamItems = useCallback(async () => {
    if (!window.teamClipboardAPI) return;
    setItemsLoading(true);
    const items = await window.teamClipboardAPI.queryItems({ limit: 100 });
    setTeamItems(items);
    setItemsLoading(false);
  }, []);

  const copyToPersonal = useCallback(async (teamItemId: string) => {
    if (!window.teamClipboardAPI) return;
    setCopyingToPersonal(teamItemId);
    await window.teamClipboardAPI.copyToPersonal(teamItemId);
    setCopyingToPersonal(null);
  }, []);

  // Paste item directly (copy to personal clipboard, then paste to target app).
  const pasteItem = useCallback(async (item: TeamClipboardItem) => {
    if (!window.clipboardAPI || !window.teamClipboardAPI) return;
    
    // Copy to personal clipboard (this returns the new local item ID).
    const localId = await window.teamClipboardAPI.copyToPersonal(item.id);
    
    if (localId) {
      // Paste the local item and close the window.
      await window.clipboardAPI.pasteItem(localId);
      await window.clipboardAPI.closeWindow();
    }
  }, []);

  // Paste an entire stack (copy all items, paste combined).
  const pasteStack = useCallback(async (stackItems: TeamClipboardItem[]) => {
    if (!window.clipboardAPI || !window.teamClipboardAPI) return;

    // Copy all items to personal clipboard.
    const localIds: number[] = [];
    for (const item of stackItems) {
      const localId = await window.teamClipboardAPI.copyToPersonal(item.id);
      if (localId) {
        localIds.push(localId);
      }
    }

    if (localIds.length > 0) {
      // Paste the stack and close the window.
      await window.clipboardAPI.pasteStack?.(localIds);
      await window.clipboardAPI.closeWindow();
    }
  }, []);

  // Toggle stack expansion.
  const toggleStackExpanded = useCallback((stackId: string) => {
    setExpandedStacks(prev => {
      const next = new Set(prev);
      if (next.has(stackId)) {
        next.delete(stackId);
      } else {
        next.add(stackId);
      }
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Build List Rows (group items into stacks)
  // ---------------------------------------------------------------------------

  const buildListRows = useCallback((): TeamListRow[] => {
    const rows: TeamListRow[] = [];
    const seenStackIds = new Set<string>();

    for (const item of teamItems) {
      if (item.stackId) {
        // This item belongs to a stack.
        if (!seenStackIds.has(item.stackId)) {
          seenStackIds.add(item.stackId);

          // Get all items in this stack.
          const stackItems = teamItems.filter(i => i.stackId === item.stackId);
          const imageCount = stackItems.filter(i => i.type === 'image' || i.type === 'screenshot').length;
          const textCount = stackItems.filter(i => i.type === 'text' || i.type === 'transcript').length;
          
          // Build stack info.
          const stackInfo: TeamStackInfo = {
            stackId: item.stackId,
            itemCount: stackItems.length,
            imageCount,
            textCount,
            createdByEmail: item.sharedByEmail,
            createdAt: Math.min(...stackItems.map(i => i.clientCreatedAtMs)),
          };

          rows.push({
            type: 'stack',
            stack: stackInfo,
            items: stackItems,
            expanded: expandedStacks.has(item.stackId),
          });
        }
        // Skip if we've already processed this stack.
      } else {
        // Individual item (not in a stack).
        rows.push({ type: 'item', item });
      }
    }

    return rows;
  }, [teamItems, expandedStacks]);

  // Memoize list rows.
  const listRows = useMemo(() => buildListRows(), [buildListRows]);

  // Load data when authenticated.
  useEffect(() => {
    if (session) {
      loadTeamMembers();
      loadTeamItems();
    }
  }, [session, loadTeamMembers, loadTeamItems]);

  // Reset selection when list rows change.
  useEffect(() => {
    if (selectedIndex >= listRows.length && listRows.length > 0) {
      setSelectedIndex(listRows.length - 1);
    } else if (listRows.length === 0) {
      setSelectedIndex(0);
    }
  }, [listRows.length, selectedIndex]);

  // ---------------------------------------------------------------------------
  // Keyboard Navigation
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!session || listRows.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const hasMeta = e.metaKey;
      const hasShift = e.shiftKey;

      // Skip if typing in input.
      if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) return;

      const selectedRow = listRows[selectedIndex];

      // Navigation: j/k or ArrowDown/ArrowUp.
      if (key === 'j' || key === 'ArrowDown') {
        e.preventDefault();
        setKeyboardNavActive(true);
        setSelectedIndex(prev => Math.min(prev + 1, listRows.length - 1));
        return;
      }

      if (key === 'k' || key === 'ArrowUp') {
        e.preventDefault();
        setKeyboardNavActive(true);
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        return;
      }

      // Enter: Paste the selected item or stack.
      if (key === 'Enter' && !hasMeta && !hasShift) {
        e.preventDefault();
        if (selectedRow?.type === 'item') {
          pasteItem(selectedRow.item);
        } else if (selectedRow?.type === 'stack') {
          pasteStack(selectedRow.items);
        }
        return;
      }

      // Spacebar: Toggle expansion (for stacks or text items).
      if (key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        if (selectedRow?.type === 'stack') {
          toggleStackExpanded(selectedRow.stack.stackId);
        } else if (selectedRow?.type === 'item') {
          const item = selectedRow.item;
          if (item.type === 'text' || item.type === 'transcript') {
            setExpandedItems(prev => {
              const next = new Set(prev);
              if (next.has(item.id)) {
                next.delete(item.id);
              } else {
                next.add(item.id);
              }
              return next;
            });
          }
        }
        return;
      }

      // c: Copy to personal clipboard without pasting.
      if (key === 'c' && !hasMeta) {
        e.preventDefault();
        if (selectedRow?.type === 'item') {
          copyToPersonal(selectedRow.item.id);
        } else if (selectedRow?.type === 'stack') {
          // Copy entire stack to personal.
          for (const item of selectedRow.items) {
            copyToPersonal(item.id);
          }
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [session, listRows, selectedIndex, pasteItem, pasteStack, copyToPersonal, toggleStackExpanded]);

  // Scroll selected item into view.
  useEffect(() => {
    if (!listRef.current || !keyboardNavActive) return;
    const container = listRef.current;
    const selectedElement = container.children[selectedIndex] as HTMLElement;
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex, keyboardNavActive]);

  // ---------------------------------------------------------------------------
  // Toggle item expansion.
  // ---------------------------------------------------------------------------

  const toggleItemExpanded = useCallback((itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Render: Loading
  // ---------------------------------------------------------------------------

  if (checkingAuth) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: theme.textSecondary }}>
        Loading...
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Not Authenticated
  // ---------------------------------------------------------------------------

  if (!session) {
    const inputStyle = {
      width: '100%',
      padding: '10px 12px',
      marginBottom: '8px',
      fontSize: '13px',
      border: `1px solid ${theme.inputBorder}`,
      borderRadius: '6px',
      backgroundColor: theme.inputBg,
      color: theme.text,
      boxSizing: 'border-box' as const,
    };

    const buttonStyle = {
      width: '100%',
      padding: '10px',
      fontSize: '13px',
      fontWeight: 500,
      backgroundColor: theme.accent,
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      cursor: authLoading ? 'default' : 'pointer',
    };

    const linkStyle = {
      background: 'transparent',
      border: 'none',
      color: theme.accent,
      fontSize: '12px',
      cursor: 'pointer',
      textDecoration: 'underline',
      padding: 0,
    };

    return (
      <div style={{ padding: '16px', flex: 1, overflow: 'auto' }}>
        <div
          style={{
            maxWidth: '320px',
            margin: '40px auto',
            padding: '24px',
            backgroundColor: theme.bgSecondary,
            borderRadius: '12px',
            border: `1px solid ${theme.border}`,
          }}
        >
          {/* Success message */}
          {successMessage && (
            <div
              style={{
                padding: '12px',
                marginBottom: '16px',
                backgroundColor: '#10b98120',
                borderRadius: '6px',
                border: '1px solid #10b981',
              }}
            >
              <p style={{ margin: 0, fontSize: '12px', color: '#10b981' }}>
                {successMessage}
              </p>
              <button
                onClick={() => switchAuthMode('signIn')}
                style={{ ...linkStyle, marginTop: '8px', color: '#10b981' }}
              >
                Back to sign in
              </button>
            </div>
          )}

          {/* Sign In Form */}
          {authMode === 'signIn' && !successMessage && (
            <>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: theme.text }}>
                Sign in to use Team Clipboard
              </h3>
              <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: theme.textSecondary }}>
                Share clipboard items with your team.
              </p>

              <form onSubmit={handleSignIn}>
                <input
                  type="email"
                  placeholder="Email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  disabled={authLoading}
                  style={inputStyle}
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  disabled={authLoading}
                  style={{ ...inputStyle, marginBottom: '12px' }}
                />
                {authError && (
                  <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#ef4444' }}>
                    {authError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={authLoading || !authEmail.trim() || !authPassword}
                  style={{
                    ...buttonStyle,
                    opacity: authLoading || !authEmail.trim() || !authPassword ? 0.6 : 1,
                  }}
                >
                  {authLoading ? 'Signing in...' : 'Sign In'}
                </button>
              </form>

              <div style={{ marginTop: '16px', textAlign: 'center' }}>
                <button onClick={() => switchAuthMode('signUp')} style={linkStyle}>
                  Don't have an account? Sign up
                </button>
                <span style={{ margin: '0 8px', color: theme.textSecondary }}>|</span>
                <button onClick={() => switchAuthMode('forgotPassword')} style={linkStyle}>
                  Forgot password?
                </button>
              </div>
            </>
          )}

          {/* Sign Up Form */}
          {authMode === 'signUp' && !successMessage && (
            <>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: theme.text }}>
                Create your account
              </h3>
              <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: theme.textSecondary }}>
                Sign up to share clipboard items with your team.
              </p>

              <form onSubmit={handleSignUp}>
                <input
                  type="email"
                  placeholder="Email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  disabled={authLoading}
                  style={inputStyle}
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  disabled={authLoading}
                  style={inputStyle}
                />
                <input
                  type="password"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={authLoading}
                  style={{ ...inputStyle, marginBottom: '12px' }}
                />
                {authError && (
                  <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#ef4444' }}>
                    {authError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={authLoading || !authEmail.trim() || !authPassword || !confirmPassword}
                  style={{
                    ...buttonStyle,
                    opacity: authLoading || !authEmail.trim() || !authPassword || !confirmPassword ? 0.6 : 1,
                  }}
                >
                  {authLoading ? 'Creating account...' : 'Create Account'}
                </button>
              </form>

              <div style={{ marginTop: '16px', textAlign: 'center' }}>
                <button onClick={() => switchAuthMode('signIn')} style={linkStyle}>
                  Already have an account? Sign in
                </button>
              </div>
            </>
          )}

          {/* Forgot Password Form */}
          {authMode === 'forgotPassword' && !successMessage && (
            <>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: theme.text }}>
                Reset your password
              </h3>
              <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: theme.textSecondary }}>
                Enter your email and we'll send you a reset link.
              </p>

              <form onSubmit={handleForgotPassword}>
                <input
                  type="email"
                  placeholder="Email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  disabled={authLoading}
                  style={{ ...inputStyle, marginBottom: '12px' }}
                />
                {authError && (
                  <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#ef4444' }}>
                    {authError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={authLoading || !authEmail.trim()}
                  style={{
                    ...buttonStyle,
                    opacity: authLoading || !authEmail.trim() ? 0.6 : 1,
                  }}
                >
                  {authLoading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>

              <div style={{ marginTop: '16px', textAlign: 'center' }}>
                <button onClick={() => switchAuthMode('signIn')} style={linkStyle}>
                  Back to sign in
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Authenticated
  // ---------------------------------------------------------------------------

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        padding: '0 16px 16px 16px',
      }}
    >
      {/* Header with user info and team members toggle */}
      <div
        style={{
          marginBottom: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: theme.textSecondary }}>
            Signed in as {session?.user?.email}
          </span>
        </div>
        <button
          onClick={() => setShowMembers(!showMembers)}
          style={{
            padding: '4px 8px',
            fontSize: '10px',
            backgroundColor: 'transparent',
            color: theme.accent,
            border: `1px solid ${theme.accent}`,
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          {showMembers ? 'Hide' : `Team${teamMembers.length > 0 ? ` (${teamMembers.length})` : ''}`}
        </button>
      </div>

      {/* Team members panel */}
      {showMembers && (
        <div
          style={{
            marginBottom: '12px',
            padding: '12px',
            backgroundColor: theme.bgSecondary,
            borderRadius: '8px',
            border: `1px solid ${theme.border}`,
          }}
        >
          <div style={{ marginBottom: '12px', fontSize: '11px', color: theme.textSecondary }}>
            Team Members
          </div>

          {/* Member list */}
          {teamMembers.map((member) => (
            <div
              key={member.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 0',
                borderBottom: `1px solid ${theme.border}`,
              }}
            >
              <div>
                <span style={{ fontSize: '12px', color: theme.text }}>{member.email}</span>
                {!member.addedByMe && (
                  <span style={{ marginLeft: '8px', fontSize: '10px', color: theme.textSecondary }}>
                    (added you)
                  </span>
                )}
              </div>
              <button
                onClick={() => handleRemoveMember(member.id)}
                style={{
                  padding: '2px 6px',
                  fontSize: '10px',
                  backgroundColor: 'transparent',
                  color: '#ef4444',
                  border: '1px solid #ef4444',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                {member.addedByMe ? 'Remove' : 'Leave'}
              </button>
            </div>
          ))}

          {/* Add member form */}
          <form onSubmit={handleAddMember} style={{ marginTop: '12px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="email"
                placeholder="Add teammate by email"
                value={addMemberEmail}
                onChange={(e) => setAddMemberEmail(e.target.value)}
                disabled={addingMember}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  fontSize: '11px',
                  border: `1px solid ${theme.inputBorder}`,
                  borderRadius: '4px',
                  backgroundColor: theme.inputBg,
                  color: theme.text,
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="submit"
                disabled={addingMember || !addMemberEmail.trim()}
                style={{
                  padding: '6px 12px',
                  fontSize: '11px',
                  backgroundColor: theme.accent,
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: addingMember ? 'default' : 'pointer',
                  opacity: addingMember || !addMemberEmail.trim() ? 0.6 : 1,
                }}
              >
                Add
              </button>
            </div>
            {addMemberError && (
              <p style={{ margin: '8px 0 0 0', fontSize: '10px', color: '#ef4444' }}>
                {addMemberError}
              </p>
            )}
          </form>
        </div>
      )}

      {/* Team items list */}
      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          minHeight: 0,
          borderRadius: '8px',
          border: `1px solid ${theme.border}`,
        }}
      >
        {listRows.length === 0 && !itemsLoading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: theme.textSecondary }}>
            <div style={{ marginBottom: '8px', fontSize: '13px' }}>No team items yet</div>
            <div style={{ fontSize: '11px' }}>
              {teamMembers.length === 0 
                ? 'Add a teammate above to start sharing clipboard items.'
                : 'Share items from your clipboard using the "Share to Team" button.'}
            </div>
          </div>
        ) : (
          listRows.map((row, index) => {
            const isRowSelected = selectedIndex === index;
            const isHovered = hoveredRowIndex === index;

            // Shared row styling.
            const rowStyle = {
              display: 'flex',
              flexDirection: 'column' as const,
              padding: '12px 16px',
              backgroundColor: isRowSelected ? theme.bgSecondary : 'transparent',
              borderTop: isRowSelected ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : '1px solid transparent',
              borderBottom: isRowSelected ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : `1px solid ${theme.border}`,
              borderRight: isRowSelected ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : '1px solid transparent',
              borderLeft: isRowSelected
                ? `2px solid ${theme.isDark ? '#2dd4bf' : '#14b8a6'}`
                : '2px solid transparent',
              boxShadow: isRowSelected
                ? theme.isDark 
                  ? '0 2px 8px rgba(0,0,0,0.3)' 
                  : '0 2px 8px rgba(0,0,0,0.08)'
                : 'none',
              transition: 'background-color 0.1s ease, border-left 0.1s ease, box-shadow 0.1s ease',
              cursor: 'pointer',
              userSelect: 'none' as const,
            };

            // ---------------------------------------------------------------------------
            // Render Stack Row
            // ---------------------------------------------------------------------------
            if (row.type === 'stack') {
              const { stack, items: stackItems, expanded } = row;
              const stackImages = stackItems.filter(i => (i.type === 'image' || i.type === 'screenshot'));
              const combinedText = combineStackText(stackItems);
              const hasText = combinedText.length > 0;
              const truncated = hasText ? smartTruncateText(combinedText, 8) : null;

              return (
                <div
                  key={`stack-${stack.stackId}`}
                  onMouseEnter={() => {
                    setHoveredRowIndex(index);
                    if (!keyboardNavActive) setSelectedIndex(index);
                  }}
                  onMouseLeave={() => setHoveredRowIndex(null)}
                  onMouseMove={() => setKeyboardNavActive(false)}
                  onClick={() => pasteStack(stackItems)}
                  style={rowStyle}
                >
                  {/* Stack indicator */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{
                      fontSize: '9px',
                      fontWeight: 600,
                      color: theme.isDark ? '#a78bfa' : '#7c3aed',
                      backgroundColor: theme.isDark ? 'rgba(167, 139, 250, 0.15)' : 'rgba(124, 58, 237, 0.1)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                    }}>
                      STACK · {stack.itemCount} items
                    </span>
                    <button
                      tabIndex={-1}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStackExpanded(stack.stackId);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: '2px 4px',
                        fontSize: '10px',
                        color: theme.textSecondary,
                        cursor: 'pointer',
                      }}
                    >
                      {expanded ? '▼' : '▶'}
                    </button>
                  </div>

                  {/* Stack image thumbnails */}
                  {stackImages.length > 0 && (
                    <div style={{ display: 'flex', gap: '4px', marginBottom: hasText ? '8px' : '0', flexWrap: 'wrap' }}>
                      {stackImages.slice(0, 4).map((img) => (
                        <div key={img.id} style={{ position: 'relative' }}>
                          {img.imageUrl || img.imageData ? (
                            <img
                              src={img.imageUrl || `data:image/png;base64,${img.imageData}`}
                              alt=""
                              style={{
                                height: '40px',
                                width: 'auto',
                                borderRadius: '4px',
                                border: `1px solid ${theme.border}`,
                              }}
                            />
                          ) : (
                            <div style={{
                              width: '40px',
                              height: '40px',
                              borderRadius: '4px',
                              backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                              border: `1px solid ${theme.border}`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '14px',
                            }}>
                              {img.type === 'screenshot' ? '📷' : '🖼️'}
                            </div>
                          )}
                        </div>
                      ))}
                      {stackImages.length > 4 && (
                        <div style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '4px',
                          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                          border: `1px solid ${theme.border}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          color: theme.textSecondary,
                        }}>
                          +{stackImages.length - 4}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Stack text content */}
                  {hasText && truncated && (
                    <div style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
                      {truncated.needsTruncation ? (
                        <>
                          {truncated.firstPart}
                          <span style={{ color: theme.textSecondary }}> … </span>
                          {truncated.lastPart}
                        </>
                      ) : combinedText}
                    </div>
                  )}

                  {/* Expanded: show all items in the stack */}
                  {expanded && (
                    <div style={{
                      marginTop: '8px',
                      paddingLeft: '12px',
                      borderLeft: `2px solid ${theme.border}`,
                    }}>
                      {stackItems.map((item) => {
                        const isImage = item.type === 'image' || item.type === 'screenshot';
                        const isText = item.type === 'text' || item.type === 'transcript';
                        return (
                          <div key={item.id} style={{ padding: '6px 0', borderBottom: `1px solid ${theme.border}` }}>
                            {isImage && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {item.imageUrl || item.imageData ? (
                                  <img
                                    src={item.imageUrl || `data:image/png;base64,${item.imageData}`}
                                    alt=""
                                    style={{ height: '30px', borderRadius: '3px', border: `1px solid ${theme.border}` }}
                                  />
                                ) : (
                                  <span>{item.type === 'screenshot' ? '📷' : '🖼️'}</span>
                                )}
                                <span style={{ fontSize: '11px', color: theme.textSecondary }}>
                                  {item.type === 'screenshot' ? 'Screenshot' : 'Image'}
                                  {item.imageWidth && item.imageHeight && ` · ${item.imageWidth}×${item.imageHeight}`}
                                </span>
                              </div>
                            )}
                            {isText && item.content && (
                              <div style={{ fontSize: '11px', color: theme.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                {item.content.length > 200 ? item.content.slice(0, 200) + '...' : item.content}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Footer row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                    <div style={{ fontSize: '10px', color: theme.textSecondary, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>{formatRelativeTime(stack.createdAt)}</span>
                      <InitialsBadge email={stack.createdByEmail} />
                    </div>
                    <div style={{ display: 'flex', gap: '4px', visibility: isRowSelected || isHovered ? 'visible' : 'hidden' }}>
                      <button
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => { e.stopPropagation(); pasteStack(stackItems); }}
                        style={{
                          padding: '4px 6px',
                          fontSize: '10px',
                          fontWeight: 500,
                          backgroundColor: 'transparent',
                          color: theme.textSecondary,
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        <KeyCap>↵</KeyCap> paste stack
                      </button>
                    </div>
                  </div>
                </div>
              );
            }

            // ---------------------------------------------------------------------------
            // Render Individual Item Row
            // ---------------------------------------------------------------------------
            const item = row.item;
            const isImage = item.type === 'image' || item.type === 'screenshot';
            const isText = item.type === 'text' || item.type === 'transcript';
            const isCopying = copyingToPersonal === item.id;
            const isExpanded = expandedItems.has(item.id);
            const truncated = isText && item.content ? smartTruncateText(item.content, 8) : null;
            const showSmartTruncation = truncated && truncated.needsTruncation && !isExpanded;

            return (
              <div
                key={item.id}
                onMouseEnter={() => {
                  setHoveredRowIndex(index);
                  if (!keyboardNavActive) setSelectedIndex(index);
                }}
                onMouseLeave={() => setHoveredRowIndex(null)}
                onMouseMove={() => setKeyboardNavActive(false)}
                onClick={() => pasteItem(item)}
                style={rowStyle}
              >
                {/* Content section */}
                <div>
                  {/* Image/screenshot - show thumbnail */}
                  {isImage && (
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      {item.imageUrl || item.imageData ? (
                        <img
                          src={item.imageUrl || `data:image/png;base64,${item.imageData}`}
                          alt=""
                          style={{
                            height: '50px',
                            width: 'auto',
                            borderRadius: '4px',
                            border: `1px solid ${theme.border}`,
                            flexShrink: 0,
                          }}
                        />
                      ) : (
                        <div style={{
                          width: '50px',
                          height: '50px',
                          borderRadius: '4px',
                          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                          border: `1px solid ${theme.border}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '18px',
                          flexShrink: 0,
                        }}>
                          {item.type === 'screenshot' ? '📷' : '🖼️'}
                        </div>
                      )}
                      <div style={{ flex: 1, fontSize: '12px', fontWeight: 500, color: theme.text }}>
                        {item.type === 'screenshot' ? 'Screenshot' : 'Image'}
                      </div>
                    </div>
                  )}

                  {/* Text content */}
                  {isText && item.content && (
                    <>
                      {isExpanded ? (
                        <div style={{ fontSize: '12px', fontWeight: 500, color: theme.text, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                          {item.content}
                        </div>
                      ) : showSmartTruncation ? (
                        <div>
                          <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>{truncated.firstPart}</span>
                          <span style={{ color: theme.textSecondary, fontSize: '12px' }}> … </span>
                          <button
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => { e.stopPropagation(); toggleItemExpanded(item.id); }}
                            style={{
                              background: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                              border: 'none',
                              padding: '2px 8px',
                              fontSize: '10px',
                              fontWeight: 500,
                              color: theme.textSecondary,
                              cursor: 'pointer',
                              borderRadius: '4px',
                              margin: '0 4px',
                              verticalAlign: 'middle',
                            }}
                          >
                            expand
                          </button>
                          <span style={{ color: theme.textSecondary, fontSize: '12px' }}> … </span>
                          <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>{truncated.lastPart}</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>{item.content}</div>
                      )}
                    </>
                  )}
                </div>

                {/* Footer row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                  <div style={{ fontSize: '10px', color: theme.textSecondary, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {isText && item.wordCount && item.charCount && (
                      <>
                        <span>{item.wordCount} words, {item.charCount} chars</span>
                        <span>•</span>
                      </>
                    )}
                    {isImage && item.imageWidth && item.imageHeight && (
                      <>
                        <span>{item.imageWidth}×{item.imageHeight}</span>
                        <span>•</span>
                      </>
                    )}
                    {isImage && item.imageSize && (
                      <>
                        <span>{formatFileSize(item.imageSize)}</span>
                        <span>•</span>
                      </>
                    )}
                    <span>{formatRelativeTime(item.clientCreatedAtMs)}</span>
                    {item.type === 'transcript' && (
                      <>
                        <span>•</span>
                        <span style={{ color: '#10b981' }}>Transcript</span>
                      </>
                    )}
                    <InitialsBadge email={item.sharedByEmail} />
                  </div>

                  <div style={{ display: 'flex', gap: '4px', visibility: isRowSelected || isHovered ? 'visible' : 'hidden' }}>
                    <button
                      tabIndex={-1}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => { e.stopPropagation(); copyToPersonal(item.id); }}
                      disabled={isCopying}
                      style={{
                        padding: '4px 6px',
                        fontSize: '10px',
                        fontWeight: 500,
                        backgroundColor: 'transparent',
                        color: theme.textSecondary,
                        border: 'none',
                        borderRadius: '4px',
                        cursor: isCopying ? 'wait' : 'pointer',
                      }}
                    >
                      <KeyCap>c</KeyCap> {isCopying ? 'copying...' : 'copy'}
                    </button>
                    <button
                      tabIndex={-1}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => { e.stopPropagation(); pasteItem(item); }}
                      style={{
                        padding: '4px 6px',
                        fontSize: '10px',
                        fontWeight: 500,
                        backgroundColor: 'transparent',
                        color: theme.textSecondary,
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      <KeyCap>↵</KeyCap> paste
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
