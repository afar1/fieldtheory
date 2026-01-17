// =============================================================================
// SharedContextView - Shared clipboard with auth gating and caching.
// Adapted from ClipboardHistory's rendering with TeamView's auth flow.
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
// =============================================================================

const IMAGE_CACHE_KEY = 'sharedContextImageCache';
const IMAGE_CACHE_MAX_SIZE = 50;
const blobUrlCache = new Map<string, string>();

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

function saveImageCacheMetadata(cache: Map<string, { timestamp: number; base64: string }>) {
  try {
    const entries = Array.from(cache.entries());
    if (entries.length > IMAGE_CACHE_MAX_SIZE) {
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toKeep = entries.slice(-IMAGE_CACHE_MAX_SIZE);
      cache = new Map(toKeep);
    }
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch (e) {
    // Ignore storage errors.
  }
}

async function getCachedImageUrl(imageUrl: string | null, imageData: string | null, itemId: string): Promise<string> {
  if (imageData) {
    return `data:image/png;base64,${imageData}`;
  }
  if (!imageUrl) {
    return '';
  }
  if (blobUrlCache.has(itemId)) {
    return blobUrlCache.get(itemId)!;
  }
  const metadata = getImageCacheMetadata();
  const cached = metadata.get(itemId);
  if (cached?.base64) {
    // Validate base64 is a real image (PNG starts with iVBORw0, JPEG with /9j/).
    // Corrupted entries (e.g., JSON stored as base64) should be skipped.
    const isValidImage = cached.base64.startsWith('iVBORw0') || cached.base64.startsWith('/9j/');
    if (isValidImage) {
      const blobUrl = `data:image/png;base64,${cached.base64}`;
      blobUrlCache.set(itemId, blobUrl);
      return blobUrl;
    } else {
      // Remove corrupted cache entry.
      metadata.delete(itemId);
      saveImageCacheMetadata(metadata);
    }
  }
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    blobUrlCache.set(itemId, blobUrl);
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
    // Don't return the failed URL - it will also fail in the browser causing broken image icons.
    // Return empty string so the placeholder is shown instead.
    return '';
  }
}

function getCachedImageUrlSync(imageUrl: string | null, imageData: string | null, itemId: string): string {
  if (imageData) {
    // Validate imageData is a real image before using it.
    const isValidImage = imageData.startsWith('iVBORw0') || imageData.startsWith('/9j/');
    if (isValidImage) {
      return `data:image/png;base64,${imageData}`;
    }
    // imageData is corrupted (e.g., JSON stored as base64), skip it.
    return '';
  }
  if (!imageUrl) {
    return '';
  }
  if (blobUrlCache.has(itemId)) {
    return blobUrlCache.get(itemId)!;
  }
  const metadata = getImageCacheMetadata();
  const cached = metadata.get(itemId);
  if (cached?.base64) {
    // Validate cached base64 is a real image.
    const isValidImage = cached.base64.startsWith('iVBORw0') || cached.base64.startsWith('/9j/');
    if (isValidImage) {
      const blobUrl = `data:image/png;base64,${cached.base64}`;
      blobUrlCache.set(itemId, blobUrl);
      return blobUrl;
    }
    // Remove corrupted cache entry.
    metadata.delete(itemId);
    saveImageCacheMetadata(metadata);
  }
  return '';
}

// =============================================================================
// CachedImage Component
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
  const [src, setSrc] = useState<string>(() => 
    getCachedImageUrlSync(imageUrl, imageData, itemId)
  );
  const [loadError, setLoadError] = useState<string | null>(null);


  useEffect(() => {
    if (src) return;
    let cancelled = false;
    getCachedImageUrl(imageUrl, imageData, itemId).then(url => {
      if (!cancelled && url) {
        setSrc(url);
      }
    });
    return () => { cancelled = true; };
  }, [imageUrl, imageData, itemId, src]);

  if (!src) {
    return (
      <div style={{
        ...style,
        backgroundColor: 'rgba(128, 128, 128, 0.08)',
        borderRadius: '4px',
      }} />
    );
  }

  return (
    <img 
      src={src} 
      alt={alt} 
      style={style}
      onError={() => {
        setLoadError('Failed to load');
      }}
    />
  );
}

// =============================================================================
// Types
// =============================================================================

interface SharedClipboardItem {
  id: string;
  userId: string;
  sharedByEmail: string | null;
  type: 'text' | 'image' | 'transcript' | 'screenshot';
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

interface SharedStackInfo {
  stackId: string;
  itemCount: number;
  imageCount: number;
  textCount: number;
  createdByEmail: string | null;
  createdAt: number;
}

type SharedListRow =
  | { type: 'item'; item: SharedClipboardItem }
  | { type: 'stack'; stack: SharedStackInfo; items: SharedClipboardItem[]; expanded: boolean };

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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function estimateWordsPerLine(containerWidth: number | null): number {
  if (!containerWidth || containerWidth <= 0) {
    return 10;
  }
  const textWidth = Math.max(containerWidth - 60, 100);
  const avgCharWidth = 7;
  const avgWordChars = 6;
  const charsPerLine = Math.floor(textWidth / avgCharWidth);
  const wordsPerLine = Math.floor(charsPerLine / avgWordChars);
  return Math.max(wordsPerLine, 5);
}

function smartTruncateText(
  text: string, 
  _targetWords: number = 15,
  containerWidth: number | null = null
): { 
  firstPart: string; 
  lastPart: string; 
  needsTruncation: boolean;
  fullText: string;
} {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  const lastPartWords = 5;
  
  if (words.length <= 15) {
    return { 
      firstPart: trimmed, 
      lastPart: '', 
      needsTruncation: false,
      fullText: trimmed,
    };
  }
  
  const wordsPerLine = estimateWordsPerLine(containerWidth);
  const wordsFor3Lines = wordsPerLine * 3;
  
  let firstPartWords: number;
  const totalNeeded = wordsFor3Lines + lastPartWords + 2;
  
  if (words.length >= totalNeeded) {
    firstPartWords = wordsFor3Lines;
  } else {
    const totalNeeded2 = wordsPerLine * 2 + lastPartWords + 2;
    if (words.length >= totalNeeded2) {
      firstPartWords = wordsPerLine * 2;
    } else {
      const totalNeeded1 = wordsPerLine + lastPartWords + 2;
      if (words.length >= totalNeeded1) {
        firstPartWords = wordsPerLine;
      } else {
        return {
          firstPart: trimmed,
          lastPart: '',
          needsTruncation: false,
          fullText: trimmed,
        };
      }
    }
  }
  
  const firstWords = words.slice(0, firstPartWords);
  const lastWords = words.slice(-lastPartWords);
  
  return {
    firstPart: firstWords.join(' '),
    lastPart: '...' + lastWords.join(' '),
    needsTruncation: true,
    fullText: trimmed,
  };
}

// Sorted chronologically (oldest first, newest last) for natural reading order.
function combineStackText(items: SharedClipboardItem[]): string {
  return items
    .filter(item => (item.type === 'text' || item.type === 'transcript') && item.content)
    .sort((a, b) => a.createdAt - b.createdAt) // Oldest first, newest last
    .map(item => item.content!)
    .join('\n\n');
}

// Format email to "First Name Last Initial" (e.g., "andrew.mfarah@gmail.com" → "Andrew F.")
function formatNameFromEmail(email: string | null): string {
  if (!email) return '?';
  const localPart = email.split('@')[0];
  // Split by common separators (dot, underscore, hyphen).
  const parts = localPart.split(/[._-]/).filter(Boolean);
  
  if (parts.length >= 2) {
    // Capitalize first name, take first letter of last name.
    const firstName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
    const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
    return `${firstName} ${lastInitial}.`;
  }
  
  // Single part - just capitalize it.
  return parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase() : '?';
}

// =============================================================================
// DraggableDroppableRow
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
        outline: isOver ? '2px solid #8b5cf6' : 'none',
        outlineOffset: '-2px',
      }}
    >
      {children}
    </div>
  );
}

// =============================================================================
// KeyCap component
// =============================================================================

function KeyCap({ children, small = false, style }: { children: React.ReactNode; small?: boolean; style?: React.CSSProperties }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: small ? '1px 4px' : '2px 5px',
        fontSize: small ? '9px' : '10px',
        fontWeight: 500,
        color: '#555',
        backgroundColor: '#e8e8e8',
        borderRadius: '3px',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// =============================================================================
// InitialsBadge - shows "First Name Last Initial" (e.g., "Andrew F.").
// =============================================================================

function InitialsBadge({ email }: { email: string | null }) {
  const displayName = formatNameFromEmail(email);
  
  const getColorFromEmail = (email: string | null): string => {
    if (!email) return '#888';
    let hash = 0;
    for (let i = 0; i < email.length; i++) {
      hash = email.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 65%, 55%)`;
  };
  
  return (
    <span
      style={{
        fontSize: '10px',
        fontWeight: 500,
        color: getColorFromEmail(email),
        marginLeft: '4px',
      }}
      title={email || 'Unknown'}
    >
      {displayName}
    </span>
  );
}

// =============================================================================
// Component
// =============================================================================

interface SharedContextViewProps {
  onOpenSketch?: (imageDataUrl: string, width: number, height: number) => void;
  onSubmitFeedback?: (text: string, imageBase64?: string) => Promise<void>;
  showMembers?: boolean;
  onToggleMembers?: () => void;
}

export default function SharedContextView({ onOpenSketch, onSubmitFeedback, showMembers: showMembersProp, onToggleMembers }: SharedContextViewProps = {}) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Prevent double fetch on mount.
  const hasLoadedRef = useRef(false);

  // Auth state.
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  
  // OTP auth state.
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);

  // Team members state.
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [addMemberEmail, setAddMemberEmail] = useState('');
  const [addMemberError, setAddMemberError] = useState<string | null>(null);
  const [addingMember, setAddingMember] = useState(false);
  const [showMembersInternal, setShowMembersInternal] = useState(() => {
    const saved = localStorage.getItem('teamMembersVisible');
    return saved === 'true';
  });
  
  // Use prop if provided, otherwise use internal state.
  const showMembers = showMembersProp !== undefined ? showMembersProp : showMembersInternal;
  const setShowMembers = onToggleMembers || setShowMembersInternal;

  // Team items state - initialized from cache for instant display.
  const [teamItems, setTeamItems] = useState<SharedClipboardItem[]>(() => {
    try {
      const cached = localStorage.getItem('sharedContextItemsCache');
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      // Ignore parse errors, start fresh.
    }
    return [];
  });
  const [itemsLoading, setItemsLoading] = useState(false);
  const [copyingToPersonal, setCopyingToPersonal] = useState<string | null>(null);

  // Selection and navigation state.
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoveredRowIndex, setHoveredRowIndex] = useState<number | null>(null);
  const [keyboardNavActive, setKeyboardNavActive] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());
  
  // Multi-select state.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  
  // Undo state.
  const [deletedItems, setDeletedItems] = useState<SharedClipboardItem[]>([]);
  
  // Copy feedback state.
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  
  // Track which item is being unshared.
  const [unsharingId, setUnsharingId] = useState<string | null>(null);

  // dnd-kit drag state.
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overDropId, setOverDropId] = useState<string | null>(null);

  // Search state.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const searchDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Container width for text truncation.
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  // Scroll indicator.
  const [hasItemsAbove, setHasItemsAbove] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Pointer sensor with distance activation.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  // Image hover and preview state.
  const [hoveredImageId, setHoveredImageId] = useState<string | null>(null);
  type PreviewContent =
    | { type: 'image'; url: string; width: number; height: number }
    | { type: 'text'; content: string };
  const [preview, setPreview] = useState<PreviewContent | null>(null);
  const [previewClosing, setPreviewClosing] = useState(false);
  const [stackPreviewIndex, setStackPreviewIndex] = useState(0);
  const [stackPreviewItems, setStackPreviewItems] = useState<PreviewContent[]>([]);

  // Build the preview sequence for a stack.
  const getStackPreviewItems = useCallback((items: SharedClipboardItem[]): PreviewContent[] => {
    const previewItems: PreviewContent[] = [];
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
    const combinedText = combineStackText(items);
    if (combinedText) {
      previewItems.push({ type: 'text', content: combinedText });
    }
    return previewItems;
  }, []);

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

  const getPreviewForRow = useCallback((row: SharedListRow): PreviewContent | null => {
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

  // Check if element is fully visible in container.
  const isElementFullyVisible = useCallback((element: HTMLElement, container: HTMLElement): boolean => {
    const elementRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom;
  }, []);

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!supabase) {
      setCheckingAuth(false);
      return;
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      // IMPORTANT: Must set sync session BEFORE updating React state.
      // Otherwise, the useEffect that calls loadTeamItems() fires before
      // the main process has the session, causing queryItems to return empty.
      if (session) {
        await window.clipboardAPI?.setSyncSession?.(session.access_token, session.refresh_token);
      }
      setSession(session);
      setCheckingAuth(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log(`[SharedContextView] Auth event: ${event}, session: ${session ? 'present' : 'null'}`);
      // IMPORTANT: Must set sync session BEFORE updating React state.
      // Otherwise, the useEffect that calls loadTeamItems() fires before
      // the main process has the session, causing queryItems to return empty.
      if (session) {
        await window.clipboardAPI?.setSyncSession?.(session.access_token, session.refresh_token);
      } else if (event === 'SIGNED_OUT') {
        // Only clear on explicit sign-out, not on token refresh failures.
        console.log(`[SharedContextView] User signed out - clearing sync session`);
        window.clipboardAPI?.clearSyncSession?.();
      } else {
        console.log(`[SharedContextView] Session became null after ${event} event - not clearing main process session`);
      }
      setSession(session);
      setCheckingAuth(false);
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
    if (!window.authAPI?.requestOtp) {
      setAuthError('OTP auth not available');
      setIsRequestingOtp(false);
      return;
    }
    const result = await window.authAPI.requestOtp(email);
    if (result?.error) {
      setAuthError(result.error);
    } else {
      setOtpSent(true);
    }
    setIsRequestingOtp(false);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = authEmail.toLowerCase().trim();
    const token = otpCode.trim();
    if (!email || !token) {
      setAuthError('Please enter your email and the code from your inbox');
      return;
    }
    setIsVerifyingOtp(true);
    setAuthError(null);
    if (!window.authAPI?.verifyOtp) {
      setAuthError('OTP verification not available');
      setIsVerifyingOtp(false);
      return;
    }
    const result = await window.authAPI.verifyOtp(email, token);
    if (result?.error) {
      setAuthError(result.error);
    } else if (result?.session) {
      if (supabase) {
        await supabase.auth.setSession({
          access_token: result.session.access_token,
          refresh_token: result.session.refresh_token,
        });
      }
      setSession(result.session);
      setAuthEmail('');
      setOtpCode('');
      setOtpSent(false);
      setSuccessMessage(null);
    } else {
      setAuthError('Verification failed - no session returned');
    }
    setIsVerifyingOtp(false);
  };

  // ---------------------------------------------------------------------------
  // Team Members
  // ---------------------------------------------------------------------------

  const loadTeamMembersRef = useRef<() => Promise<void>>();
  loadTeamMembersRef.current = async () => {
    if (!window.sharedClipboardAPI) return;
    setMembersLoading(true);
    const members = await window.sharedClipboardAPI.getTeamMembers();
    setTeamMembers(members);
    setMembersLoading(false);
  };

  const loadTeamMembers = useCallback(async () => {
    await loadTeamMembersRef.current?.();
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
    const result = await window.sharedClipboardAPI?.addTeamMember(email);
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
    const result = await window.sharedClipboardAPI?.removeTeamMember(membershipId);
    if (result?.success) {
      await loadTeamMembers();
      await loadTeamItems();
    }
  };

  // ---------------------------------------------------------------------------
  // Team Items
  // ---------------------------------------------------------------------------

  const loadTeamItems = useCallback(async () => {
    if (!window.sharedClipboardAPI) return;
    
    setItemsLoading(true);
    
    // Clear the in-memory blob URL cache. Fresh items from Supabase have fresh
    // signed URLs, so we don't want stale blob URLs pointing to old fetches.
    blobUrlCache.clear();
    
    const items = await window.sharedClipboardAPI.queryItems({ limit: 100 });
    setTeamItems(items);
    
    // Save to cache for instant display next time.
    try {
      localStorage.setItem('sharedContextItemsCache', JSON.stringify(items));
    } catch (e) {
      // Ignore storage errors.
    }
    
    // Pre-cache images in the background.
    items
      .filter(item => item.imageUrl && !item.imageData)
      .forEach(item => {
        getCachedImageUrl(item.imageUrl, item.imageData, item.id).catch(() => {});
      });
    
    setItemsLoading(false);
  }, []);

  // ---------------------------------------------------------------------------
  // dnd-kit drag handlers
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

    const [activeType, activeId] = (active.id as string).split(':');
    const [overType, overId] = (over.id as string).split(':');

    if (activeType === 'item') {
      const draggedItemId = activeId;
      if (overType === 'stack') {
        await window.sharedClipboardAPI?.updateStackId([draggedItemId], overId);
      } else if (overType === 'item') {
        if (draggedItemId !== overId) {
          const newStackId = crypto.randomUUID();
          await window.sharedClipboardAPI?.updateStackId([draggedItemId, overId], newStackId);
        }
      }
    } else if (activeType === 'stack') {
      const draggedStackId = activeId;
      if (overType === 'stack' && draggedStackId !== overId) {
        const stackItems = teamItems.filter(i => i.stackId === draggedStackId);
        if (stackItems.length) {
          const itemIds = stackItems.map(i => i.id);
          await window.sharedClipboardAPI?.updateStackId(itemIds, overId);
        }
      } else if (overType === 'item') {
        await window.sharedClipboardAPI?.updateStackId([overId], draggedStackId);
      }
    }
  }, [teamItems]);

  // ---------------------------------------------------------------------------
  // Item Actions
  // ---------------------------------------------------------------------------

  const copyToPersonal = useCallback(async (teamItemId: string) => {
    if (!window.sharedClipboardAPI) return;
    setCopyingToPersonal(teamItemId);
    await window.sharedClipboardAPI.copyToPersonal(teamItemId);
    setCopyingToPersonal(null);
  }, []);

  const pasteItem = useCallback(async (item: SharedClipboardItem) => {
    if (!window.clipboardAPI || !window.sharedClipboardAPI) return;
    const localId = await window.sharedClipboardAPI.copyToPersonal(item.id);
    if (localId) {
      await window.clipboardAPI.pasteItem(localId);
      await window.clipboardAPI.closeWindow();
    }
  }, []);

  const pasteStack = useCallback(async (stackItems: SharedClipboardItem[]) => {
    if (!window.clipboardAPI || !window.sharedClipboardAPI) return;
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

  // Copy shared item to system clipboard (via local copy first).
  const copyItemToClipboard = useCallback(async (item: SharedClipboardItem, rowKey: string) => {
    if (!window.clipboardAPI || !window.sharedClipboardAPI) return;
    const localId = await window.sharedClipboardAPI.copyToPersonal(item.id);
    if (localId) {
      await window.clipboardAPI.copyItem(localId);
      setCopiedItemId(rowKey);
      setTimeout(() => setCopiedItemId(null), 1500);
    }
  }, []);

  // Copy stack: concatenate text (oldest first) or copy first image.
  const copyStackToClipboard = useCallback(async (stackItems: SharedClipboardItem[], rowKey: string) => {
    if (!window.clipboardAPI || !window.sharedClipboardAPI) return;
    
    const sorted = [...stackItems].sort((a, b) => 
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const textParts: string[] = [];
    let imageItem: SharedClipboardItem | null = null;
    
    for (const item of sorted) {
      if ((item.type === 'text' || item.type === 'transcript') && item.content) {
        textParts.push(item.content);
      } else if ((item.type === 'image' || item.type === 'screenshot') && (item.imageData || item.imageUrl) && !imageItem) {
        imageItem = item;
      }
    }
    
    if (textParts.length > 0) {
      await navigator.clipboard.writeText(textParts.join('\n\n'));
    } else if (imageItem) {
      const localId = await window.sharedClipboardAPI.copyToPersonal(imageItem.id);
      if (localId) await window.clipboardAPI.copyItem(localId);
    }
    
    setCopiedItemId(rowKey);
    setTimeout(() => setCopiedItemId(null), 1500);
  }, []);

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

  const deleteTeamItem = useCallback(async (itemId: string) => {
    if (!window.sharedClipboardAPI) return;
    const item = teamItems.find(i => i.id === itemId);
    if (item) {
      setDeletedItems([item]);
    }
    const success = await window.sharedClipboardAPI.deleteItem(itemId);
    if (success) {
      setTeamItems(prev => prev.filter(i => i.id !== itemId));
    }
  }, [teamItems]);

  const deleteTeamItems = useCallback(async (itemIds: string[]) => {
    if (!window.sharedClipboardAPI) return;
    const itemsToDelete = teamItems.filter(i => itemIds.includes(i.id));
    setDeletedItems(itemsToDelete);
    for (const id of itemIds) {
      await window.sharedClipboardAPI.deleteItem(id);
    }
    setTeamItems(prev => prev.filter(i => !itemIds.includes(i.id)));
  }, [teamItems]);

  const unstackTeamItems = useCallback(async (stackId: string) => {
    if (!window.sharedClipboardAPI) return;
    const stackItems = teamItems.filter(i => i.stackId === stackId);
    const itemIds = stackItems.map(i => i.id);
    const success = await window.sharedClipboardAPI.updateStackId(itemIds, null);
    if (success) {
      setTeamItems(prev => prev.map(i => 
        itemIds.includes(i.id) ? { ...i, stackId: null } : i
      ));
    }
  }, [teamItems]);

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
  // Build List Rows
  // ---------------------------------------------------------------------------

  const buildListRows = useCallback((): SharedListRow[] => {
    const rows: SharedListRow[] = [];
    const seenStackIds = new Set<string>();

    const searchLower = debouncedSearchQuery.toLowerCase().trim();
    const filteredItems = searchLower
      ? teamItems.filter(item => {
          if (item.content?.toLowerCase().includes(searchLower)) return true;
          if (item.improvedContent?.toLowerCase().includes(searchLower)) return true;
          if (item.sharedByEmail?.toLowerCase().includes(searchLower)) return true;
          return false;
        })
      : teamItems;

    for (const item of filteredItems) {
      if (item.stackId) {
        if (!seenStackIds.has(item.stackId)) {
          seenStackIds.add(item.stackId);
          const stackItems = filteredItems.filter(i => i.stackId === item.stackId);
          const imageCount = stackItems.filter(i => i.type === 'image' || i.type === 'screenshot').length;
          const textCount = stackItems.filter(i => i.type === 'text' || i.type === 'transcript').length;
          
          const stackInfo: SharedStackInfo = {
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
      } else {
        rows.push({ type: 'item', item });
      }
    }

    return rows;
  }, [teamItems, expandedStacks, debouncedSearchQuery]);

  const listRows = useMemo(() => buildListRows(), [buildListRows]);

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (session && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadTeamMembers();
      // Always fetch fresh data from Supabase. The localStorage cache is just for
      // instant display while real data loads. Signed URLs in cached items expire,
      // so we must always refresh to get valid URLs.
      loadTeamItems();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Subscribe to realtime events for team items.
  useEffect(() => {
    if (!session || !window.sharedClipboardAPI) return;

    const updateCache = (items: SharedClipboardItem[]) => {
      try {
        localStorage.setItem('sharedContextItemsCache', JSON.stringify(items));
      } catch (e) {
        // Ignore storage errors.
      }
    };

    const unsubAdd = window.sharedClipboardAPI.onTeamItemAdded?.((item) => {
      setTeamItems(prev => {
        // Avoid duplicates - check if item already exists.
        if (prev.some(i => i.id === item.id)) {
          return prev;
        }
        // Add new item at the beginning (most recent first).
        const next = [item, ...prev];
        updateCache(next);
        // Pre-cache the image if it has one.
        if (item.imageUrl && !item.imageData) {
          getCachedImageUrl(item.imageUrl, item.imageData, item.id).catch(() => {});
        }
        return next;
      });
    });

    const unsubUpdate = window.sharedClipboardAPI.onTeamItemUpdated?.((item) => {
      setTeamItems(prev => {
        const next = prev.map(i => i.id === item.id ? item : i);
        updateCache(next);
        return next;
      });
    });

    const unsubDelete = window.sharedClipboardAPI.onTeamItemDeleted?.((id) => {
      setTeamItems(prev => {
        const next = prev.filter(i => i.id !== id);
        updateCache(next);
        return next;
      });
    });

    return () => {
      unsubAdd?.();
      unsubUpdate?.();
      unsubDelete?.();
    };
  }, [session]);

  // Reset selection when list rows change.
  useEffect(() => {
    if (selectedIndex >= listRows.length && listRows.length > 0) {
      setSelectedIndex(listRows.length - 1);
    } else if (listRows.length === 0) {
      setSelectedIndex(0);
    }
  }, [listRows.length, selectedIndex]);

  // Persist showMembers panel state (only if using internal state).
  useEffect(() => {
    if (showMembersProp === undefined) {
      localStorage.setItem('teamMembersVisible', String(showMembers));
    }
  }, [showMembers, showMembersProp]);

  // Debounce search query.
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

  // Track scroll position.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const handleScroll = () => {
      setHasItemsAbove(list.scrollTop > 20);
    };
    list.addEventListener('scroll', handleScroll, { passive: true });
    return () => list.removeEventListener('scroll', handleScroll);
  }, []);

  // Delay showing scroll-to-top button by 500ms to avoid flicker.
  useEffect(() => {
    if (hasItemsAbove) {
      const timer = setTimeout(() => setShowScrollTop(true), 500);
      return () => clearTimeout(timer);
    } else {
      setShowScrollTop(false);
    }
  }, [hasItemsAbove]);

  // Measure container width for text truncation.
  useEffect(() => {
    if (!listRef.current) return;
    const updateWidth = () => {
      if (listRef.current) {
        setContainerWidth(listRef.current.getBoundingClientRect().width);
      }
    };
    updateWidth();
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(listRef.current);
    return () => resizeObserver.disconnect();
  }, []);

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
  // Keyboard Navigation
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle keys when this view is hidden (e.g., when sketch mode is active).
      // offsetParent is null when element or any ancestor has display:none.
      if (containerRef.current?.offsetParent === null) {
        return;
      }

      const key = e.key;
      const hasMeta = e.metaKey;
      const hasShift = e.shiftKey;
      const hasCtrl = e.ctrlKey;
      const hasAlt = e.altKey;

      // / - Focus search input.
      if (key === '/' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) return;
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }

      if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) return;

      // Escape - dismiss preview, clear selection, or close window.
      if (key === 'Escape') {
        if (preview) {
          e.preventDefault();
          dismissPreview();
          return;
        }
        if (selectedIds.size > 0) {
          e.preventDefault();
          setSelectedIds(new Set());
          setIsMultiSelect(false);
          return;
        }
        window.clipboardAPI?.closeWindow();
        return;
      }

      if (!session || listRows.length === 0) return;

      const selectedRow = listRows[selectedIndex];

      // Arrow keys for stack preview navigation.
      if (preview && stackPreviewItems.length > 1) {
        if (key === 'ArrowRight' || key === 'ArrowDown') {
          e.preventDefault();
          if (stackPreviewIndex < stackPreviewItems.length - 1) {
            setStackPreviewIndex(stackPreviewIndex + 1);
            setPreview(stackPreviewItems[stackPreviewIndex + 1]);
          } else {
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

      // Cmd+C - Copy selected/hovered item to clipboard.
      if (key === 'c' && hasMeta && !hasShift) {
        if (selectedRow?.type === 'item') {
          e.preventDefault();
          copyItemToClipboard(selectedRow.item, `item-${selectedRow.item.id}`);
        } else if (selectedRow?.type === 'stack' && selectedRow.items.length > 0) {
          e.preventDefault();
          copyStackToClipboard(selectedRow.items, `stack-${selectedRow.items.map(i => i.id).join(',')}`);
        }
        return;
      }

      // X - Toggle selection.
      if (key === 'x' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        e.preventDefault();
        const itemIdsToToggle: string[] = [];
        if (selectedRow?.type === 'item') {
          itemIdsToToggle.push(selectedRow.item.id);
        } else if (selectedRow?.type === 'stack') {
          selectedRow.items.forEach(i => itemIdsToToggle.push(i.id));
        }
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

      // Delete / Backspace.
      if (key === 'Delete' || key === 'Backspace') {
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

      // U - Unstack.
      if (key === 'u' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        if (selectedRow?.type === 'stack' && selectedRow.items.length > 1) {
          e.preventDefault();
          unstackTeamItems(selectedRow.stack.stackId);
        }
        return;
      }

      // E or H - Toggle expand/collapse.
      if ((key === 'e' || key === 'h') && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        e.preventDefault();
        if (selectedIds.size > 0) {
          selectedIds.forEach(itemId => {
            toggleItemExpanded(itemId);
          });
          return;
        }
        if (!selectedRow) return;
        if (selectedRow.type === 'stack') {
          toggleStackExpanded(selectedRow.stack.stackId);
        } else if (selectedRow.type === 'item') {
          toggleItemExpanded(selectedRow.item.id);
        }
        return;
      }

      // j/k navigation.
      if (key === 'j' || key === 'ArrowDown') {
        e.preventDefault();
        setKeyboardNavActive(true);
        const newIndex = Math.min(selectedIndex + 1, listRows.length - 1);
        setSelectedIndex(newIndex);
        if (preview && newIndex !== selectedIndex) {
          const newRow = listRows[newIndex];
          if (newRow) {
            if (newRow.type === 'stack') {
              const previewItems = getStackPreviewItems(newRow.items);
              if (previewItems.length > 0) {
                setStackPreviewItems(previewItems);
                setStackPreviewIndex(0);
                setPreview(previewItems[0]);
              }
            } else {
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
        if (preview && newIndex !== selectedIndex) {
          const newRow = listRows[newIndex];
          if (newRow) {
            if (newRow.type === 'stack') {
              const previewItems = getStackPreviewItems(newRow.items);
              if (previewItems.length > 0) {
                setStackPreviewItems(previewItems);
                setStackPreviewIndex(0);
                setPreview(previewItems[0]);
              }
            } else {
              setStackPreviewItems([]);
              setStackPreviewIndex(0);
              const newContent = getPreviewForRow(newRow);
              if (newContent) setPreview(newContent);
            }
          }
        }
        return;
      }

      // Enter: Paste.
      if (key === 'Enter' && !hasMeta && !hasShift) {
        e.preventDefault();
        if (selectedRow?.type === 'item') {
          pasteItem(selectedRow.item);
        } else if (selectedRow?.type === 'stack') {
          pasteStack(selectedRow.items);
        }
        return;
      }

      // Spacebar: Preview.
      if (key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        if (preview) {
          dismissPreview();
          return;
        }
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
        if (selectedRow) {
          if (selectedRow.type === 'item') {
            setStackPreviewItems([]);
            setStackPreviewIndex(0);
            const previewContent = getPreviewForRow(selectedRow);
            if (previewContent) {
              setPreview(previewContent);
            }
          } else if (selectedRow.type === 'stack') {
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

      // c: Copy to clipboard (matches Cmd+C behavior).
      if (key === 'c' && !hasMeta) {
        if (selectedRow?.type === 'item') {
          e.preventDefault();
          copyItemToClipboard(selectedRow.item, `item-${selectedRow.item.id}`);
        } else if (selectedRow?.type === 'stack' && selectedRow.items.length > 0) {
          e.preventDefault();
          copyStackToClipboard(selectedRow.items, `stack-${selectedRow.items.map(i => i.id).join(',')}`);
        }
        return;
      }

      // a: Add to personal fields.
      if (key === 'a' && !hasMeta) {
        e.preventDefault();
        if (selectedRow?.type === 'item') {
          copyToPersonal(selectedRow.item.id);
        } else if (selectedRow?.type === 'stack') {
          for (const item of selectedRow.items) {
            copyToPersonal(item.id);
          }
        }
        return;
      }

      // s: Stack selected items.
      if (key === 's' && !hasMeta && !hasCtrl && !hasAlt && !hasShift) {
        if (selectedIds.size > 1) {
          e.preventDefault();
          const newStackId = crypto.randomUUID();
          const itemIds = Array.from(selectedIds);
          (async () => {
            const success = await window.sharedClipboardAPI?.updateStackId(itemIds, newStackId);
            if (success) {
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

      // t: Unshare (delete).
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

      // d: Draw on previewed or selected image.
      if (key === 'd' && !hasMeta && !hasCtrl && !hasAlt && !hasShift && onOpenSketch) {
        if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) return;

        // If preview is open with an image, draw on that.
        if (preview && preview.type === 'image') {
          e.preventDefault();
          onOpenSketch(preview.url, preview.width || 800, preview.height || 600);
          dismissPreview();
          return;
        }

        // Otherwise check hovered or selected item.
        const hoveredItem = hoveredImageId !== null
          ? teamItems.find(i => i.id === hoveredImageId)
          : null;
        const selectedItem = selectedRow?.type === 'item' ? selectedRow.item : null;
        const imageItem = hoveredItem || selectedItem;

        if (imageItem && (imageItem.imageUrl || imageItem.imageData)) {
          e.preventDefault();
          const url = imageItem.imageUrl || `data:image/png;base64,${imageItem.imageData}`;
          onOpenSketch(url, imageItem.imageWidth || 800, imageItem.imageHeight || 600);
          return;
        }
      }

      // f: Submit selected item as feedback.
      if (key === 'f' && !hasMeta && !hasCtrl && !hasAlt && !hasShift && onSubmitFeedback) {
        if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/)) return;
        
        if (selectedRow) {
          e.preventDefault();
          (async () => {
            const item = selectedRow.type === 'item' ? selectedRow.item : selectedRow.items[0];
            if (!item) return;
            
            // Build content for feedback.
            const text = item.content || '';
            const imageBase64 = item.imageData;
            
            await onSubmitFeedback(text, imageBase64 || undefined);
          })();
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [session, listRows, selectedIndex, selectedIds, deletedItems, pasteItem, pasteStack, copyToPersonal, copyItemToClipboard, copyStackToClipboard, preview, dismissPreview, getPreviewForRow, getStackPreviewItems, hoveredImageId, teamItems, deleteTeamItem, deleteTeamItems, unstackTeamItems, toggleStackExpanded, toggleItemExpanded, stackPreviewIndex, stackPreviewItems, onOpenSketch, onSubmitFeedback]);

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
      cursor: 'pointer',
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
          {successMessage && (
            <div
              style={{
                padding: '12px',
                marginBottom: '16px',
                backgroundColor: theme.successBg,
                borderRadius: '6px',
                border: `1px solid ${theme.success}`,
              }}
            >
              <p style={{ margin: 0, fontSize: '12px', color: theme.success }}>
                {successMessage}
              </p>
            </div>
          )}

          {!successMessage && (
            <>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', color: theme.text }}>
                Sign in or create account
              </h3>

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
                    <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: theme.error }}>
                      {authError}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={isRequestingOtp || !authEmail.trim()}
                    style={{
                      ...buttonStyle,
                      opacity: isRequestingOtp || !authEmail.trim() ? 0.6 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                    }}
                  >
                    {isRequestingOtp && (
                      <span style={{
                        width: '14px',
                        height: '14px',
                        border: '2px solid rgba(255,255,255,0.3)',
                        borderTopColor: '#fff',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                      }} />
                    )}
                    {isRequestingOtp ? 'Sending...' : 'Continue'}
                  </button>
                  <p style={{ margin: '12px 0 0 0', fontSize: '11px', color: theme.textSecondary, textAlign: 'center' }}>
                    We'll email you a sign-in code. New users will have an account created automatically.
                  </p>

                  {/* Separator and feature list */}
                  <div style={{
                    borderTop: `1px solid ${theme.border}`,
                    margin: '20px 0 16px 0',
                    width: '50%',
                    marginLeft: 'auto',
                    marginRight: 'auto',
                  }} />
                  <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: theme.textSecondary, fontWeight: 600 }}>
                    <b>Free accounts include (per mo):</b>
                  </p>
                  <ul style={{
                    margin: '0',
                    paddingLeft: '20px',
                    fontSize: '12px',
                    color: theme.textSecondary,
                    lineHeight: '1.6',
                  }}>
                    <li>Shared Fields (up to 3 people)</li>
                    <li>500 minutes priority mic</li>
                    <li>50 auto-stacks</li>
                    <li>20 image drawings</li>
                    <li>Unlimited transcripts and screenshots</li>
                    <li>Unlimited fields and manual stacking</li>
                    <li>Unlimited manual drawings</li> 
                    <li>Popular commands</li>
                  </ul>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp}>
                  <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: theme.textSecondary }}>
                    Code sent to {authEmail}
                  </p>
                  <input
                    type="text"
                    placeholder="Enter code"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    disabled={isVerifyingOtp}
                    style={{ ...inputStyle, marginBottom: '12px', textAlign: 'center', letterSpacing: '4px', fontSize: '18px' }}
                    autoFocus
                  />
                  {authError && (
                    <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: theme.error }}>
                      {authError}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={isVerifyingOtp || !otpCode.trim()}
                    style={{
                      ...buttonStyle,
                      opacity: isVerifyingOtp || !otpCode.trim() ? 0.6 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                    }}
                  >
                    {isVerifyingOtp && (
                      <span style={{
                        width: '14px',
                        height: '14px',
                        border: '2px solid rgba(255,255,255,0.3)',
                        borderTopColor: '#fff',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                      }} />
                    )}
                    {isVerifyingOtp ? 'Verifying...' : 'Verify Code'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setOtpSent(false); setOtpCode(''); setAuthError(null); }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: theme.textSecondary,
                      fontSize: '12px',
                      cursor: 'pointer',
                      marginTop: '12px',
                      textDecoration: 'underline',
                    }}
                  >
                    Use different email
                  </button>
                </form>
              )}
            </>
          )}
        </div>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Authenticated - Main List
  // ---------------------------------------------------------------------------

  return (
    <div ref={containerRef} style={{ 
      flex: 1, 
      display: 'flex', 
      flexDirection: 'column', 
      overflow: 'hidden', 
      padding: '0 16px 16px 16px',
    }}>
      {/* Team Members Panel */}
      {showMembers && (
        <div style={{ marginBottom: '12px', padding: '12px', backgroundColor: theme.bgSecondary, borderRadius: '8px', border: `1px solid ${theme.border}` }}>
          <form onSubmit={handleAddMember} style={{ display: 'flex', gap: '8px', marginBottom: teamMembers.length > 0 ? '12px' : '0' }}>
            <input
              type="email"
              placeholder="Add team member email"
              value={addMemberEmail}
              onChange={(e) => setAddMemberEmail(e.target.value)}
              disabled={addingMember}
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: '12px',
                border: `1px solid ${theme.inputBorder}`,
                borderRadius: '4px',
                backgroundColor: theme.inputBg,
                color: theme.text,
              }}
            />
            <button
              type="submit"
              disabled={addingMember || !addMemberEmail.trim()}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 500,
                backgroundColor: theme.accent,
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: addingMember || !addMemberEmail.trim() ? 'default' : 'pointer',
                opacity: addingMember || !addMemberEmail.trim() ? 0.6 : 1,
              }}
            >
              {addingMember ? 'Adding...' : 'Add'}
            </button>
          </form>
          {addMemberError && (
            <p style={{ margin: '8px 0 0 0', fontSize: '11px', color: theme.error }}>{addMemberError}</p>
          )}
          {teamMembers.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {teamMembers.map(member => (
                <div
                  key={member.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 8px',
                    backgroundColor: theme.bg,
                    borderRadius: '4px',
                    fontSize: '11px',
                    color: theme.text,
                  }}
                >
                  <span title={member.email}>{formatNameFromEmail(member.email)}</span>
                  {member.addedByMe && (
                    <button
                      onClick={() => handleRemoveMember(member.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: theme.textSecondary,
                        cursor: 'pointer',
                        fontSize: '10px',
                        padding: '0 2px',
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search input */}
      <div style={{ position: 'relative', marginBottom: selectedIds.size > 0 ? '0' : '8px', transition: 'margin-bottom 0.15s ease' }}>
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
          }}
        />
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
            <span>search shared...</span>
          </div>
        )}
      </div>

      {/* Selection actions bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '0 8px',
          height: selectedIds.size > 0 ? '24px' : '0',
          marginBottom: selectedIds.size > 0 ? '4px' : '0',
          transition: 'height 0.15s ease, margin-bottom 0.15s ease',
          overflow: 'hidden',
        }}
      >
        {selectedIds.size > 0 && (
          <div style={{ fontSize: '11px', color: theme.textSecondary, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 500 }}>{selectedIds.size} selected</span>
            <span style={{ color: theme.border }}>•</span>
            <button
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={async () => {
                await deleteTeamItems(Array.from(selectedIds));
                setSelectedIds(new Set());
                setIsMultiSelect(false);
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
              unshare <KeyCap small>⌫</KeyCap>
            </button>
            {selectedIds.size > 1 && (
              <button
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={async () => {
                  const newStackId = crypto.randomUUID();
                  const itemIds = Array.from(selectedIds);
                  const success = await window.sharedClipboardAPI?.updateStackId(itemIds, newStackId);
                  if (success) {
                    setTeamItems(prev => prev.map(i => 
                      itemIds.includes(i.id) ? { ...i, stackId: newStackId } : i
                    ));
                    setSelectedIds(new Set());
                    setIsMultiSelect(false);
                  }
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
                stack <KeyCap small>s</KeyCap>
              </button>
            )}
            <button
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setSelectedIds(new Set());
                setIsMultiSelect(false);
                setLastClickedIndex(null);
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
              clear <KeyCap small>esc</KeyCap>
            </button>
          </div>
        )}
      </div>

      {/* Items list */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
        <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Scroll indicator */}
          <div
            onClick={() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 28,
              background: `linear-gradient(to bottom, ${theme.bg}ee, ${theme.bg}00)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              cursor: showScrollTop ? 'pointer' : 'default',
              pointerEvents: showScrollTop ? 'auto' : 'none',
              opacity: showScrollTop ? 1 : 0,
              transition: 'opacity 0.2s ease',
            }}
          >
            <span style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              color: theme.textSecondary,
            }}>↑</span>
          </div>

          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              minHeight: 0,
              borderRadius: '8px',
              border: `1px solid ${theme.border}`,
              marginTop: '8px',
            }}
          >
            {listRows.length === 0 && !itemsLoading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
                {teamItems.length === 0 ? 'No shared items yet' : 'No items match your search'}
              </div>
            ) : (
              listRows.map((row, index) => {
                if (row.type === 'stack') {
                  const { stack, items: stackItems, expanded } = row;
                  const stackImages = stackItems.filter(i => (i.type === 'image' || i.type === 'screenshot') && (i.imageData || i.imageUrl));
                  const combinedText = combineStackText(stackItems);
                  const hasText = combinedText.length > 0;
                  const stackDragId = `stack:${stack.stackId}`;
                  const isStackDragging = activeDragId === stackDragId;
                  const isStackOver = overDropId === stackDragId;
                  const isRowSelected = selectedIndex === index;
                  const isHovered = hoveredRowIndex === index;

                  return (
                    <DraggableDroppableRow
                      key={`stack-${stack.stackId}`}
                      id={stackDragId}
                      isDragging={isStackDragging}
                      isOver={isStackOver && !isStackDragging}
                      onMouseEnter={(e) => {
                        setHoveredRowIndex(index);
                        if (keyboardNavActive) return;
                        const element = e.currentTarget;
                        const container = listRef.current;
                        if (container && isElementFullyVisible(element, container)) {
                          setSelectedIndex(index);
                        }
                      }}
                      onMouseLeave={() => setHoveredRowIndex(null)}
                      onClick={() => pasteStack(stackItems)}
                      style={{
                        padding: '12px 16px',
                        backgroundColor: stackItems.some(item => selectedIds.has(item.id)) 
                          ? theme.selectedBg 
                          : isRowSelected 
                            ? theme.bgSecondary 
                            : isHovered
                              ? (theme.isDark ? 'rgba(255,255,255,0.05)' : '#f9f9f9')
                              : (theme.isDark ? 'rgba(255,255,255,0.03)' : '#ffffff'),
                        borderTop: isRowSelected ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : '1px solid transparent',
                        borderBottom: isRowSelected ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : `1px solid ${theme.border}`,
                        borderRight: isRowSelected ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : '1px solid transparent',
                        // Left indicator is now an inner element to avoid corner radius bending.
                        borderLeft: '2px solid transparent',
                        boxShadow: isRowSelected ? (theme.isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)') : 'none',
                        transition: 'background-color 0.3s ease, box-shadow 0.3s ease',
                        cursor: activeDragId ? 'grabbing' : 'grab',
                        userSelect: 'none',
                        position: 'relative',
                      }}
                    >
                      {/* Left selection indicator - inset to avoid corner radius bending */}
                      {(isRowSelected || stackItems.some(item => selectedIds.has(item.id))) && (
                        <div style={{
                          position: 'absolute',
                          left: 0,
                          top: 4,
                          bottom: 4,
                          width: isRowSelected ? (stackItems.some(item => selectedIds.has(item.id)) ? '4px' : '2px') : '2px',
                          backgroundColor: isRowSelected 
                            ? (theme.isDark ? '#8b5cf6' : '#7c3aed')
                            : (theme.isDark ? 'rgba(139, 92, 246, 0.6)' : 'rgba(124, 58, 237, 0.6)'),
                          borderRadius: '1px',
                          transition: 'width 0.1s ease, background-color 0.1s ease',
                        }} />
                      )}
                      <div>
                        {/* Images */}
                        {stackImages.length > 0 && (
                          <div style={{ display: 'flex', gap: '8px', marginBottom: combinedText ? '8px' : '4px', flexWrap: 'wrap' }}>
                            {stackImages.map((item) => (
                              <div
                                key={item.id}
                                onMouseEnter={() => setHoveredImageId(item.id)}
                                onMouseLeave={() => setHoveredImageId(null)}
                                style={{ position: 'relative' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (item.imageUrl || item.imageData) {
                                    // Build preview items from all images in this stack for navigation.
                                    const previewItems = getStackPreviewItems(stackItems);
                                    const clickedIndex = stackImages.findIndex(img => img.id === item.id);
                                    setStackPreviewItems(previewItems);
                                    setStackPreviewIndex(Math.max(0, clickedIndex));
                                    setPreview({
                                      type: 'image',
                                      url: item.imageUrl || `data:image/png;base64,${item.imageData}`,
                                      width: item.imageWidth || 0,
                                      height: item.imageHeight || 0,
                                    });
                                  }
                                }}
                              >
                                <CachedImage
                                  imageUrl={item.imageUrl}
                                  imageData={item.imageData}
                                  itemId={item.id}
                                  alt="Screenshot preview"
                                  style={{
                                    height: '50px',
                                    width: 'auto',
                                    borderRadius: '4px',
                                    border: '1px solid #e0e0e0',
                                    cursor: 'pointer',
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Text */}
                        {hasText && (() => {
                          const truncated = smartTruncateText(combinedText, 8, containerWidth);
                          const showSmartTruncation = !expanded && truncated.needsTruncation;
                          
                          if (expanded) {
                            return (
                              <div style={{ fontSize: '12px', fontWeight: '500', color: theme.text, lineHeight: '1.5', marginBottom: '4px', whiteSpace: 'pre-wrap', overflow: 'visible' }}>
                                {combinedText}
                              </div>
                            );
                          }
                          
                          if (showSmartTruncation) {
                            return (
                              <div style={{ marginBottom: '4px' }}>
                                <div style={{ fontSize: '12px', fontWeight: '500', color: theme.text, lineHeight: '1.5', display: 'inline' }}>
                                  {truncated.firstPart}...{' '}
                                  <button
                                    tabIndex={-1}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={(e) => { e.stopPropagation(); toggleStackExpanded(stack.stackId); }}
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      padding: '0 4px',
                                      fontSize: '10px',
                                      fontWeight: 500,
                                      color: theme.textSecondary,
                                      cursor: 'pointer',
                                      display: 'inline',
                                      textDecoration: 'underline',
                                    }}
                                  >
                                    ...expand...
                                  </button>
                                  {' '}{truncated.lastPart}
                                </div>
                              </div>
                            );
                          }
                          
                          return (
                            <div style={{ fontSize: '12px', fontWeight: '500', color: theme.text, lineHeight: '1.5', marginBottom: '4px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }}>
                              {combinedText}
                            </div>
                          );
                        })()}

                        {hasText && expanded && (
                          <button
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => { e.stopPropagation(); toggleStackExpanded(stack.stackId); }}
                            style={{ background: 'none', border: 'none', padding: 0, marginTop: '4px', fontSize: '10px', color: '#888', cursor: 'pointer' }}
                          >
                            Show less
                          </button>
                        )}
                      </div>

                      {/* Footer */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                        <div style={{ fontSize: '10px', color: theme.textSecondary, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={theme.warning} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="4" y="4" width="16" height="6" rx="1" />
                            <rect x="4" y="14" width="16" height="6" rx="1" />
                          </svg>
                          <span>{stackItems.length} items • {formatRelativeTime(stack.createdAt)}</span>
                          <InitialsBadge email={stack.createdByEmail} />
                        </div>

                        <div style={{ display: 'flex', gap: '4px', visibility: isRowSelected || isHovered ? 'visible' : 'hidden' }}>
                          {stackItems.length > 1 && (
                            <button
                              tabIndex={-1}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => { e.stopPropagation(); unstackTeamItems(stack.stackId); }}
                              style={{ padding: '4px 6px', fontSize: '10px', fontWeight: 500, backgroundColor: 'transparent', color: theme.textSecondary, border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                            >
                              unstack <KeyCap>u</KeyCap>
                            </button>
                          )}
                          <button
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => { e.stopPropagation(); setUnsharingId(stack.stackId); deleteTeamItems(stackItems.map(i => i.id)).then(() => setTimeout(() => setUnsharingId(null), 300)); }}
                            disabled={unsharingId === stack.stackId}
                            style={{ padding: '4px 6px', fontSize: '10px', fontWeight: 500, backgroundColor: 'transparent', color: theme.textSecondary, border: 'none', borderRadius: '4px', cursor: unsharingId === stack.stackId ? 'wait' : 'pointer' }}
                          >
                            {unsharingId === stack.stackId ? 'unsharing...' : 'unshare'} <KeyCap>t</KeyCap>
                          </button>
                          <button
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => { e.stopPropagation(); for (const item of stackItems) { copyToPersonal(item.id); } }}
                            style={{ padding: '4px 6px', fontSize: '10px', fontWeight: 500, backgroundColor: 'transparent', color: theme.textSecondary, border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            add <KeyCap>a</KeyCap>
                          </button>
                          {onOpenSketch && (() => {
                            const imageItem = stackItems.find(i => i.imageUrl || i.imageData);
                            if (!imageItem) return null;
                            return (
                              <button
                                tabIndex={-1}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const url = imageItem.imageUrl || `data:image/png;base64,${imageItem.imageData}`;
                                  onOpenSketch(url, imageItem.imageWidth || 800, imageItem.imageHeight || 600);
                                }}
                                style={{ padding: '4px 6px', fontSize: '10px', fontWeight: 500, backgroundColor: 'transparent', color: theme.textSecondary, border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                              >
                                draw <KeyCap>d</KeyCap>
                              </button>
                            );
                          })()}
                          <button
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                              e.stopPropagation();
                              // Preview the first available content
                              const imageItem = stackItems.find(i => i.imageUrl || i.imageData);
                              const textItem = stackItems.find(i => (i.type === 'text' || i.type === 'transcript') && i.content);
                              if (imageItem) {
                                const url = imageItem.imageUrl || `data:image/png;base64,${imageItem.imageData}`;
                                setPreview({
                                  type: 'image',
                                  url,
                                  width: imageItem.imageWidth || 0,
                                  height: imageItem.imageHeight || 0,
                                });
                              } else if (textItem && textItem.content) {
                                setPreview({ type: 'text', content: textItem.content });
                              }
                            }}
                            style={{ padding: '4px 6px', fontSize: '10px', fontWeight: 500, backgroundColor: 'transparent', color: theme.textSecondary, border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            preview <KeyCap>␣</KeyCap>
                          </button>
                          <button
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => { e.stopPropagation(); pasteStack(stackItems); }}
                            style={{ padding: '4px 6px', fontSize: '10px', fontWeight: 500, backgroundColor: 'transparent', color: theme.textSecondary, border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            paste <KeyCap>↵</KeyCap>
                          </button>
                        </div>
                      </div>
                    </DraggableDroppableRow>
                  );
                } else {
                  // Individual item
                  const { item } = row;
                  const itemDragId = `item:${item.id}`;
                  const isItemDragging = activeDragId === itemDragId;
                  const isItemOver = overDropId === itemDragId;
                  const isRowSelected = selectedIndex === index;
                  const isHovered = hoveredRowIndex === index;
                  const isSelected = selectedIds.has(item.id);
                  const isCopying = copyingToPersonal === item.id;
                  const isImage = item.type === 'image' || item.type === 'screenshot';
                  const expanded = expandedItems.has(item.id);
                  const truncated = item.content ? smartTruncateText(item.content, 8, containerWidth) : null;
                  const showSmartTruncation = item.content && !expanded && truncated?.needsTruncation;

                  return (
                    <DraggableDroppableRow
                      key={`item-${item.id}`}
                      id={itemDragId}
                      isDragging={isItemDragging}
                      isOver={isItemOver && !isItemDragging}
                      onMouseEnter={(e) => {
                        setHoveredRowIndex(index);
                        if (keyboardNavActive) return;
                        const element = e.currentTarget;
                        const container = listRef.current;
                        if (container && isElementFullyVisible(element, container)) {
                          setSelectedIndex(index);
                        }
                      }}
                      onMouseLeave={() => setHoveredRowIndex(null)}
                      onClick={() => pasteItem(item)}
                      style={{
                        padding: '12px 16px',
                        backgroundColor: isSelected 
                          ? theme.selectedBg 
                          : isRowSelected 
                            ? theme.bgSecondary 
                            : isHovered
                              ? (theme.isDark ? 'rgba(255,255,255,0.05)' : '#f9f9f9')
                              : (theme.isDark ? 'rgba(255,255,255,0.03)' : '#ffffff'),
                        borderTop: isRowSelected ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : '1px solid transparent',
                        borderBottom: isRowSelected ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : `1px solid ${theme.border}`,
                        borderRight: isRowSelected ? `1px solid ${theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}` : '1px solid transparent',
                        // Left indicator is now an inner element to avoid corner radius bending.
                        borderLeft: '2px solid transparent',
                        boxShadow: isRowSelected ? (theme.isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)') : 'none',
                        transition: 'background-color 0.3s ease, box-shadow 0.3s ease',
                        cursor: activeDragId ? 'grabbing' : 'grab',
                        userSelect: 'none',
                        position: 'relative',
                      }}
                    >
                      {/* Left selection indicator - inset to avoid corner radius bending */}
                      {(isRowSelected || isSelected) && (
                        <div style={{
                          position: 'absolute',
                          left: 0,
                          top: 4,
                          bottom: 4,
                          width: isRowSelected ? (isSelected ? '4px' : '2px') : '2px',
                          backgroundColor: isRowSelected 
                            ? (theme.isDark ? '#8b5cf6' : '#7c3aed')
                            : (theme.isDark ? 'rgba(139, 92, 246, 0.6)' : 'rgba(124, 58, 237, 0.6)'),
                          borderRadius: '1px',
                          transition: 'width 0.1s ease, background-color 0.1s ease',
                        }} />
                      )}
                      {/* Copy icon - top right */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyItemToClipboard(item, `item-${item.id}`);
                        }}
                        style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
                          padding: '2px 4px',
                          backgroundColor: 'transparent',
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer',
                          opacity: copiedItemId === `item-${item.id}` ? 1 : (isRowSelected || isHovered ? 0.5 : 0),
                          transition: 'opacity 0.15s ease',
                          fontSize: copiedItemId === `item-${item.id}` ? 8 : 11,
                          color: copiedItemId === `item-${item.id}` ? theme.text : theme.textSecondary,
                          display: 'flex',
                          alignItems: 'center',
                        }}
                        onMouseEnter={(e) => { if (copiedItemId !== `item-${item.id}`) e.currentTarget.style.opacity = '1'; }}
                        onMouseLeave={(e) => { if (copiedItemId !== `item-${item.id}`) e.currentTarget.style.opacity = isRowSelected || isHovered ? '0.5' : '0'; }}
                      >
                        {copiedItemId === `item-${item.id}` ? 'copied' : '⧉'}
                      </button>
                      <div>
                        {/* Image */}
                        {isImage && (item.imageUrl || item.imageData) && (
                          <div
                            onMouseEnter={() => setHoveredImageId(item.id)}
                            onMouseLeave={() => setHoveredImageId(null)}
                            style={{ marginBottom: '4px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreview({
                                type: 'image',
                                url: item.imageUrl || `data:image/png;base64,${item.imageData}`,
                                width: item.imageWidth || 0,
                                height: item.imageHeight || 0,
                              });
                            }}
                          >
                            <CachedImage
                              imageUrl={item.imageUrl}
                              imageData={item.imageData}
                              itemId={item.id}
                              alt="Screenshot preview"
                              style={{
                                height: '50px',
                                width: 'auto',
                                borderRadius: '4px',
                                border: '1px solid #e0e0e0',
                                cursor: 'pointer',
                              }}
                            />
                          </div>
                        )}

                        {/* Text */}
                        {item.content && (() => {
                          if (expanded) {
                            return (
                              <div style={{ fontSize: '12px', fontWeight: '500', color: theme.text, lineHeight: '1.5', marginBottom: '4px', whiteSpace: 'pre-wrap', overflow: 'visible' }}>
                                {item.content}
                              </div>
                            );
                          }
                          
                          if (showSmartTruncation && truncated) {
                            return (
                              <div style={{ marginBottom: '4px' }}>
                                <div style={{ fontSize: '12px', fontWeight: '500', color: theme.text, lineHeight: '1.5', display: 'inline' }}>
                                  {truncated.firstPart}...{' '}
                                  <button
                                    tabIndex={-1}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={(e) => { e.stopPropagation(); toggleItemExpanded(item.id); }}
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      padding: '0 4px',
                                      fontSize: '10px',
                                      fontWeight: 500,
                                      color: theme.textSecondary,
                                      cursor: 'pointer',
                                      display: 'inline',
                                      textDecoration: 'underline',
                                    }}
                                  >
                                    ...expand...
                                  </button>
                                  {' '}{truncated.lastPart}
                                </div>
                              </div>
                            );
                          }
                          
                          return (
                            <div style={{ fontSize: '12px', fontWeight: '500', color: theme.text, lineHeight: '1.5', marginBottom: '4px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }}>
                              {item.content}
                            </div>
                          );
                        })()}

                        {item.content && expanded && (
                          <button
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => { e.stopPropagation(); toggleItemExpanded(item.id); }}
                            style={{ background: 'none', border: 'none', padding: 0, marginTop: '4px', fontSize: '10px', color: '#888', cursor: 'pointer' }}
                          >
                            Show less
                          </button>
                        )}
                      </div>

                      {/* Footer */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                        <div style={{ fontSize: '10px', color: theme.textSecondary, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span>
                            {item.type === 'transcript' && '🎙️ '}
                            {item.type === 'screenshot' && '📸 '}
                            {formatRelativeTime(item.clientCreatedAtMs)}
                            {item.imageSize && ` • ${formatFileSize(item.imageSize)}`}
                            {item.wordCount && ` • ${item.wordCount} words`}
                          </span>
                          <InitialsBadge email={item.sharedByEmail} />
                        </div>

                        <div style={{ display: 'flex', gap: '4px', visibility: isRowSelected || isHovered ? 'visible' : 'hidden' }}>
                          <button
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => { e.stopPropagation(); setUnsharingId(item.id); deleteTeamItem(item.id).then(() => setTimeout(() => setUnsharingId(null), 300)); }}
                            disabled={unsharingId === item.id}
                            style={{ padding: '4px 6px', fontSize: '10px', fontWeight: 500, backgroundColor: 'transparent', color: theme.textSecondary, border: 'none', borderRadius: '4px', cursor: unsharingId === item.id ? 'wait' : 'pointer' }}
                          >
                            {unsharingId === item.id ? 'unsharing...' : 'unshare'} <KeyCap>t</KeyCap>
                          </button>
                          <button
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => { e.stopPropagation(); copyToPersonal(item.id); }}
                            disabled={isCopying}
                            style={{ padding: '4px 6px', fontSize: '10px', fontWeight: 500, backgroundColor: 'transparent', color: theme.textSecondary, border: 'none', borderRadius: '4px', cursor: isCopying ? 'wait' : 'pointer' }}
                          >
                            {isCopying ? 'adding...' : 'add'} <KeyCap>a</KeyCap>
                          </button>
                          {(item.imageUrl || item.imageData) && onOpenSketch && (
                            <button
                              tabIndex={-1}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={(e) => {
                                e.stopPropagation();
                                const url = item.imageUrl || `data:image/png;base64,${item.imageData}`;
                                onOpenSketch(url, item.imageWidth || 800, item.imageHeight || 600);
                              }}
                              style={{ padding: '4px 6px', fontSize: '10px', fontWeight: 500, backgroundColor: 'transparent', color: theme.textSecondary, border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                            >
                              draw <KeyCap>d</KeyCap>
                            </button>
                          )}
                          <button
                            tabIndex={-1}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => { e.stopPropagation(); pasteItem(item); }}
                            style={{ padding: '4px 6px', fontSize: '10px', fontWeight: 500, backgroundColor: 'transparent', color: theme.textSecondary, border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            paste <KeyCap>↵</KeyCap>
                          </button>
                        </div>
                      </div>
                    </DraggableDroppableRow>
                  );
                }
              })
            )}
          </div>

          {/* Drag overlay */}
          <DragOverlay>
            {activeDragId ? (() => {
              const [type, id] = activeDragId.split(':');
              const row = listRows.find(r => 
                type === 'stack' 
                  ? r.type === 'stack' && r.stack.stackId === id
                  : r.type === 'item' && r.item.id === id
              );
              let previewText = type === 'stack' ? 'Stack' : 'Item';
              if (row?.type === 'stack') {
                previewText = combineStackText(row.items).slice(0, 80) || 'Stack';
              } else if (row?.type === 'item') {
                previewText = row.item.content?.slice(0, 80) || 'Item';
              }
              return (
                <div style={{
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
                }}>
                  {previewText}
                </div>
              );
            })() : null}
          </DragOverlay>
        </div>
      </DndContext>

      {/* CSS animations */}
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
      `}</style>

      {/* Preview modal */}
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
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '16px',
              }}
            >
              <img
                src={preview.url}
                alt="Preview"
                style={{
                  maxWidth: '90vw',
                  maxHeight: '75vh',
                  objectFit: 'contain',
                  borderRadius: '8px',
                  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              {/* Action bar - paste, draw, delete */}
              <div style={{
                display: 'flex',
                gap: '8px',
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                borderRadius: '10px',
                padding: '8px 12px',
              }}>
                {[
                  { label: 'paste', key: '↵', action: async () => {
                    // Get the currently selected/previewed item and paste it.
                    const selectedRow = listRows[selectedIndex];
                    if (selectedRow?.type === 'item') {
                      await pasteItem(selectedRow.item);
                    } else if (selectedRow?.type === 'stack') {
                      await pasteStack(selectedRow.items);
                    }
                  }},
                  ...(onOpenSketch ? [{ label: 'sketch', key: 'd', action: () => {
                    // Open sketch mode with this image.
                    onOpenSketch(preview.url, preview.width || 800, preview.height || 600);
                    dismissPreview();
                  }}] : []),
                  ...(onSubmitFeedback ? [{ label: 'feedback', key: 'f', action: async () => {
                    // Send previewed image as feedback.
                    const selectedRow = listRows[selectedIndex];
                    const item = selectedRow?.type === 'item' ? selectedRow.item : selectedRow?.items?.[0];
                    if (item) {
                      await onSubmitFeedback(item.content || '', item.imageData || undefined);
                    }
                    dismissPreview();
                  }}] : []),
                  { label: 'delete', key: '⌫', action: async () => {
                    const selectedRow = listRows[selectedIndex];
                    if (selectedRow?.type === 'item') {
                      await deleteTeamItem(selectedRow.item.id);
                      dismissPreview();
                    } else if (selectedRow?.type === 'stack') {
                      await deleteTeamItems(selectedRow.items.map(i => i.id));
                      dismissPreview();
                    }
                  }},
                ].map((action) => (
                  <button
                    key={action.label}
                    onClick={action.action}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 500,
                      backgroundColor: 'rgba(255, 255, 255, 0.1)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    {action.label}
                    <span style={{
                      fontSize: '10px',
                      opacity: 0.7,
                      backgroundColor: 'rgba(255, 255, 255, 0.15)',
                      padding: '2px 5px',
                      borderRadius: '3px',
                    }}>
                      {action.key}
                    </span>
                  </button>
                ))}
              </div>
            </div>
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
