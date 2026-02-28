/**
 * FeedbackView - Feedback submission and management view for Field Theory.
 *
 * Shows:
 * - User's submitted feedback (or all feedback if admin)
 * - Feedback details with replies
 * - Status management (open/resolved/archived)
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import CachedImage from './CachedImage';

// Import transcription status type
type TranscriptionStatus = 'idle' | 'recording' | 'transcribing';

// =============================================================================
// Types - Mirror the types from window.d.ts
// =============================================================================

interface SocialMessage {
  id: string;
  type: 'dm' | 'feedback';
  senderUserId: string;
  senderEmail: string | null;
  senderCallsign: string | null;
  senderName: string | null;
  recipientUserId: string;
  recipientEmail: string | null;
  recipientCallsign: string | null;
  recipientName: string | null;
  contentType: 'text' | 'image' | 'stack';
  contentText: string | null;
  imagePath: string | null;
  imageUrl: string | null;
  stackId: string | null;
  sourceItemId: string | null;
  readAt: number | null;
  feedbackStatus: 'open' | 'resolved' | 'archived' | null;
  parentMessageId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface ActivityLogEntry {
  id: string;
  messageId: string;
  userId: string;
  userEmail: string | null;
  action: 'created' | 'status_changed' | 'replied';
  oldStatus: string | null;
  newStatus: string | null;
  createdAt: number;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format timestamp to relative time.
 */
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

/**
 * Format timestamp to date string like "Jan 8, 2024".
 */
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

// =============================================================================
// Component
// =============================================================================

interface FeedbackViewProps {
  onSwitchToClipboard?: () => void;
}

// Cache key for stale-while-revalidate pattern
const FEEDBACK_CACHE_KEY = 'fieldtheory_feedback_cache';

function getCachedData<T>(key: string): T | null {
  try {
    const cached = localStorage.getItem(key);
    if (cached) return JSON.parse(cached);
  } catch (e) {
    // Ignore parse errors
  }
  return null;
}

function setCachedData<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    // Ignore storage errors
  }
}

export default function FeedbackView({ onSwitchToClipboard }: FeedbackViewProps) {
  const { theme } = useTheme();

  // Initialize from cache for instant display (stale-while-revalidate)
  const cachedFeedback = getCachedData<SocialMessage[]>(FEEDBACK_CACHE_KEY);
  const hasCache = cachedFeedback && cachedFeedback.length > 0;

  // State
  const [feedback, setFeedback] = useState<SocialMessage[]>(cachedFeedback || []);
  const [isAdmin, setIsAdmin] = useState(false);
  // Only show loading if we have no cached data
  const [loading, setLoading] = useState(!hasCache);
  const [selectedFeedback, setSelectedFeedback] = useState<SocialMessage | null>(null);
  const [feedbackReplies, setFeedbackReplies] = useState<SocialMessage[]>([]);
  const [feedbackFilter, setFeedbackFilter] = useState<'all' | 'open' | 'resolved' | 'archived'>('all');
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [replyText, setReplyText] = useState('');
  const [replyImage, setReplyImage] = useState<{ base64: string; preview: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sending, setSending] = useState(false);

  // Transcription state for feedback input
  const [transcriptionStatus, setTranscriptionStatus] = useState<TranscriptionStatus>('idle');
  // Track if recording was started via the feedback button (vs global hotkey)
  const startedFromFeedbackButton = useRef(false);

  // Expanded image state for click-to-expand thumbnails
  const [expandedImage, setExpandedImage] = useState<{ url: string; alt: string } | null>(null);

  // Resizable panel state
  const [panelWidth, setPanelWidth] = useState(220);
  const [isResizing, setIsResizing] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);
  const copyableTextStyle = {
    userSelect: 'text',
    WebkitUserSelect: 'text',
  } as const;

  // ==========================================================================
  // Data Loading
  // ==========================================================================

  const loadData = useCallback(async () => {
    if (!window.socialAPI) return;

    // Don't show loading - we either have cached data or initial loading state handles it
    setLoadError(null);

    try {
      const admin = await window.socialAPI.isAdmin();
      setIsAdmin(admin);
      setFeedbackFilter(admin ? 'open' : 'all');

      // Load feedback based on admin status.
      console.log('[FeedbackView] loadData: admin =', admin);
      if (admin) {
        console.log('[FeedbackView] Loading as admin');
        const allFeedback = await window.socialAPI.getAllFeedback();
        setFeedback(allFeedback);
        setCachedData(FEEDBACK_CACHE_KEY, allFeedback);

        // Mark ALL unread feedback (including replies) as read when admin views the list.
        console.log('[FeedbackView] Admin calling markAllFeedbackAsRead...');
        window.socialAPI.markAllFeedbackAsRead().then(success => {
          console.log('[FeedbackView] Admin markAllFeedbackAsRead result:', success);
        }).catch(err => {
          console.error('[FeedbackView] Admin markAllFeedbackAsRead failed:', err);
        });
      } else {
        console.log('[FeedbackView] Loading as regular user');
        const myFeedback = await window.socialAPI.getMyFeedback();
        setFeedback(myFeedback);
        setCachedData(FEEDBACK_CACHE_KEY, myFeedback);

        // Mark all feedback messages as read when user views the list.
        // This clears the notification badge for replies from admin.
        console.log('[FeedbackView] Calling markAllFeedbackAsRead...');
        window.socialAPI.markAllFeedbackAsRead().then(success => {
          console.log('[FeedbackView] markAllFeedbackAsRead result:', success);
          if (!success) {
            console.warn('[FeedbackView] markAllFeedbackAsRead returned false');
          }
        }).catch(err => {
          console.error('[FeedbackView] markAllFeedbackAsRead failed:', err);
        });
      }
    } catch (err) {
      console.error('[FeedbackView] Failed to load data:', err);
      // Only show error if we have no cached data to display
      if (!hasCache) {
        setLoadError('Failed to load feedback. Please check your connection.');
      }
    } finally {
      setLoading(false);
    }
  }, [hasCache]);

  // Load feedback replies and activity log, and mark as read.
  const loadFeedbackDetails = useCallback(async (feedbackItem: SocialMessage) => {
    if (!window.socialAPI) return;

    const [replies, log] = await Promise.all([
      window.socialAPI.getFeedbackReplies(feedbackItem.id),
      window.socialAPI.getActivityLog(feedbackItem.id),
    ]);

    setFeedbackReplies(replies);
    setActivityLog(log);

    // Mark feedback and unread replies as read (batch).
    const unreadIds: string[] = [];
    if (!feedbackItem.readAt) {
      unreadIds.push(feedbackItem.id);
    }
    for (const reply of replies) {
      if (!reply.readAt) {
        unreadIds.push(reply.id);
      }
    }
    console.log('[FeedbackView] loadFeedbackDetails: unread replies to mark:', unreadIds);
    if (unreadIds.length > 0) {
      window.socialAPI.markAsReadBatch(unreadIds).then(success => {
        console.log('[FeedbackView] loadFeedbackDetails markAsReadBatch result:', success);
      });
    }
  }, []);

  // Initial load - fetch fresh data in background (cached data already displayed)
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Load feedback details when feedback is selected.
  useEffect(() => {
    if (selectedFeedback) {
      loadFeedbackDetails(selectedFeedback);
    }
  }, [selectedFeedback, loadFeedbackDetails]);

  // Listen for new feedback messages via realtime.
  useEffect(() => {
    if (!window.socialAPI) return;

    const unsubscribe = window.socialAPI.onMessageReceived((message) => {
      console.log('[FeedbackView] Message received:', message.type, message.id);

      if (message.type === 'feedback') {
        // Add to feedback list if it's a new feedback item or reply
        if (!message.parentMessageId) {
          // New feedback item
          setFeedback(prev => [message, ...prev]);
        } else if (selectedFeedback?.id === message.parentMessageId) {
          // Reply to currently selected feedback
          setFeedbackReplies(prev => [...prev, message]);
        }
      }
    });

    return unsubscribe;
  }, [selectedFeedback]);

  // Scroll to bottom when replies change.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [feedbackReplies]);

  // Close expanded image on ESC key.
  useEffect(() => {
    if (!expandedImage) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpandedImage(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expandedImage]);

  // Listen for transcription status changes.
  useEffect(() => {
    if (!window.transcribeAPI) return;

    const unsubscribe = window.transcribeAPI.onStatusChanged((status) => {
      setTranscriptionStatus(status);
      // Reset feedback button flag if recording was cancelled (went idle without transcribing)
      if (status === 'idle') {
        startedFromFeedbackButton.current = false;
      }
    });

    return unsubscribe;
  }, []);

  // Listen for transcription results and auto-paste into feedback input.
  useEffect(() => {
    if (!window.transcribeAPI) return;

    const unsubscribe = window.transcribeAPI.onResult((text) => {
      // Only auto-paste if recording was started via the feedback button
      if (startedFromFeedbackButton.current) {
        setReplyText((currentText) => {
          // Only update if field is currently empty
          if (!currentText) {
            return text;
          }
          return currentText;
        });
        // Reset the flag after receiving the result
        startedFromFeedbackButton.current = false;
      }
    });

    return unsubscribe;
  }, []);

  // Handle panel resize.
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(Math.max(e.clientX - 12, 150), 400);
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  // Keyboard navigation.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;

      // Skip if typing in input (except Escape).
      if (document.activeElement?.tagName?.match(/INPUT|TEXTAREA/) && key !== 'Escape') {
        return;
      }

      // Escape: Close modal, deselect, or close window.
      if (key === 'Escape') {
        if (selectedFeedback) {
          e.preventDefault();
          setSelectedFeedback(null);
          return;
        }
        // Return to clipboard if callback provided, otherwise close window
        if (onSwitchToClipboard) {
          e.preventDefault();
          onSwitchToClipboard();
        } else {
          window.clipboardAPI?.closeWindow();
        }
        return;
      }

      // j/k or Arrow keys: Navigate list.
      if (key === 'j' || key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, feedback.length - 1));
        return;
      }
      if (key === 'k' || key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        return;
      }

      // Enter: Select the current item.
      if (key === 'Enter' && feedback.length > 0) {
        e.preventDefault();
        const item = feedback[selectedIndex];
        if (item) setSelectedFeedback(item);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [feedback, selectedIndex, selectedFeedback, onSwitchToClipboard]);

  // Scroll selected item into view.
  useEffect(() => {
    if (!listRef.current) return;
    const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
    selectedElement?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIndex]);

  // ==========================================================================
  // Actions
  // ==========================================================================

  const handleSendReply = async () => {
    if (!window.socialAPI || !selectedFeedback) return;

    // Need either text or image to send.
    const hasContent = replyText.trim() || replyImage;
    if (!hasContent) return;

    setSending(true);

    // Store values before clearing for optimistic update
    const messageText = replyText.trim();
    const messageImage = replyImage;

    try {
      // Reply to feedback.
      const recipientId = isAdmin ? selectedFeedback.senderUserId : selectedFeedback.recipientUserId;

      let result;
      if (messageImage) {
        // Send image reply (with optional text).
        result = await window.socialAPI.sendImageReply(
          recipientId,
          messageImage.base64,
          messageText || undefined,
          selectedFeedback.id
        );
      } else {
        // Send text-only reply.
        result = await window.socialAPI.sendTextDM(recipientId, messageText, selectedFeedback.id);
      }

      // Clear input fields
      setReplyText('');
      setReplyImage(null);

      // Optimistically add the new reply to the list without full page reload
      if (result) {
        setFeedbackReplies(prev => [...prev, result]);
      }
    } catch (error) {
      console.error('Failed to send reply:', error);
      // On error, restore the text so user doesn't lose their message
      setReplyText(messageText);
      setReplyImage(messageImage);
    } finally {
      setSending(false);
    }
  };

  // Handle paste events for image support.
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;

        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          if (!dataUrl) return;

          // Extract base64 data (remove "data:image/png;base64," prefix).
          const base64 = dataUrl.split(',')[1];
          setReplyImage({ base64, preview: dataUrl });
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  };

  // Clear the pasted image.
  const clearReplyImage = () => setReplyImage(null);

  // Handle submitting new feedback (from compose area).
  const handleNewFeedback = async () => {
    if (!window.socialAPI) return;

    // Need either text or image to send.
    const hasContent = replyText.trim() || replyImage;
    if (!hasContent) return;

    setSending(true);
    try {
      if (replyImage) {
        // Send image feedback with optional caption.
        await window.socialAPI.submitImageFeedback(
          replyImage.base64,
          replyText.trim() || undefined
        );
      } else {
        // Send text feedback.
        await window.socialAPI.submitTextFeedback(replyText.trim());
      }

      setReplyText('');
      setReplyImage(null);
      loadData(); // Refresh to show the new feedback in the list.
    } finally {
      setSending(false);
    }
  };

  const handleStatusChange = async (feedbackId: string, status: 'open' | 'resolved' | 'archived') => {
    if (!window.socialAPI) return;

    // Only admin can archive.
    if (status === 'archived' && !isAdmin) return;

    await window.socialAPI.updateFeedbackStatus(feedbackId, status);

    // Optimistic update - update local state without full reload
    setFeedback(prev => prev.map(f =>
      f.id === feedbackId ? { ...f, feedbackStatus: status } : f
    ));

    // Update selected feedback if it's the one being changed
    if (selectedFeedback && selectedFeedback.id === feedbackId) {
      setSelectedFeedback({ ...selectedFeedback, feedbackStatus: status });

      // Reload activity log to show the status change
      loadFeedbackDetails({ ...selectedFeedback, feedbackStatus: status });
    }
  };

  // ==========================================================================
  // Render Helpers
  // ==========================================================================

  const renderStatusBadge = (status: 'open' | 'resolved' | 'archived' | null) => {
    if (!status) return null;

    const colors = {
      open: { bg: theme.warning, text: '#000' },
      resolved: { bg: theme.success, text: '#fff' },
      archived: { bg: '#6b7280', text: '#fff' },
    };

    const { bg, text } = colors[status];

    return (
      <span style={{
        fontSize: '9px',
        padding: '1px 4px',
        borderRadius: '3px',
        backgroundColor: bg,
        color: text,
        fontWeight: 500,
      }}>
        {status.toUpperCase()}
      </span>
    );
  };

  // ==========================================================================
  // Render
  // ==========================================================================

  // Loading skeleton component
  const SkeletonItem = ({ width = '100%', height = '12px' }: { width?: string; height?: string }) => (
    <div
      style={{
        width,
        height,
        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        borderRadius: '4px',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    />
  );

  if (loading) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        padding: '0 16px 16px 16px',
      }}>
        {/* Skeleton header */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <SkeletonItem width="100px" height="28px" />
        </div>

        <div style={{ flex: 1, display: 'flex', gap: '12px', overflow: 'hidden' }}>
          {/* Skeleton feedback list */}
          <div style={{ width: '200px', flexShrink: 0, paddingRight: '12px' }}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} style={{ padding: '8px', marginBottom: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
                  <SkeletonItem width="120px" height="14px" />
                </div>
                <SkeletonItem width="160px" height="10px" />
              </div>
            ))}
          </div>

          {/* Skeleton content area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <SkeletonItem width="200px" height="16px" />
            </div>
          </div>
        </div>

        {/* CSS animation for pulse effect */}
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}</style>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '20px',
      }}>
        <div style={{ color: theme.error, fontSize: '12px', textAlign: 'center' }}>
          {loadError}
        </div>
        <button
          onClick={() => loadData()}
          style={{
            padding: '8px 16px',
            fontSize: '11px',
            backgroundColor: theme.accent,
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      padding: '0 16px 16px 16px',
    }}>
      {/* Header with hamburger and add new button */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '12px',
        alignItems: 'center',
      }}>
        {/* Hamburger menu - collapse/expand list */}
        <button
          onClick={() => setPanelCollapsed(!panelCollapsed)}
          style={{
            padding: '4px 6px',
            fontSize: '12px',
            backgroundColor: 'transparent',
            color: theme.textSecondary,
            border: 'none',
            cursor: 'pointer',
            borderRadius: '3px',
            lineHeight: 1,
          }}
          title={panelCollapsed ? 'Show list' : 'Hide list'}
        >
          {/* Unicode hamburger icon */}
          &#9776;
        </button>

        {/* Add New button - go to compose view */}
        <button
          onClick={() => setSelectedFeedback(null)}
          style={{
            marginLeft: 'auto',
            padding: '4px 8px',
            fontSize: '9px',
            backgroundColor: 'transparent',
            color: theme.textSecondary,
            border: `1px solid ${theme.inputBorder}`,
            borderRadius: '4px',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          + Add New
        </button>
      </div>

      {/* Expanded Image Modal */}
      {expandedImage && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.8)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 101,
            cursor: 'pointer',
          }}
          onClick={() => setExpandedImage(null)}
        >
          <img
            src={expandedImage.url}
            alt={expandedImage.alt}
            style={{
              maxWidth: '90%',
              maxHeight: '80%',
              borderRadius: '8px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          />
          {/* Close button */}
          <button
            onClick={() => setExpandedImage(null)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: 'rgba(255,255,255,0.2)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontSize: '18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Close (ESC)"
          >
            x
          </button>
          {/* ESC hint */}
          <div style={{
            position: 'absolute',
            bottom: '20px',
            color: 'rgba(255,255,255,0.5)',
            fontSize: '11px',
          }}>
            Press ESC to close
          </div>
        </div>
      )}

      {/* Main content area */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
      }}>
        {/* Left panel: Feedback list (hidden when collapsed) */}
        {!panelCollapsed && (
          <>
          <div
            ref={listRef}
            style={{
              width: `${panelWidth}px`,
              flexShrink: 0,
              overflowY: 'auto',
              paddingRight: '8px',
              position: 'relative',
            }}
          >
            {/* Filter tabs */}
            {feedback.length > 0 && (
              <div style={{
                display: 'flex',
                gap: '4px',
                marginBottom: '8px',
              }}>
                {(['all', 'open', 'resolved', 'archived'] as const).map((filter) => {
                  const count = filter === 'all'
                    ? feedback.length
                    : feedback.filter(f => f.feedbackStatus === filter).length;
                  const isActive = feedbackFilter === filter;
                  const label = filter === 'all' ? 'All'
                    : filter === 'resolved' ? 'Done'
                    : filter.charAt(0).toUpperCase() + filter.slice(1);
                  return (
                    <button
                      key={filter}
                      onClick={() => setFeedbackFilter(filter)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '9px',
                        fontWeight: isActive ? 600 : 400,
                        backgroundColor: isActive ? theme.accent : 'transparent',
                        color: isActive ? '#fff' : theme.textSecondary,
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {label} {count}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Filtered feedback list */}
            {feedback.length === 0 ? (
              <div style={{ color: theme.textSecondary, fontSize: '11px', padding: '8px' }}>
                No feedback yet. Click "+ Add New" to submit feedback.
              </div>
            ) : (
              feedback
                .filter(item => feedbackFilter === 'all' || item.feedbackStatus === feedbackFilter)
                .map((item, index) => {
                  // Status indicator: dot for open, checkmark for resolved, folder for archived
                  const statusIcon = item.feedbackStatus === 'open' ? '\u2022'
                    : item.feedbackStatus === 'resolved' ? '\u2713'
                    : '\u{1F4C1}';
                  const statusColor = item.feedbackStatus === 'open' ? '#f59e0b'
                    : item.feedbackStatus === 'resolved' ? '#10b981'
                    : theme.textSecondary;

                  return (
                    <div
                      key={item.id}
                      onClick={() => {
                        setSelectedFeedback(item);
                        setSelectedIndex(index);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '6px',
                        padding: '8px 6px',
                        borderRadius: '4px',
                        backgroundColor: selectedFeedback?.id === item.id
                          ? theme.bgSecondary
                          : 'transparent',
                        cursor: 'pointer',
                        opacity: item.feedbackStatus === 'archived' ? 0.6 : 1,
                        marginBottom: '2px',
                      }}
                    >
                      <span style={{
                        color: statusColor,
                        fontSize: item.feedbackStatus === 'archived' ? '9px' : '10px',
                        lineHeight: '16px',
                        width: '12px',
                        flexShrink: 0,
                      }}>
                        {statusIcon}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: '11px',
                          color: theme.text,
                          lineHeight: '16px',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}>
                          {item.contentText || (item.contentType === 'image' ? 'Screenshot' : '')}
                        </div>
                        <div style={{
                          fontSize: '9px',
                          color: theme.textSecondary,
                          marginTop: '2px',
                          ...copyableTextStyle,
                        }}>
                          {formatDate(item.createdAt)}
                          {isAdmin && (item.senderCallsign || item.senderEmail)
                            ? ` \u00B7 ${item.senderCallsign || 'no-callsign'} \u00B7 ${item.senderEmail || 'no-email'}`
                            : ''}
                        </div>
                      </div>
                    </div>
                  );
                })
            )}
          </div>

          {/* Resize handle */}
          <div
            onMouseDown={() => setIsResizing(true)}
            style={{
              width: '4px',
              cursor: 'col-resize',
              backgroundColor: isResizing ? theme.accent : 'transparent',
              transition: 'background-color 0.15s',
              flexShrink: 0,
              marginRight: '8px',
            }}
            onMouseEnter={(e) => { if (!isResizing) e.currentTarget.style.backgroundColor = theme.inputBorder; }}
            onMouseLeave={(e) => { if (!isResizing) e.currentTarget.style.backgroundColor = 'transparent'; }}
          />
        </>
        )}

        {/* Right panel: Feedback detail or compose */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderLeft: panelCollapsed ? 'none' : `1px solid ${theme.inputBorder}`,
          paddingLeft: panelCollapsed ? '0' : '12px',
        }}>
          {selectedFeedback ? (
            // Feedback thread - unified message view
            <>
              {/* Header with status */}
              <div style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '8px',
                alignItems: 'center',
                paddingBottom: '8px',
                borderBottom: `1px solid ${theme.inputBorder}`,
              }}>
                {/* Prev/Next navigation when collapsed */}
                {panelCollapsed && (
                  <div style={{ display: 'flex', gap: '2px', marginRight: '4px' }}>
                    <button
                      onClick={() => {
                        const filtered = feedback.filter(item => feedbackFilter === 'all' || item.feedbackStatus === feedbackFilter);
                        const currentIdx = filtered.findIndex(f => f.id === selectedFeedback.id);
                        if (currentIdx > 0) {
                          setSelectedFeedback(filtered[currentIdx - 1]);
                        }
                      }}
                      disabled={(() => {
                        const filtered = feedback.filter(item => feedbackFilter === 'all' || item.feedbackStatus === feedbackFilter);
                        return filtered.findIndex(f => f.id === selectedFeedback.id) <= 0;
                      })()}
                      style={{
                        padding: '2px 6px',
                        fontSize: '10px',
                        backgroundColor: 'transparent',
                        color: theme.textSecondary,
                        border: `1px solid ${theme.inputBorder}`,
                        borderRadius: '3px',
                        cursor: 'pointer',
                        opacity: (() => {
                          const filtered = feedback.filter(item => feedbackFilter === 'all' || item.feedbackStatus === feedbackFilter);
                          return filtered.findIndex(f => f.id === selectedFeedback.id) <= 0 ? 0.3 : 1;
                        })(),
                      }}
                    >
                      {'\u2039'}
                    </button>
                    <button
                      onClick={() => {
                        const filtered = feedback.filter(item => feedbackFilter === 'all' || item.feedbackStatus === feedbackFilter);
                        const currentIdx = filtered.findIndex(f => f.id === selectedFeedback.id);
                        if (currentIdx < filtered.length - 1) {
                          setSelectedFeedback(filtered[currentIdx + 1]);
                        }
                      }}
                      disabled={(() => {
                        const filtered = feedback.filter(item => feedbackFilter === 'all' || item.feedbackStatus === feedbackFilter);
                        const currentIdx = filtered.findIndex(f => f.id === selectedFeedback.id);
                        return currentIdx >= filtered.length - 1;
                      })()}
                      style={{
                        padding: '2px 6px',
                        fontSize: '10px',
                        backgroundColor: 'transparent',
                        color: theme.textSecondary,
                        border: `1px solid ${theme.inputBorder}`,
                        borderRadius: '3px',
                        cursor: 'pointer',
                        opacity: (() => {
                          const filtered = feedback.filter(item => feedbackFilter === 'all' || item.feedbackStatus === feedbackFilter);
                          const currentIdx = filtered.findIndex(f => f.id === selectedFeedback.id);
                          return currentIdx >= filtered.length - 1 ? 0.3 : 1;
                        })(),
                      }}
                    >
                      {'\u203A'}
                    </button>
                  </div>
                )}
                {/* Status action buttons as primary header element */}
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => handleStatusChange(selectedFeedback.id, 'open')}
                    disabled={selectedFeedback.feedbackStatus === 'open'}
                    style={{
                      padding: '4px 8px',
                      fontSize: '9px',
                      backgroundColor: selectedFeedback.feedbackStatus === 'open' ? theme.accent : 'transparent',
                      color: selectedFeedback.feedbackStatus === 'open' ? '#fff' : theme.textSecondary,
                      border: `1px solid ${selectedFeedback.feedbackStatus === 'open' ? theme.accent : theme.inputBorder}`,
                      borderRadius: '4px',
                      cursor: selectedFeedback.feedbackStatus === 'open' ? 'default' : 'pointer',
                      fontWeight: selectedFeedback.feedbackStatus === 'open' ? 500 : 400,
                    }}
                  >
                    Open
                  </button>
                  <button
                    onClick={() => handleStatusChange(selectedFeedback.id, 'resolved')}
                    disabled={selectedFeedback.feedbackStatus === 'resolved'}
                    style={{
                      padding: '4px 8px',
                      fontSize: '9px',
                      backgroundColor: selectedFeedback.feedbackStatus === 'resolved' ? '#22c55e' : 'transparent',
                      color: selectedFeedback.feedbackStatus === 'resolved' ? '#fff' : theme.textSecondary,
                      border: `1px solid ${selectedFeedback.feedbackStatus === 'resolved' ? '#22c55e' : theme.inputBorder}`,
                      borderRadius: '4px',
                      cursor: selectedFeedback.feedbackStatus === 'resolved' ? 'default' : 'pointer',
                      fontWeight: selectedFeedback.feedbackStatus === 'resolved' ? 500 : 400,
                    }}
                  >
                    Resolved
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => handleStatusChange(selectedFeedback.id, 'archived')}
                      disabled={selectedFeedback.feedbackStatus === 'archived'}
                      style={{
                        padding: '4px 8px',
                        fontSize: '9px',
                        backgroundColor: selectedFeedback.feedbackStatus === 'archived' ? theme.textSecondary : 'transparent',
                        color: selectedFeedback.feedbackStatus === 'archived' ? '#fff' : theme.textSecondary,
                        border: `1px solid ${selectedFeedback.feedbackStatus === 'archived' ? theme.textSecondary : theme.inputBorder}`,
                        borderRadius: '4px',
                        cursor: selectedFeedback.feedbackStatus === 'archived' ? 'default' : 'pointer',
                        fontWeight: selectedFeedback.feedbackStatus === 'archived' ? 500 : 400,
                      }}
                    >
                      Archive
                    </button>
                  )}
                </div>
              </div>

              {/* Message thread - scrollable */}
              <div style={{ flex: 1, overflowY: 'auto', marginBottom: '8px' }}>
                {/* Original feedback as first message */}
                <div style={{
                  padding: '8px 12px',
                  marginBottom: '8px',
                  borderRadius: '6px',
                  backgroundColor: theme.bgSecondary,
                  borderLeft: `3px solid ${theme.accent}`,
                }}>
                  <div style={{ fontSize: '9px', color: theme.textSecondary, marginBottom: '4px' }}>
                    {selectedFeedback.senderCallsign && (
                      <span style={copyableTextStyle}>{selectedFeedback.senderCallsign}</span>
                    )}
                    {selectedFeedback.senderCallsign && selectedFeedback.senderEmail && ' \u00B7 '}
                    {selectedFeedback.senderEmail
                      ? <span style={copyableTextStyle}>{selectedFeedback.senderEmail}</span>
                      : (!selectedFeedback.senderCallsign ? 'You' : null)}
                    {' \u2022 '} {formatRelativeTime(selectedFeedback.createdAt)}
                    <span style={{
                      marginLeft: '6px',
                      padding: '1px 4px',
                      backgroundColor: theme.accent,
                      color: '#fff',
                      borderRadius: '3px',
                      fontSize: '8px',
                    }}>
                      Original
                    </span>
                  </div>
                  {selectedFeedback.contentType === 'image' && selectedFeedback.imageUrl && (
                    <div
                      onClick={() => setExpandedImage({ url: selectedFeedback.imageUrl!, alt: 'Feedback screenshot' })}
                      style={{ cursor: 'pointer', display: 'inline-block' }}
                      title="Click to expand"
                    >
                      <CachedImage
                        imageUrl={selectedFeedback.imageUrl}
                        itemId={selectedFeedback.id}
                        alt="Feedback screenshot"
                        style={{
                          maxWidth: '120px',
                          maxHeight: '120px',
                          borderRadius: '4px',
                          marginBottom: selectedFeedback.contentText ? '4px' : 0,
                          objectFit: 'cover',
                        }}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    </div>
                  )}
                  {selectedFeedback.contentText && (
                    <div style={{ fontSize: '12px', color: theme.text, whiteSpace: 'pre-wrap', ...copyableTextStyle }}>
                      {selectedFeedback.contentText}
                    </div>
                  )}
                </div>

                {/* Combine activity log and replies chronologically */}
                {(() => {
                  // Merge activity entries and replies, sorted by time
                  const threadItems: Array<{ type: 'activity' | 'reply'; item: ActivityLogEntry | SocialMessage; time: number }> = [];

                  // Add activity log entries (skip 'created' since original is shown above)
                  activityLog.forEach(entry => {
                    if (entry.action !== 'created') {
                      threadItems.push({ type: 'activity', item: entry, time: entry.createdAt });
                    }
                  });

                  // Add replies
                  feedbackReplies.forEach(reply => {
                    threadItems.push({ type: 'reply', item: reply, time: reply.createdAt });
                  });

                  // Sort by time
                  threadItems.sort((a, b) => a.time - b.time);

                  return threadItems.map((threadItem) => {
                    if (threadItem.type === 'activity') {
                      const entry = threadItem.item as ActivityLogEntry;
                      return (
                        <div key={`activity-${entry.id}`} style={{
                          textAlign: 'center',
                          fontSize: '10px',
                          color: theme.textSecondary,
                          padding: '4px 0',
                          marginBottom: '4px',
                        }}>
                          {entry.action === 'status_changed' && (
                            <>Status changed to <strong>{entry.newStatus}</strong> {'\u2022'} {formatRelativeTime(entry.createdAt)}</>
                          )}
                          {entry.action === 'replied' && (
                            <><span style={copyableTextStyle}>{entry.userEmail}</span> replied {'\u2022'} {formatRelativeTime(entry.createdAt)}</>
                          )}
                        </div>
                      );
                    } else {
                      const reply = threadItem.item as SocialMessage;
                      return (
                        <div
                          key={reply.id}
                          style={{
                            padding: '8px 12px',
                            marginBottom: '4px',
                            borderRadius: '6px',
                            backgroundColor: theme.bgSecondary,
                          }}
                        >
                          <div style={{ fontSize: '9px', color: theme.textSecondary, marginBottom: '2px' }}>
                            {reply.senderCallsign && (
                              <span style={copyableTextStyle}>{reply.senderCallsign}</span>
                            )}
                            {reply.senderCallsign && reply.senderEmail && ' \u00B7 '}
                            {reply.senderEmail
                              ? <span style={copyableTextStyle}>{reply.senderEmail}</span>
                              : (!reply.senderCallsign
                                ? (reply.senderUserId === selectedFeedback.senderUserId ? 'You' : 'Field Theory Support')
                                : null)}
                            {' \u2022 '} {formatRelativeTime(reply.createdAt)}
                          </div>
                          {reply.contentType === 'image' && reply.imageUrl && (
                            <div
                              onClick={() => setExpandedImage({ url: reply.imageUrl!, alt: 'Reply image' })}
                              style={{ cursor: 'pointer', display: 'inline-block' }}
                              title="Click to expand"
                            >
                              <CachedImage
                                imageUrl={reply.imageUrl}
                                itemId={reply.id}
                                alt="Reply image"
                                style={{
                                  maxWidth: '80px',
                                  maxHeight: '80px',
                                  borderRadius: '4px',
                                  marginBottom: reply.contentText ? '4px' : 0,
                                  objectFit: 'cover',
                                }}
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                            </div>
                          )}
                          {reply.contentText && (
                            <div style={{ fontSize: '12px', color: theme.text, ...copyableTextStyle }}>
                              {reply.contentText}
                            </div>
                          )}
                        </div>
                      );
                    }
                  });
                })()}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {replyImage && (
                  <div style={{
                    position: 'relative',
                    display: 'inline-block',
                    alignSelf: 'flex-start',
                  }}>
                    <img
                      src={replyImage.preview}
                      alt="Pasted image"
                      style={{
                        maxWidth: '200px',
                        maxHeight: '120px',
                        borderRadius: '4px',
                        border: `1px solid ${theme.inputBorder}`,
                      }}
                    />
                    <button
                      onClick={clearReplyImage}
                      style={{
                        position: 'absolute',
                        top: '-6px',
                        right: '-6px',
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        backgroundColor: theme.error,
                        color: '#fff',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        lineHeight: 1,
                      }}
                      title="Remove image"
                    >
                      x
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    ref={replyInputRef}
                    type="text"
                    placeholder={replyImage ? "Add a caption..." : "Type a message... (Cmd+V to paste images)"}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !sending && handleSendReply()}
                    onPaste={handlePaste}
                    style={{
                      flex: 1,
                      padding: '8px',
                      fontSize: '12px',
                      border: `1px solid ${theme.inputBorder}`,
                      borderRadius: '4px',
                      backgroundColor: theme.inputBg,
                      color: theme.text,
                    }}
                  />
                  <button
                    onClick={handleSendReply}
                    disabled={sending || (!replyText.trim() && !replyImage)}
                    style={{
                      padding: '8px 16px',
                      fontSize: '11px',
                      backgroundColor: theme.accent,
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: sending ? 'wait' : 'pointer',
                      opacity: sending || (!replyText.trim() && !replyImage) ? 0.5 : 1,
                    }}
                  >
                    {sending ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            // Feedback compose mode - allows creating new feedback directly.
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '20px',
            }}>
              {/* Wrapper for consistent width */}
              <div style={{ maxWidth: '500px', width: '100%' }}>
                <div style={{ fontSize: '14px', fontWeight: 500, color: theme.text, marginBottom: '12px', textAlign: 'left' }}>
                  Send Feedback
                </div>

                {/* Card container */}
                <div style={{
                  width: '100%',
                  border: `1px solid ${theme.inputBorder}`,
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}>
                {/* Image preview */}
                {replyImage && (
                  <div style={{
                    position: 'relative',
                    padding: '12px',
                    borderBottom: `1px solid ${theme.inputBorder}`,
                  }}>
                    <img
                      src={replyImage.preview}
                      alt="Pasted image"
                      style={{
                        maxWidth: '100%',
                        maxHeight: '200px',
                        borderRadius: '4px',
                        display: 'block',
                      }}
                    />
                    <button
                      onClick={clearReplyImage}
                      style={{
                        position: 'absolute',
                        top: '6px',
                        right: '6px',
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        backgroundColor: '#ef4444',
                        color: '#fff',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        lineHeight: 1,
                      }}
                      title="Remove image"
                    >
                      x
                    </button>
                  </div>
                )}

                {/* Text input row */}
                <div style={{ display: 'flex', padding: '8px' }}>
                  <input
                    type="text"
                    placeholder={replyImage ? "Add a caption..." : "Type or paste..."}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !sending && handleNewFeedback()}
                    onPaste={handlePaste}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      fontSize: '12px',
                      border: 'none',
                      backgroundColor: 'transparent',
                      color: theme.text,
                      outline: 'none',
                    }}
                  />
                  <button
                    onClick={handleNewFeedback}
                    disabled={sending || (!replyText.trim() && !replyImage)}
                    style={{
                      padding: '8px 14px',
                      fontSize: '12px',
                      fontWeight: 500,
                      backgroundColor: theme.accent,
                      color: '#fff',
                      border: 'none',
                      borderRadius: '5px',
                      cursor: sending ? 'wait' : 'pointer',
                      opacity: sending || (!replyText.trim() && !replyImage) ? 0.5 : 1,
                    }}
                  >
                    {sending ? '...' : 'Send'}
                  </button>
                </div>

                {/* Divider */}
                <div style={{ borderTop: `1px solid ${theme.inputBorder}` }} />

                {/* Transcription button */}
                <button
                  onClick={() => {
                    // Mark that recording was started from feedback button (not global hotkey)
                    if (transcriptionStatus === 'idle') {
                      startedFromFeedbackButton.current = true;
                    }
                    window.transcribeAPI?.toggleRecording?.();
                  }}
                  disabled={transcriptionStatus === 'transcribing'}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    fontSize: '12px',
                    backgroundColor: transcriptionStatus === 'recording' ? '#ef4444' : 'transparent',
                    color: transcriptionStatus === 'recording' ? '#fff' : theme.textSecondary,
                    border: 'none',
                    cursor: transcriptionStatus === 'transcribing' ? 'wait' : 'pointer',
                    opacity: transcriptionStatus === 'transcribing' ? 0.7 : 1,
                    transition: 'all 0.2s ease',
                  }}
                >
                  {transcriptionStatus === 'recording' ? 'Stop recording' :
                   transcriptionStatus === 'transcribing' ? 'Transcribing...' :
                   'Record voice feedback'}
                </button>
              </div>

                {/* Email link outside card */}
                <div style={{
                  marginTop: '12px',
                  fontSize: '11px',
                  color: theme.textSecondary,
                  textAlign: 'right',
                }}>
                  or email{' '}
                  <a
                    href="mailto:support@fieldtheory.dev"
                    style={{ color: theme.accent, textDecoration: 'none' }}
                  >
                    support@fieldtheory.dev
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
