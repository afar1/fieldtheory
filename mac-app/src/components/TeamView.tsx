// =============================================================================
// TeamView - Team clipboard with auth gating and member management.
// Shows sign-in form if not authenticated, otherwise shows team items and members.
// Matches the same interaction model as ClipboardHistory (j/k nav, Enter paste, etc.)
// =============================================================================

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../supabaseClient';
import { Session } from '@supabase/supabase-js';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';

// =============================================================================
// Image Cache - stores fetched images as blob URLs to avoid re-downloading.
// Uses localStorage for persistence across sessions.
// =============================================================================

const IMAGE_CACHE_KEY = 'teamImageCache';
const IMAGE_CACHE_MAX_SIZE = 50; // Maximum number of images to cache.

// In-memory cache for blob URLs (faster than localStorage for rendering).
const blobUrlCache = new Map<string, string>();

// Load cache metadata from localStorage on init.
function getImageCacheMetadata(): Map<string, { timestamp: number; base64: string }> {
  try {
    const stored = localStorage.getItem(IMAGE_CACHE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return new Map(Object.entries(parsed));
    }
  } catch (e) {
    // Ignore parse errors.
  }
  return new Map();
}

// Save cache metadata to localStorage.
function saveImageCacheMetadata(cache: Map<string, { timestamp: number; base64: string }>) {
  try {
    // Limit cache size by removing oldest entries.
    const entries = Array.from(cache.entries());
    if (entries.length > IMAGE_CACHE_MAX_SIZE) {
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toKeep = entries.slice(-IMAGE_CACHE_MAX_SIZE);
      cache = new Map(toKeep);
    }
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch (e) {
    // Ignore storage errors (quota exceeded, etc.).
  }
}

// Get cached image URL or fetch and cache it.
async function getCachedImageUrl(imageUrl: string | null, imageData: string | null, itemId: string): Promise<string> {
  // If we have base64 data, use it directly (already local).
  if (imageData) {
    return `data:image/png;base64,${imageData}`;
  }

  if (!imageUrl) {
    return '';
  }

  // Check in-memory cache first.
  if (blobUrlCache.has(itemId)) {
    return blobUrlCache.get(itemId)!;
  }

  // Check localStorage cache.
  const metadata = getImageCacheMetadata();
  const cached = metadata.get(itemId);
  if (cached?.base64) {
    // Convert base64 to blob URL and store in memory cache.
    const blobUrl = `data:image/png;base64,${cached.base64}`;
    blobUrlCache.set(itemId, blobUrl);
    return blobUrl;
  }

  // Fetch from URL and cache.
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error('Failed to fetch image');
    
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    blobUrlCache.set(itemId, blobUrl);

    // Also store as base64 in localStorage for persistence.
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      if (base64) {
        metadata.set(itemId, { timestamp: Date.now(), base64 });
        saveImageCacheMetadata(metadata);
      }
    };
    reader.readAsDataURL(blob);

    return blobUrl;
  } catch (e) {
    // Fall back to original URL on error.
    console.warn('[TeamView] Image cache fetch failed:', e);
    return imageUrl;
  }
}

// =============================================================================
// CachedImage Component - Renders an image using the cache.
// Shows the image immediately if cached, fetches and caches otherwise.
// =============================================================================

function CachedImage({
  imageUrl,
  imageData,
  itemId,
  alt,
  style,
}: {
  imageUrl: string | null;
  imageData: string | null;
  itemId: string;
  alt: string;
  style?: React.CSSProperties;
}) {
  const [src, setSrc] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    
    getCachedImageUrl(imageUrl, imageData, itemId).then(url => {
      if (!cancelled) {
        setSrc(url);
      }
    });
    
    return () => { cancelled = true; };
  }, [imageUrl, imageData, itemId]);

  if (!src) {
    // Show placeholder while loading.
    return (
      <div style={{
        ...style,
        backgroundColor: 'rgba(128, 128, 128, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <span style={{ fontSize: '12px', color: '#888' }}>...</span>
      </div>
    );
  }

  return <img src={src} alt={alt} style={style} />;
}

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
// Shows first ~15 words and last ~15 words for better context.
function smartTruncateText(text: string, targetWords: number = 15): {
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
// DraggableDroppableRow - wrapper that makes a row both draggable and a drop target.
// Uses dnd-kit's useDraggable and useDroppable hooks.
// =============================================================================

function DraggableDroppableRow({
  id,
  children,
  style,
  isOver,
  isDragging,
  ...props
}: {
  id: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  isOver?: boolean;
  isDragging?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({ id });
  const { setNodeRef: setDropRef } = useDroppable({ id });

  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      {...attributes}
      {...listeners}
      {...props}
      style={{
        ...style,
        opacity: isDragging ? 0.5 : 1,
        outline: isOver ? '2px solid #2dd4bf' : 'none',
        outlineOffset: '-2px',
      }}
    >
      {children}
    </div>
  );
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
  
  // Initialize showMembers from localStorage so panel stays hidden if user closed it.
  const [showMembers, setShowMembers] = useState(() => {
    const saved = localStorage.getItem('teamMembersVisible');
    return saved === 'true';
  });

  // Team items state.
  // Initialize from localStorage cache for instant display.
  const [teamItems, setTeamItems] = useState<TeamClipboardItem[]>(() => {
    try {
      const cached = localStorage.getItem('teamItemsCache');
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      // Ignore parse errors, start fresh.
    }
    return [];
  });
  const [itemsLoading, setItemsLoading] = useState(false);
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const [copyingToPersonal, setCopyingToPersonal] = useState<string | null>(null);

  // Selection and navigation state (matching ClipboardHistory).
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);
  const [keyboardNavActive, setKeyboardNavActive] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());
  
  // Multi-select state (matching ClipboardHistory).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  
  // Undo state for delete operations.
  const [deletedItems, setDeletedItems] = useState<TeamClipboardItem[]>([]);
  
  // Track which item is being unshared for visual feedback.
  const [unsharingId, setUnsharingId] = useState<string | null>(null);

  // dnd-kit drag state - tracks what's being dragged.
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overDropId, setOverDropId] = useState<string | null>(null);

  // Search state.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const searchDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pointer sensor with distance activation - must move 5px before drag starts.
  // This distinguishes clicks from drags.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  // Image hover and preview state (matching ClipboardHistory).
  const [hoveredImageId, setHoveredImageId] = useState<string | null>(null);
  type PreviewContent =
    | { type: 'image'; url: string; width: number; height: number }
    | { type: 'text'; content: string };
  const [preview, setPreview] = useState<PreviewContent | null>(null);
  const [previewClosing, setPreviewClosing] = useState(false);

  // Stack preview navigation - tracks position within a stack's preview items.
  // For stacks: images are shown individually, text is combined into one item at the end.
  const [stackPreviewIndex, setStackPreviewIndex] = useState(0);
  const [stackPreviewItems, setStackPreviewItems] = useState<PreviewContent[]>([]);

  // Build the preview sequence for a stack: [image1, image2, ..., combinedText].
  const getStackPreviewItems = useCallback((items: TeamClipboardItem[]): PreviewContent[] => {
    const previewItems: PreviewContent[] = [];

    // Add each image as a separate preview item.
    for (const item of items) {
      if (item.imageUrl || item.imageData) {
        previewItems.push({
          type: 'image',
          url: item.imageUrl || `data:image/png;base64,${item.imageData}`,
          width: item.imageWidth || 0,
          height: item.imageHeight || 0,
        });
      }
    }

    // Combine all text into one preview item at the end.
    const combinedText = combineStackText(items);
    if (combinedText) {
      previewItems.push({ type: 'text', content: combinedText });
    }

    return previewItems;
  }, []);

  // Dismiss preview with fade-out animation.
  const dismissPreview = useCallback(() => {
    if (!preview || previewClosing) return;
    setPreviewClosing(true);
    setTimeout(() => {
      setPreview(null);
      setPreviewClosing(false);
      setStackPreviewIndex(0);
      setStackPreviewItems([]);
    }, 150);
  }, [preview, previewClosing]);

  // Get preview content for a given row.
  const getPreviewForRow = useCallback((row: TeamListRow): PreviewContent | null => {
    if (row.type === 'item') {
      const item = row.item;
      if (item.imageUrl || item.imageData) {
        return {
          type: 'image',
          url: item.imageUrl || `data:image/png;base64,${item.imageData}`,
          width: item.imageWidth || 0,
          height: item.imageHeight || 0,
        };
      } else if (item.content) {
        return { type: 'text', content: item.content };
      }
    } else if (row.type === 'stack') {
      // Check for image first, then text.
      const imageItem = row.items.find(i => i.imageUrl || i.imageData);
      if (imageItem) {
        return {
          type: 'image',
          url: imageItem.imageUrl || `data:image/png;base64,${imageItem.imageData}`,
          width: imageItem.imageWidth || 0,
          height: imageItem.imageHeight || 0,
        };
      } else {
        const combinedText = combineStackText(row.items);
        if (combinedText) {
          return { type: 'text', content: combinedText };
        }
      }
    }
    return null;
  }, []);

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  // Check session on mount and listen for changes.
  useEffect(() => {
    // If supabase client is not available, skip auth. This can happen if
    // environment variables are missing during development.
    if (!supabase) {
      console.warn('[TeamView] Supabase client not available');
      setCheckingAuth(false);
      return;
    }

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
      if (supabase) {
        await supabase.auth.setSession({
          access_token: result.session.access_token,
          refresh_token: result.session.refresh_token,
        });
      }
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

  const loadTeamItems = useCallback(async (isBackgroundSync: boolean = false) => {
    if (!window.teamClipboardAPI) return;
    
    // If we have cached items, show background sync indicator instead of blocking loading.
    if (isBackgroundSync) {
      setBackgroundSyncing(true);
    } else {
      setItemsLoading(true);
    }
    
    const items = await window.teamClipboardAPI.queryItems({ limit: 100 });
    setTeamItems(items);
    
    // Save to localStorage cache for next time.
    try {
      localStorage.setItem('teamItemsCache', JSON.stringify(items));
    } catch (e) {
      // Ignore storage errors (quota exceeded, etc.).
    }
    
    // Pre-cache images in the background for instant display next time.
    // This runs asynchronously and doesn't block the UI.
    items
      .filter(item => item.imageUrl && !item.imageData)
      .forEach(item => {
        getCachedImageUrl(item.imageUrl, item.imageData, item.id).catch(() => {
          // Ignore individual image cache failures.
        });
      });
    
    setItemsLoading(false);
    setBackgroundSyncing(false);
  }, []);

  // ---------------------------------------------------------------------------
  // dnd-kit drag handlers.
  // Uses pointer events internally, works with NSPanel (type: 'panel').
  // ---------------------------------------------------------------------------

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverDropId(event.over?.id as string ?? null);
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);
    setOverDropId(null);

    if (!over || active.id === over.id) return;

    // Parse drag IDs: "stack:uuid" or "item:uuid"
    const [activeType, activeId] = (active.id as string).split(':');
    const [overType, overId] = (over.id as string).split(':');

    if (activeType === 'item') {
      const draggedItemId = activeId;
      if (overType === 'stack') {
        // Item dropped on stack -> add to stack.
        await window.teamClipboardAPI?.updateStackId([draggedItemId], overId);
      } else if (overType === 'item') {
        if (draggedItemId !== overId) {
          // Item dropped on item -> create new stack.
          const newStackId = crypto.randomUUID();
          await window.teamClipboardAPI?.updateStackId([draggedItemId, overId], newStackId);
        }
      }
    } else if (activeType === 'stack') {
      const draggedStackId = activeId;
      if (overType === 'stack' && draggedStackId !== overId) {
        // Stack dropped on stack -> merge stacks.
        const stackItems = teamItems.filter(i => i.stackId === draggedStackId);
        if (stackItems.length) {
          const itemIds = stackItems.map(i => i.id);
          await window.teamClipboardAPI?.updateStackId(itemIds, overId);
        }
      } else if (overType === 'item') {
        // Stack dropped on item -> add item to the dragged stack.
        await window.teamClipboardAPI?.updateStackId([overId], draggedStackId);
      }
    }

    loadTeamItems(true);
  }, [loadTeamItems, teamItems]);

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

  // Delete a team item.
  const deleteTeamItem = useCallback(async (itemId: string) => {
    if (!window.teamClipboardAPI) return;
    
    // Find the item to save for undo.
    const item = teamItems.find(i => i.id === itemId);
    if (item) {
      setDeletedItems([item]);
    }
    
    const success = await window.teamClipboardAPI.deleteItem(itemId);
    if (success) {
      // Remove from local state immediately.
      setTeamItems(prev => prev.filter(i => i.id !== itemId));
    }
  }, [teamItems]);

  // Delete multiple team items (for stack deletion).
  const deleteTeamItems = useCallback(async (itemIds: string[]) => {
    if (!window.teamClipboardAPI) return;
    
    // Save items for undo.
    const itemsToDelete = teamItems.filter(i => itemIds.includes(i.id));
    setDeletedItems(itemsToDelete);
    
    // Delete each item.
    for (const id of itemIds) {
      await window.teamClipboardAPI.deleteItem(id);
    }
    
    // Remove from local state.
    setTeamItems(prev => prev.filter(i => !itemIds.includes(i.id)));
  }, [teamItems]);

  // Unstack a team stack (remove stack_id from all items).
  const unstackTeamItems = useCallback(async (stackId: string) => {
    if (!window.teamClipboardAPI) return;
    
    // Get all item IDs in this stack.
    const stackItems = teamItems.filter(i => i.stackId === stackId);
    const itemIds = stackItems.map(i => i.id);
    
    // Update stack_id to null for all items.
    const success = await window.teamClipboardAPI.updateStackId(itemIds, null);
    if (success) {
      // Update local state.
      setTeamItems(prev => prev.map(i => 
        itemIds.includes(i.id) ? { ...i, stackId: null } : i
      ));
    }
  }, [teamItems]);

  // Toggle item expansion (for "show more" text).
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
  // Build List Rows (group items into stacks)
  // ---------------------------------------------------------------------------

  const buildListRows = useCallback((): TeamListRow[] => {
    const rows: TeamListRow[] = [];
    const seenStackIds = new Set<string>();

    // Filter items by search query if present.
    const searchLower = debouncedSearchQuery.toLowerCase().trim();
    const filteredItems = searchLower
      ? teamItems.filter(item => {
          // Match against content or improved content.
          if (item.content?.toLowerCase().includes(searchLower)) return true;
          if (item.improvedContent?.toLowerCase().includes(searchLower)) return true;
          // Match against sharer's email.
          if (item.sharedByEmail?.toLowerCase().includes(searchLower)) return true;
          return false;
        })
      : teamItems;

    for (const item of filteredItems) {
      if (item.stackId) {
        // This item belongs to a stack.
        if (!seenStackIds.has(item.stackId)) {
          seenStackIds.add(item.stackId);

          // Get all items in this stack (from filtered items so search works within stacks).
          const stackItems = filteredItems.filter(i => i.stackId === item.stackId);
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
  }, [teamItems, expandedStacks, debouncedSearchQuery]);

  // Memoize list rows.
  const listRows = useMemo(() => buildListRows(), [buildListRows]);

  // Load data when authenticated.
  // Use background sync if we have cached items for instant display.
  useEffect(() => {
    if (session) {
      // Load both team members and items in parallel.
      // If we have cached items, do a background sync. Otherwise, show loading.
      const hasCachedItems = teamItems.length > 0;
      loadTeamMembers();
      loadTeamItems(hasCachedItems);
    }
  // Note: We intentionally exclude teamItems from deps to avoid re-triggering on every update.
  // The initial cache check is based on the state at mount time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, loadTeamMembers, loadTeamItems]);

  // Reset selection when list rows change.
  useEffect(() => {
    if (selectedIndex >= listRows.length && listRows.length > 0) {
      setSelectedIndex(listRows.length - 1);
    } else if (listRows.length === 0) {
      setSelectedIndex(0);
    }
  }, [listRows.length, selectedIndex]);

  // Persist showMembers panel state to localStorage.
  useEffect(() => {
    localStorage.setItem('teamMembersVisible', String(showMembers));
  }, [showMembers]);

  // Debounce search query to avoid excessive filtering.
  useEffect(() => {
    if (searchDebounceTimerRef.current) {
      clearTimeout(searchDebounceTimerRef.current);
    }
    
    searchDebounceTimerRef.current = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 150);
    
    return () => {
      if (searchDebounceTimerRef.current) {
        clearTimeout(searchDebounceTimerRef.current);
      }
    };
  }, [searchQuery]);

  // ---------------------------------------------------------------------------
  // Keyboard Navigation
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!session || listRows.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const hasMeta = e.metaKey;
      const hasShift = e.shiftKey;
      const hasCtrl = e.ctrlKey;
      const hasAlt = e.altKey;

      // / - Focus search input (like Gmail, Google). Works from anywhere.
      if (key === '/' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        // Skip if already typing in input.
        if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) return;
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }

      // Skip if typing in input (for all other shortcuts).
      if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) return;

      const selectedRow = listRows[selectedIndex];

      // Escape: Dismiss preview, clear selection, or close window.
      if (key === 'Escape') {
        if (preview) {
          e.preventDefault();
          dismissPreview();
          return;
        }
        // If items are selected, clear selection first.
        if (selectedIds.size > 0) {
          e.preventDefault();
          setSelectedIds(new Set());
          setIsMultiSelect(false);
          return;
        }
        // Otherwise close the window.
        window.clipboardAPI?.closeWindow();
        return;
      }

      // Arrow keys - navigate within stack preview when preview is open.
      // →/↓ go forward through stack items, then move to next row when at end.
      // ←/↑ go back through stack items (stop at first item).
      if (preview && stackPreviewItems.length > 1) {
        if (key === 'ArrowRight' || key === 'ArrowDown') {
          e.preventDefault();
          if (stackPreviewIndex < stackPreviewItems.length - 1) {
            // Still more items in this stack - advance within stack.
            setStackPreviewIndex(stackPreviewIndex + 1);
            setPreview(stackPreviewItems[stackPreviewIndex + 1]);
          } else {
            // At the end of stack - move to next row in list.
            const nextRowIndex = Math.min(selectedIndex + 1, listRows.length - 1);
            if (nextRowIndex !== selectedIndex) {
              setSelectedIndex(nextRowIndex);
              const nextRow = listRows[nextRowIndex];
              if (nextRow) {
                if (nextRow.type === 'stack') {
                  const previewItems = getStackPreviewItems(nextRow.items);
                  if (previewItems.length > 0) {
                    setStackPreviewItems(previewItems);
                    setStackPreviewIndex(0);
                    setPreview(previewItems[0]);
                  }
                } else {
                  setStackPreviewItems([]);
                  setStackPreviewIndex(0);
                  const newContent = getPreviewForRow(nextRow);
                  if (newContent) setPreview(newContent);
                }
              }
            }
          }
          return;
        }
        if (key === 'ArrowLeft' || key === 'ArrowUp') {
          e.preventDefault();
          const prevIndex = Math.max(stackPreviewIndex - 1, 0);
          if (prevIndex !== stackPreviewIndex) {
            setStackPreviewIndex(prevIndex);
            setPreview(stackPreviewItems[prevIndex]);
          }
          return;
        }
      }

      // X - Toggle selection on current item (Gmail-style).
      if (key === 'x' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        e.preventDefault();
        
        // Get item IDs to toggle (single item or all items in stack).
        const itemIdsToToggle: string[] = [];
        if (selectedRow?.type === 'item') {
          itemIdsToToggle.push(selectedRow.item.id);
        } else if (selectedRow?.type === 'stack') {
          selectedRow.items.forEach(i => itemIdsToToggle.push(i.id));
        }
        
        // Toggle selection.
        setSelectedIds(prev => {
          const next = new Set(prev);
          const allSelected = itemIdsToToggle.every(id => next.has(id));
          if (allSelected) {
            itemIdsToToggle.forEach(id => next.delete(id));
          } else {
            itemIdsToToggle.forEach(id => next.add(id));
          }
          return next;
        });
        setLastClickedIndex(selectedIndex);
        setIsMultiSelect(true);
        return;
      }

      // Shift+Enter - Toggle multi-select mode.
      if (key === 'Enter' && hasShift) {
        e.preventDefault();
        setIsMultiSelect(true);
        if (selectedRow?.type === 'item') {
          setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(selectedRow.item.id)) {
              next.delete(selectedRow.item.id);
            } else {
              next.add(selectedRow.item.id);
            }
            return next;
          });
        } else if (selectedRow?.type === 'stack') {
          const stackItemIds = selectedRow.items.map(i => i.id);
          setSelectedIds(prev => {
            const next = new Set(prev);
            const allSelected = stackItemIds.every(id => next.has(id));
            if (allSelected) {
              stackItemIds.forEach(id => next.delete(id));
            } else {
              stackItemIds.forEach(id => next.add(id));
            }
            return next;
          });
        }
        return;
      }

      // Delete / Cmd+Backspace - Delete selected item/stack.
      if (key === 'Delete' || key === 'Backspace') {
        // Only Delete key works without modifier, Backspace needs Cmd/Ctrl.
        if (key === 'Backspace' && !hasMeta && !hasCtrl) return;
        
        e.preventDefault();
        (async () => {
          if (selectedRow?.type === 'item') {
            await deleteTeamItem(selectedRow.item.id);
          } else if (selectedRow?.type === 'stack') {
            const itemIds = selectedRow.items.map(i => i.id);
            await deleteTeamItems(itemIds);
          }
        })();
        return;
      }

      // Cmd+Z - Undo deletion.
      if (key === 'z' && hasMeta && !hasShift && deletedItems.length > 0) {
        e.preventDefault();
        // Note: Undo for team items would require a restore API.
        // For now, just reload the items from the server.
        (async () => {
          await loadTeamItems();
          setDeletedItems([]);
        })();
        return;
      }

      // U - Unstack selected stack.
      if (key === 'u' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        if (selectedRow?.type === 'stack' && selectedRow.items.length > 1) {
          e.preventDefault();
          unstackTeamItems(selectedRow.stack.stackId);
        }
        return;
      }

      // E or H - Toggle expand/collapse on selected row(s).
      if ((key === 'e' || key === 'h') && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        e.preventDefault();
        
        // If multi-select is active, expand all selected items.
        if (selectedIds.size > 0) {
          selectedIds.forEach(itemId => {
            toggleItemExpanded(itemId);
          });
          return;
        }
        
        // Otherwise expand the currently selected row.
        if (!selectedRow) return;
        
        if (selectedRow.type === 'stack') {
          toggleStackExpanded(selectedRow.stack.stackId);
        } else if (selectedRow.type === 'item') {
          toggleItemExpanded(selectedRow.item.id);
        }
        return;
      }

      // Navigation: j/k or ArrowDown/ArrowUp.
      // Note: Arrow keys are handled separately when preview is open for stack navigation.
      if (key === 'j' || key === 'ArrowDown') {
        e.preventDefault();
        setKeyboardNavActive(true);
        const newIndex = Math.min(selectedIndex + 1, listRows.length - 1);
        setSelectedIndex(newIndex);
        
        // If preview is open, update preview for new row and reset stack index.
        if (preview && newIndex !== selectedIndex) {
          const newRow = listRows[newIndex];
          if (newRow) {
            if (newRow.type === 'stack') {
              // Initialize stack preview for the new row.
              const previewItems = getStackPreviewItems(newRow.items);
              if (previewItems.length > 0) {
                setStackPreviewItems(previewItems);
                setStackPreviewIndex(0);
                setPreview(previewItems[0]);
              }
            } else {
              // Single item - clear stack state.
              setStackPreviewItems([]);
              setStackPreviewIndex(0);
              const newContent = getPreviewForRow(newRow);
              if (newContent) setPreview(newContent);
            }
          }
        }
        return;
      }

      if (key === 'k' || key === 'ArrowUp') {
        e.preventDefault();
        setKeyboardNavActive(true);
        const newIndex = Math.max(selectedIndex - 1, 0);
        setSelectedIndex(newIndex);
        
        // If preview is open, update preview for new row and reset stack index.
        if (preview && newIndex !== selectedIndex) {
          const newRow = listRows[newIndex];
          if (newRow) {
            if (newRow.type === 'stack') {
              // Initialize stack preview for the new row.
              const previewItems = getStackPreviewItems(newRow.items);
              if (previewItems.length > 0) {
                setStackPreviewItems(previewItems);
                setStackPreviewIndex(0);
                setPreview(previewItems[0]);
              }
            } else {
              // Single item - clear stack state.
              setStackPreviewItems([]);
              setStackPreviewIndex(0);
              const newContent = getPreviewForRow(newRow);
              if (newContent) setPreview(newContent);
            }
          }
        }
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

      // Spacebar: Quick Look style preview (images or text).
      if (key === ' ' || key === 'Spacebar') {
        e.preventDefault();

        // If preview is open, dismiss it (spacebar toggles preview on/off).
        // Arrow keys are used to navigate within stack items.
        if (preview) {
          dismissPreview();
          return;
        }

        // If hovering over an image, open preview for it (single item, no stack nav).
        if (hoveredImageId !== null) {
          const hoveredItem = teamItems.find(item => item.id === hoveredImageId);
          if (hoveredItem && (hoveredItem.imageUrl || hoveredItem.imageData)) {
            setStackPreviewItems([]);
            setStackPreviewIndex(0);
            setPreview({
              type: 'image',
              url: hoveredItem.imageUrl || `data:image/png;base64,${hoveredItem.imageData}`,
              width: hoveredItem.imageWidth || 0,
              height: hoveredItem.imageHeight || 0,
            });
            return;
          }
        }

        // Preview J/K selected row (image or text).
        if (selectedRow) {
          if (selectedRow.type === 'item') {
            // Single item - no stack navigation needed.
            setStackPreviewItems([]);
            setStackPreviewIndex(0);
            const previewContent = getPreviewForRow(selectedRow);
            if (previewContent) {
              setPreview(previewContent);
            }
          } else if (selectedRow.type === 'stack') {
            // Stack - build preview sequence and start at first item.
            const previewItems = getStackPreviewItems(selectedRow.items);
            if (previewItems.length > 0) {
              setStackPreviewItems(previewItems);
              setStackPreviewIndex(0);
              setPreview(previewItems[0]);
            }
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

      // s: Stack selected items (when multiple items are selected via x key).
      if (key === 's' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        if (selectedIds.size > 1) {
          e.preventDefault();
          // Create a new stack from selected items.
          const newStackId = crypto.randomUUID();
          const itemIds = Array.from(selectedIds);
          (async () => {
            const success = await window.teamClipboardAPI?.updateStackId(itemIds, newStackId);
            if (success) {
              // Update local state to reflect the new stack.
              setTeamItems(prev => prev.map(i => 
                itemIds.includes(i.id) ? { ...i, stackId: newStackId } : i
              ));
              setSelectedIds(new Set());
              setIsMultiSelect(false);
            }
          })();
        }
        return;
      }

      // t: Unshare from team (delete the selected team item or stack).
      if (key === 't' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        e.preventDefault();
        (async () => {
          if (selectedRow?.type === 'item') {
            await deleteTeamItem(selectedRow.item.id);
          } else if (selectedRow?.type === 'stack') {
            await deleteTeamItems(selectedRow.items.map(i => i.id));
          }
        })();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [session, listRows, selectedIndex, selectedIds, deletedItems, pasteItem, pasteStack, copyToPersonal, preview, dismissPreview, getPreviewForRow, hoveredImageId, teamItems, deleteTeamItem, deleteTeamItems, unstackTeamItems, loadTeamItems, toggleStackExpanded, toggleItemExpanded]);

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
                Sign in to Field Theory
              </h3>
              <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: theme.textSecondary }}>
                Share clipboard items with your team and sync across devices.
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
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                  }}
                >
                  {authLoading && (
                    <span style={{
                      width: '14px',
                      height: '14px',
                      border: '2px solid rgba(255,255,255,0.3)',
                      borderTopColor: '#fff',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }} />
                  )}
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
      {/* Header with sync indicator and team members toggle */}
      <div
        style={{
          marginBottom: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Background sync indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {backgroundSyncing && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '10px',
              color: theme.textSecondary,
              opacity: 0.7,
            }}>
              <span style={{
                width: '8px',
                height: '8px',
                border: '1.5px solid rgba(128,128,128,0.3)',
                borderTopColor: theme.accent,
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              syncing
            </span>
          )}
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
          {showMembers ? 'Hide' : 'Invite Others'}
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

      {/* Search input with custom placeholder */}
      <div style={{ 
        position: 'relative',
        marginBottom: selectedIds.size > 0 ? '0' : '8px',
        transition: 'margin-bottom 0.15s ease',
      }}>
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder=""
          style={{
            width: '100%',
            padding: `6px 10px 6px ${!searchQuery && !searchFocused ? '32px' : '10px'}`,
            border: `1px solid ${theme.inputBorder}`,
            borderRadius: '6px',
            fontSize: '11px',
            outline: 'none',
            boxSizing: 'border-box',
            backgroundColor: theme.inputBg,
            color: theme.text,
            transition: 'padding-left 0.1s ease',
            // @ts-ignore - prevent drag on input
            WebkitAppRegion: 'no-drag',
          }}
        />
        {/* Custom placeholder - hide when focused or has content */}
        {!searchQuery && !searchFocused && (
          <div style={{
            position: 'absolute',
            left: '10px',
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            pointerEvents: 'none',
            color: theme.textSecondary,
            fontSize: '11px',
          }}>
            <span>search...</span>
          </div>
        )}
      </div>

      {/* Team items list */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
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
              const truncated = hasText ? smartTruncateText(combinedText, 15) : null;

              const stackDragId = `stack:${stack.stackId}`;
              const isStackDragging = activeDragId === stackDragId;
              const isStackOver = overDropId === stackDragId;

              return (
                <DraggableDroppableRow
                  key={`stack-${stack.stackId}`}
                  id={stackDragId}
                  isDragging={isStackDragging}
                  isOver={isStackOver && !isStackDragging}
                  className="team-item-row"
                  onMouseEnter={() => {
                    setHoveredRowIndex(index);
                    if (!keyboardNavActive) setSelectedIndex(index);
                  }}
                  onMouseLeave={() => setHoveredRowIndex(null)}
                  onMouseMove={() => setKeyboardNavActive(false)}
                  onClick={() => pasteStack(stackItems)}
                  style={{
                    ...rowStyle,
                    cursor: activeDragId ? 'grabbing' : 'grab',
                  }}
                >
                  {/* Stack image thumbnails */}
                  {stackImages.length > 0 && (
                    <div style={{ display: 'flex', gap: '4px', marginBottom: hasText ? '8px' : '0', flexWrap: 'wrap' }}>
                      {stackImages.slice(0, 4).map((img) => (
                        <div
                          key={img.id}
                          style={{ position: 'relative', cursor: 'pointer' }}
                          onMouseEnter={() => setHoveredImageId(img.id)}
                          onMouseLeave={() => setHoveredImageId(null)}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (img.imageUrl || img.imageData) {
                              setPreview({
                                type: 'image',
                                url: img.imageUrl || `data:image/png;base64,${img.imageData}`,
                                width: img.imageWidth || 0,
                                height: img.imageHeight || 0,
                              });
                            }
                          }}
                        >
                          {img.imageUrl || img.imageData ? (
                            <img
                              src={img.imageUrl || `data:image/png;base64,${img.imageData}`}
                              alt="Screenshot preview"
                              style={{
                                height: '50px',
                                width: 'auto',
                                borderRadius: '4px',
                                border: `1px solid ${theme.border}`,
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
                              fontSize: '14px',
                            }}>
                              {img.type === 'screenshot' ? '📷' : '🖼️'}
                            </div>
                          )}
                          {/* Preview button overlay on hover */}
                          {hoveredImageId === img.id && (
                            <div
                              style={{
                                position: 'absolute',
                                inset: 0,
                                backgroundColor: 'rgba(0,0,0,0.5)',
                                borderRadius: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <span style={{ color: '#fff', fontSize: '10px', fontWeight: 500 }}>
                                Preview <KeyCap small>space</KeyCap>
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                      {stackImages.length > 4 && (
                        <div style={{
                          width: '50px',
                          height: '50px',
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

                  {/* Stack text content - match ClipboardHistory expand button design */}
                  {hasText && truncated && (
                    <>
                      {expanded ? (
                        // Expanded state: show full text with "show less" button.
                        <div style={{ marginBottom: '4px' }}>
                          <div
                            style={{
                              fontSize: '12px',
                              fontWeight: '500',
                              color: theme.text,
                              lineHeight: '1.5',
                              marginBottom: '4px',
                              whiteSpace: 'pre-wrap',
                              overflow: 'visible',
                            }}
                          >
                            {combinedText}
                          </div>
                          <button
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleStackExpanded(stack.stackId);
                            }}
                            style={{
                              background: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
                              border: 'none',
                              padding: '2px 8px',
                              fontSize: '10px',
                              fontWeight: 500,
                              color: theme.textSecondary,
                              cursor: 'pointer',
                              borderRadius: '4px',
                            }}
                          >
                            show less
                          </button>
                        </div>
                      ) : truncated.needsTruncation ? (
                        // Smart truncation: show first words ... [expand] ... last words.
                        <div style={{ marginBottom: '4px' }}>
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: '500',
                              color: theme.text,
                              lineHeight: '1.5',
                            }}
                          >
                            {truncated.firstPart}
                          </span>
                          <span style={{ color: theme.textSecondary, fontSize: '12px' }}> … </span>
                          
                          {/* Expand button in the middle */}
                          <button
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleStackExpanded(stack.stackId);
                            }}
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
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: '500',
                              color: theme.text,
                              lineHeight: '1.5',
                            }}
                          >
                            {truncated.lastPart}
                          </span>
                        </div>
                      ) : (
                        // Short text: no truncation needed.
                        <div style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
                          {combinedText}
                        </div>
                      )}
                    </>
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

                  {/* Footer row - matches ClipboardHistory design */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                    {/* Metadata - left side with stack icon (matching ClipboardHistory) */}
                    <div style={{ fontSize: '10px', color: '#FBBF24', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {/* Stack icon - layered rectangles (same as ClipboardHistory) */}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="4" y="4" width="16" height="6" rx="1" />
                        <rect x="4" y="14" width="16" height="6" rx="1" />
                      </svg>
                      <span>
                        {stackItems.length} items
                        {(() => {
                          const totalWords = stackItems.reduce((sum, item) => sum + (item.wordCount || 0), 0);
                          return totalWords > 0 ? ` • ${totalWords} words` : '';
                        })()}
                        {' • '}{formatRelativeTime(stack.createdAt)}
                      </span>
                      <InitialsBadge email={stack.createdByEmail} />
                    </div>
                    <div style={{ display: 'flex', gap: '4px', visibility: isRowSelected || isHovered ? 'visible' : 'hidden' }}>
                      <button
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          const itemIds = stackItems.map(i => i.id);
                          setUnsharingId(stack.stackId);
                          deleteTeamItems(itemIds).then(() => {
                            setTimeout(() => setUnsharingId(null), 300);
                          });
                        }}
                        disabled={unsharingId === stack.stackId}
                        style={{
                          padding: '4px 6px',
                          fontSize: '10px',
                          fontWeight: 500,
                          backgroundColor: 'transparent',
                          color: theme.textSecondary,
                          border: 'none',
                          borderRadius: '4px',
                          cursor: unsharingId === stack.stackId ? 'wait' : 'pointer',
                        }}
                      >
                        <KeyCap>t</KeyCap> {unsharingId === stack.stackId ? 'unsharing...' : 'unshare'}
                      </button>
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
                </DraggableDroppableRow>
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
            const truncated = isText && item.content ? smartTruncateText(item.content, 15) : null;
            const showSmartTruncation = truncated && truncated.needsTruncation && !isExpanded;

            const itemDragId = `item:${item.id}`;
            const isItemDragging = activeDragId === itemDragId;
            const isItemOver = overDropId === itemDragId;

            return (
              <DraggableDroppableRow
                key={item.id}
                id={itemDragId}
                isDragging={isItemDragging}
                isOver={isItemOver && !isItemDragging}
                className="team-item-row"
                onMouseEnter={() => {
                  setHoveredRowIndex(index);
                  if (!keyboardNavActive) setSelectedIndex(index);
                }}
                onMouseLeave={() => setHoveredRowIndex(null)}
                onMouseMove={() => setKeyboardNavActive(false)}
                onClick={() => pasteItem(item)}
                style={{
                  ...rowStyle,
                  cursor: activeDragId ? 'grabbing' : 'grab',
                }}
              >
                {/* Content section */}
                <div>
                  {/* Image/screenshot - show thumbnail with preview */}
                  {isImage && (
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <div
                        style={{ position: 'relative', flexShrink: 0, cursor: 'pointer' }}
                        onMouseEnter={() => setHoveredImageId(item.id)}
                        onMouseLeave={() => setHoveredImageId(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (item.imageUrl || item.imageData) {
                            setPreview({
                              type: 'image',
                              url: item.imageUrl || `data:image/png;base64,${item.imageData}`,
                              width: item.imageWidth || 0,
                              height: item.imageHeight || 0,
                            });
                          }
                        }}
                      >
                        {item.imageUrl || item.imageData ? (
                          <img
                            src={item.imageUrl || `data:image/png;base64,${item.imageData}`}
                            alt="Screenshot preview"
                            style={{
                              height: '50px',
                              width: 'auto',
                              borderRadius: '4px',
                              border: `1px solid ${theme.border}`,
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
                          }}>
                            {item.type === 'screenshot' ? '📷' : '🖼️'}
                          </div>
                        )}
                        {/* Preview button overlay on hover */}
                        {hoveredImageId === item.id && (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              backgroundColor: 'rgba(0,0,0,0.5)',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <span style={{ color: '#fff', fontSize: '10px', fontWeight: 500 }}>
                              Preview <KeyCap small>space</KeyCap>
                            </span>
                          </div>
                        )}
                      </div>
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
                    {isText && item.wordCount && (
                      <>
                        <span>{item.wordCount} words</span>
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
                      onClick={(e) => {
                        e.stopPropagation();
                        setUnsharingId(item.id);
                        deleteTeamItem(item.id).then(() => {
                          setTimeout(() => setUnsharingId(null), 300);
                        });
                      }}
                      disabled={unsharingId === item.id}
                      style={{
                        padding: '4px 6px',
                        fontSize: '10px',
                        fontWeight: 500,
                        backgroundColor: 'transparent',
                        color: theme.textSecondary,
                        border: 'none',
                        borderRadius: '4px',
                        cursor: unsharingId === item.id ? 'wait' : 'pointer',
                      }}
                    >
                      <KeyCap>t</KeyCap> {unsharingId === item.id ? 'unsharing...' : 'unshare'}
                    </button>
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
              </DraggableDroppableRow>
            );
          })
        )}
      </div>

      {/* Drag overlay - shows ghost element matching original row size */}
      <DragOverlay>
        {activeDragId ? (() => {
          // Find the dragged item/stack to show a content preview.
          const [type, id] = activeDragId.split(':');
          const row = listRows.find(r => 
            type === 'stack' 
              ? r.type === 'stack' && r.stack.stackId === id
              : r.type === 'item' && r.item.id === id
          );
          
          // Build preview text from the row content.
          let previewText = type === 'stack' ? 'Stack' : 'Item';
          if (row?.type === 'stack') {
            previewText = combineStackText(row.items).slice(0, 80) || 'Stack';
          } else if (row?.type === 'item') {
            previewText = row.item.content?.slice(0, 80) || 'Item';
          }
          
          return (
            <div
              style={{
                width: '320px',
                padding: '12px 16px',
                backgroundColor: theme.bgSecondary,
                border: `1px solid ${theme.border}`,
                borderRadius: '6px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                fontSize: '12px',
                color: theme.text,
                opacity: 0.9,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {previewText}
            </div>
          );
        })() : null}
      </DragOverlay>
      </DndContext>

      {/* Keyboard shortcuts bar - matches TodoView style */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 16px',
        borderTop: `1px solid ${theme.border}`,
        fontSize: '10px',
        color: theme.textSecondary,
      }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <span><KeyCap small>j</KeyCap><KeyCap small>k</KeyCap> navigate</span>
          <span><KeyCap small>x</KeyCap> select</span>
          <span><KeyCap small>t</KeyCap> unshare</span>
          <span><KeyCap small>c</KeyCap> copy</span>
          <span><KeyCap small>/</KeyCap> search</span>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <span><KeyCap small>space</KeyCap> preview</span>
          <span><KeyCap small>↵</KeyCap> paste</span>
          <span><KeyCap small>tab</KeyCap> view</span>
        </div>
      </div>

      {/* CSS animations for preview, loading spinner, and item transitions */}
      <style>{`
        @keyframes previewFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes previewFadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes itemFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .team-item-row {
          animation: itemFadeIn 0.15s ease-out;
        }
      `}</style>

      {/* Preview modal - Quick Look style for images and text */}
      {preview && (
        <div
          onClick={dismissPreview}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px',
            zIndex: 10000,
            cursor: 'pointer',
            animation: previewClosing ? 'previewFadeOut 0.15s ease-in forwards' : 'previewFadeIn 0.15s ease-out',
          }}
        >
          {preview.type === 'image' ? (
            <img
              src={preview.url}
              alt="Preview"
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: '90vw',
                maxHeight: '90vh',
                objectFit: 'contain',
                borderRadius: '8px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              }}
            />
          ) : (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: '90vw',
                maxHeight: '90vh',
                overflow: 'auto',
                backgroundColor: theme.bgSecondary,
                borderRadius: '8px',
                padding: '24px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              }}
            >
              <pre style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: '13px',
                lineHeight: 1.6,
                color: theme.text,
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              }}>
                {preview.content}
              </pre>
            </div>
          )}
          
          {/* Stack position indicator - shows 1/4 style when viewing a stack with multiple items */}
          {stackPreviewItems.length > 1 && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                bottom: '24px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                borderRadius: '12px',
                padding: '6px 12px',
                color: '#fff',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'default',
              }}
            >
              {stackPreviewIndex + 1} / {stackPreviewItems.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
