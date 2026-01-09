/**
 * DMsView - DMs and Feedback view for Field Theory.
 * 
 * Shows:
 * - List of DM conversations with contacts
 * - Feedback section (submitted by user, or all feedback if admin)
 * - Contact management (add friend, team/friend badges)
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';

// =============================================================================
// Types - Mirror the types from window.d.ts
// =============================================================================

interface SocialMessage {
  id: string;
  type: 'dm' | 'feedback';
  senderUserId: string;
  senderEmail: string | null;
  senderName: string | null;
  recipientUserId: string;
  recipientEmail: string | null;
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

interface SocialContact {
  id: string;
  ownerUserId: string;
  contactEmail: string;
  contactUserId: string | null;
  contactName: string | null;
  relationshipType: 'team' | 'friend' | null;
  status: 'pending' | 'accepted';
  createdAt: number;
}

interface DMConversation {
  otherUserId: string;
  otherUserEmail: string;
  otherUserName: string | null;
  relationshipType: 'team' | 'friend' | null;
  lastMessage: SocialMessage | null;
  unreadCount: number;
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
 * Get display name for a contact (name or email).
 */
function getDisplayName(name: string | null, email: string | null): string {
  return name || email || 'Unknown';
}

// =============================================================================
// Component
// =============================================================================

interface DMsViewProps {
  onSendDM?: (recipientUserId: string, localItemId: number) => void;
  feedbackOnly?: boolean;
}

export default function DMsView({ onSendDM, feedbackOnly = false }: DMsViewProps) {
  const { theme } = useTheme();
  
  // State
  const [conversations, setConversations] = useState<DMConversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<SocialMessage[]>([]);
  const [feedback, setFeedback] = useState<SocialMessage[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [contacts, setContacts] = useState<SocialContact[]>([]);
  const [loading, setLoading] = useState(true);
  // When feedbackOnly, always start in feedback mode.
  const [activeTab, setActiveTab] = useState<'dms' | 'feedback'>(feedbackOnly ? 'feedback' : 'dms');
  const [selectedFeedback, setSelectedFeedback] = useState<SocialMessage | null>(null);
  const [feedbackReplies, setFeedbackReplies] = useState<SocialMessage[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [replyText, setReplyText] = useState('');
  const [replyImage, setReplyImage] = useState<{ base64: string; preview: string } | null>(null);
  const [addFriendEmail, setAddFriendEmail] = useState('');
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sending, setSending] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);

  // ==========================================================================
  // Data Loading
  // ==========================================================================

  const loadData = useCallback(async () => {
    if (!window.socialAPI) return;
    
    setLoading(true);
    try {
      const [convos, admin, contactList] = await Promise.all([
        window.socialAPI.getConversations(),
        window.socialAPI.isAdmin(),
        window.socialAPI.getContacts(),
      ]);
      
      setConversations(convos);
      setIsAdmin(admin);
      setContacts(contactList);
      
      // Load feedback based on admin status.
      if (admin) {
        const allFeedback = await window.socialAPI.getAllFeedback();
        setFeedback(allFeedback);
        
        // Mark unread feedback items as read when admin views the list.
        // Admin is the recipient of user-submitted feedback.
        for (const item of allFeedback) {
          if (!item.readAt) {
            await window.socialAPI.markAsRead(item.id);
          }
        }
      } else {
        const myFeedback = await window.socialAPI.getMyFeedback();
        setFeedback(myFeedback);
      }
    } catch (err) {
      console.error('[DMsView] Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load messages for selected conversation.
  const loadMessages = useCallback(async (otherUserId: string) => {
    if (!window.socialAPI) return;
    
    const msgs = await window.socialAPI.getDMsWithUser(otherUserId);
    setMessages(msgs);
    
    // Mark messages from the other user as read.
    for (const msg of msgs) {
      if (!msg.readAt && msg.senderUserId === otherUserId) {
        await window.socialAPI.markAsRead(msg.id);
      }
    }
  }, []);

  // Load feedback replies and activity log, and mark as read.
  const loadFeedbackDetails = useCallback(async (feedbackItem: SocialMessage) => {
    if (!window.socialAPI) return;
    
    const [replies, log] = await Promise.all([
      window.socialAPI.getFeedbackReplies(feedbackItem.id),
      window.socialAPI.getActivityLog(feedbackItem.id),
    ]);
    
    setFeedbackReplies(replies);
    setActivityLog(log);
    
    // Mark the original feedback as read if unread.
    let markedAny = false;
    if (!feedbackItem.readAt) {
      await window.socialAPI.markAsRead(feedbackItem.id);
      markedAny = true;
    }
    
    // Mark unread replies as read.
    for (const reply of replies) {
      if (!reply.readAt) {
        await window.socialAPI.markAsRead(reply.id);
        markedAny = true;
      }
    }
    
    // Reload feedback list if we marked anything as read.
    if (markedAny) {
      const feedbackList = await window.socialAPI.getMyFeedback();
      setFeedback(feedbackList);
    }
  }, []);

  // Initial load.
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load messages when conversation is selected.
  useEffect(() => {
    if (selectedConversation) {
      loadMessages(selectedConversation);
    }
  }, [selectedConversation, loadMessages]);

  // Load feedback details when feedback is selected.
  useEffect(() => {
    if (selectedFeedback) {
      loadFeedbackDetails(selectedFeedback);
    }
  }, [selectedFeedback, loadFeedbackDetails]);

  // Listen for new messages (Hot Mic).
  useEffect(() => {
    if (!window.socialAPI) return;
    
    const unsubscribe = window.socialAPI.onMessageReceived((message) => {
      // Refresh conversations list.
      loadData();
      
      // If the message is for the current conversation, add it.
      if (selectedConversation && 
          (message.senderUserId === selectedConversation || message.recipientUserId === selectedConversation)) {
        setMessages(prev => [...prev, message]);
      }
    });
    
    return unsubscribe;
  }, [loadData, selectedConversation]);

  // Scroll to bottom when messages change.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, feedbackReplies]);

  // Get current list items based on active tab.
  const listItems = activeTab === 'dms' ? conversations : feedback;

  // Reset selectedIndex when switching tabs or when list changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [activeTab]);

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
        if (showAddFriend) {
          e.preventDefault();
          setShowAddFriend(false);
          return;
        }
        if (selectedConversation || selectedFeedback) {
          e.preventDefault();
          setSelectedConversation(null);
          setSelectedFeedback(null);
          return;
        }
        window.clipboardAPI?.closeWindow();
        return;
      }

      // j/k or Arrow keys: Navigate list.
      if (key === 'j' || key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, listItems.length - 1));
        return;
      }
      if (key === 'k' || key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        return;
      }

      // Enter: Select the current item.
      if (key === 'Enter' && listItems.length > 0) {
        e.preventDefault();
        if (activeTab === 'dms') {
          const convo = conversations[selectedIndex];
          if (convo) setSelectedConversation(convo.otherUserId);
        } else {
          const item = feedback[selectedIndex];
          if (item) setSelectedFeedback(item);
        }
        return;
      }

      // 1 or d: Switch to DMs tab.
      if ((key === '1' || key === 'd') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setActiveTab('dms');
        setSelectedConversation(null);
        setSelectedFeedback(null);
        return;
      }

      // 2 or f: Switch to Feedback tab.
      if ((key === '2' || key === 'f') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setActiveTab('feedback');
        setSelectedConversation(null);
        setSelectedFeedback(null);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, conversations, feedback, listItems.length, selectedIndex, showAddFriend, selectedConversation, selectedFeedback]);

  // Scroll selected item into view.
  useEffect(() => {
    if (!listRef.current) return;
    const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
    selectedElement?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIndex]);

  // ==========================================================================
  // Actions
  // ==========================================================================

  const handleAddFriend = async () => {
    if (!window.socialAPI || !addFriendEmail.trim()) return;
    
    setError(null);
    const result = await window.socialAPI.addFriend(addFriendEmail.trim());
    
    if (result.success) {
      setAddFriendEmail('');
      setShowAddFriend(false);
      loadData();
    } else {
      setError(result.error || 'Failed to add friend');
    }
  };

  const handleSendReply = async () => {
    if (!window.socialAPI) return;
    
    // Need either text or image to send.
    const hasContent = replyText.trim() || replyImage;
    if (!hasContent) return;
    
    setSending(true);
    try {
      if (selectedFeedback) {
        // Reply to feedback.
        const recipientId = isAdmin ? selectedFeedback.senderUserId : selectedFeedback.recipientUserId;
        
        if (replyImage) {
          // Send image reply (with optional text).
          await window.socialAPI.sendImageReply(
            recipientId, 
            replyImage.base64, 
            replyText.trim() || undefined, 
            selectedFeedback.id
          );
        } else {
          // Send text-only reply.
          await window.socialAPI.sendTextDM(recipientId, replyText.trim(), selectedFeedback.id);
        }
        
        setReplyText('');
        setReplyImage(null);
        loadFeedbackDetails(selectedFeedback);
      } else if (selectedConversation) {
        // Reply to DM.
        if (replyImage) {
          await window.socialAPI.sendImageReply(
            selectedConversation, 
            replyImage.base64, 
            replyText.trim() || undefined
          );
        } else {
          await window.socialAPI.sendTextDM(selectedConversation, replyText.trim());
        }
        
        setReplyText('');
        setReplyImage(null);
        loadMessages(selectedConversation);
      }
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
    loadData();
    
    if (selectedFeedback && selectedFeedback.id === feedbackId) {
      loadFeedbackDetails(selectedFeedback);
    }
  };

  // ==========================================================================
  // Render Helpers
  // ==========================================================================

  const renderBadge = (type: 'team' | 'friend' | 'pending' | null) => {
    if (!type) return null;
    
    const colors = {
      team: { bg: '#3b82f6', text: '#fff' },
      friend: { bg: '#10b981', text: '#fff' },
      pending: { bg: '#6b7280', text: '#fff' },
    };
    
    const { bg, text } = colors[type] || colors.pending;
    
    return (
      <span style={{
        fontSize: '9px',
        padding: '1px 4px',
        borderRadius: '3px',
        backgroundColor: bg,
        color: text,
        marginLeft: '6px',
        fontWeight: 500,
      }}>
        {type.toUpperCase()}
      </span>
    );
  };

  const renderStatusBadge = (status: 'open' | 'resolved' | 'archived' | null) => {
    if (!status) return null;
    
    const colors = {
      open: { bg: '#f59e0b', text: '#000' },
      resolved: { bg: '#10b981', text: '#fff' },
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

  if (loading) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: theme.textSecondary,
        fontSize: '12px',
      }}>
        Loading...
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
      {/* Sub-tabs: When feedbackOnly is true, just show title; otherwise show DMs/Feedback tabs */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '12px',
        alignItems: 'center',
      }}>
        {feedbackOnly ? (
          // Feedback-only mode: show header instead of tabs.
          <div style={{ 
            fontSize: '12px', 
            fontWeight: 500, 
            color: theme.text,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            Send Feedback
            <span style={{ fontSize: '10px', color: theme.textSecondary, fontWeight: 400 }}>
              Use Field Theory to transcribe your feedback
            </span>
          </div>
        ) : (
          // Full mode: show DMs and Feedback tabs.
          <>
            {(['dms', 'feedback'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  setSelectedConversation(null);
                  setSelectedFeedback(null);
                }}
                style={{
                  padding: '6px 8px',
                  fontSize: '10px',
                  fontWeight: 400,
                  backgroundColor: activeTab === tab ? theme.accent : 'transparent',
                  color: activeTab === tab ? '#fff' : theme.textSecondary,
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  outline: 'none',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== tab) {
                    e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== tab) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                {tab === 'dms' ? 'Direct Messages' : 'Send Feedback'}
                {tab === 'feedback' && feedback.filter(f => f.feedbackStatus === 'open').length > 0 && (
                  <span style={{
                    marginLeft: '4px',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: '#f59e0b',
                    display: 'inline-block',
                  }} />
                )}
              </button>
            ))}
            
            {/* Add Friend button - only show in full mode */}
            <button
              onClick={() => setShowAddFriend(true)}
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
              + Add Friend
            </button>
          </>
        )}
      </div>

      {/* Add Friend Modal */}
      {showAddFriend && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
        }} onClick={() => setShowAddFriend(false)}>
          <div
            style={{
              backgroundColor: theme.bgSecondary,
              padding: '20px',
              borderRadius: '8px',
              width: '300px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: theme.text }}>
              Add Friend
            </h3>
            <input
              type="email"
              placeholder="friend@example.com"
              value={addFriendEmail}
              onChange={(e) => setAddFriendEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddFriend()}
              style={{
                width: '100%',
                padding: '8px',
                fontSize: '12px',
                border: `1px solid ${theme.inputBorder}`,
                borderRadius: '4px',
                backgroundColor: theme.inputBg,
                color: theme.text,
                marginBottom: '8px',
                boxSizing: 'border-box',
              }}
            />
            {error && (
              <div style={{ color: '#ef4444', fontSize: '11px', marginBottom: '8px' }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowAddFriend(false)}
                style={{
                  padding: '6px 12px',
                  fontSize: '11px',
                  backgroundColor: 'transparent',
                  color: theme.textSecondary,
                  border: `1px solid ${theme.inputBorder}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddFriend}
                style={{
                  padding: '6px 12px',
                  fontSize: '11px',
                  backgroundColor: theme.accent,
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content area */}
      <div style={{
        flex: 1,
        display: 'flex',
        gap: '12px',
        overflow: 'hidden',
      }}>
        {/* Left panel: Conversations or Feedback list */}
        <div
          ref={listRef}
          style={{
            width: '200px',
            flexShrink: 0,
            overflowY: 'auto',
            borderRight: `1px solid ${theme.inputBorder}`,
            paddingRight: '12px',
          }}
        >
          {activeTab === 'dms' ? (
            // DM Conversations list
            conversations.length === 0 ? (
              <div style={{ color: theme.textSecondary, fontSize: '11px', padding: '8px' }}>
                No conversations yet. Press D on an item to send a DM.
              </div>
            ) : (
              conversations.map((convo, index) => (
                <div
                  key={convo.otherUserId}
                  onClick={() => {
                    setSelectedConversation(convo.otherUserId);
                    setSelectedIndex(index);
                  }}
                  style={{
                    padding: '8px',
                    marginBottom: '4px',
                    borderRadius: '4px',
                    backgroundColor: selectedConversation === convo.otherUserId 
                      ? theme.bgSecondary 
                      : index === selectedIndex 
                        ? `${theme.bgSecondary}80` 
                        : 'transparent',
                    cursor: 'pointer',
                    outline: index === selectedIndex ? `1px solid ${theme.accent}40` : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                    <span style={{ fontSize: '11px', color: theme.text, fontWeight: 500 }}>
                      {getDisplayName(convo.otherUserName, convo.otherUserEmail)}
                    </span>
                    {renderBadge(convo.relationshipType)}
                    {convo.unreadCount > 0 && (
                      <span style={{
                        marginLeft: 'auto',
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: '#f59e0b',
                        display: 'inline-block',
                      }} />
                    )}
                  </div>
                  {convo.lastMessage && (
                    <div style={{
                      fontSize: '10px',
                      color: theme.textSecondary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {convo.lastMessage.contentText?.slice(0, 40) || '[Image]'}
                    </div>
                  )}
                </div>
              ))
            )
          ) : (
            // Feedback list
            feedback.length === 0 ? (
              <div style={{ color: theme.textSecondary, fontSize: '11px', padding: '8px' }}>
                No feedback yet. Press F on an item to submit feedback.
              </div>
            ) : (
              feedback.map((item, index) => (
                <div
                  key={item.id}
                  onClick={() => {
                    setSelectedFeedback(item);
                    setSelectedIndex(index);
                  }}
                  style={{
                    padding: '8px',
                    marginBottom: '4px',
                    borderRadius: '4px',
                    backgroundColor: selectedFeedback?.id === item.id 
                      ? theme.bgSecondary 
                      : index === selectedIndex 
                        ? `${theme.bgSecondary}80` 
                        : 'transparent',
                    cursor: 'pointer',
                    opacity: item.feedbackStatus === 'archived' ? 0.5 : 1,
                    outline: index === selectedIndex ? `1px solid ${theme.accent}40` : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
                    {renderStatusBadge(item.feedbackStatus)}
                    <span style={{ marginLeft: 'auto', fontSize: '9px', color: theme.textSecondary }}>
                      {formatRelativeTime(item.createdAt)}
                    </span>
                  </div>
                  <div style={{
                    fontSize: '10px',
                    color: theme.text,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {item.contentText?.slice(0, 50) || '[Image]'}
                  </div>
                  {isAdmin && (
                    <div style={{ fontSize: '9px', color: theme.textSecondary, marginTop: '2px' }}>
                      From: {item.senderEmail}
                    </div>
                  )}
                </div>
              ))
            )
          )}
        </div>

        {/* Right panel: Messages or Feedback detail */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {activeTab === 'dms' && selectedConversation ? (
            // DM Messages
            <>
              <div style={{
                flex: 1,
                overflowY: 'auto',
                marginBottom: '8px',
              }}>
                {messages.map((msg) => {
                  const isFromMe = msg.senderUserId !== selectedConversation;
                  return (
                    <div
                      key={msg.id}
                      style={{
                        display: 'flex',
                        justifyContent: isFromMe ? 'flex-end' : 'flex-start',
                        marginBottom: '8px',
                      }}
                    >
                      <div style={{
                        maxWidth: '70%',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        backgroundColor: isFromMe ? theme.accent : theme.bgSecondary,
                        color: isFromMe ? '#fff' : theme.text,
                      }}>
                        {msg.contentType === 'image' && msg.imageUrl && (
                          <img
                            src={msg.imageUrl}
                            alt="Shared image"
                            style={{
                              maxWidth: '200px',
                              borderRadius: '4px',
                              marginBottom: msg.contentText ? '4px' : 0,
                            }}
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        )}
                        {msg.contentText && (
                          <div style={{ fontSize: '12px', whiteSpace: 'pre-wrap' }}>
                            {msg.contentText}
                          </div>
                        )}
                        <div style={{
                          fontSize: '9px',
                          opacity: 0.7,
                          marginTop: '4px',
                          textAlign: 'right',
                        }}>
                          {formatRelativeTime(msg.createdAt)}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply input with image preview */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Image preview - shown when an image is pasted */}
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
                      ×
                    </button>
                  </div>
                )}
                
                {/* Text input and send button */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder={replyImage ? "Add a caption (optional)..." : "Type a message... (paste images with Cmd+V)"}
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
          ) : activeTab === 'feedback' && selectedFeedback ? (
            // Feedback detail
            <>
              {/* Status controls */}
              <div style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '12px',
                alignItems: 'center',
              }}>
                {renderStatusBadge(selectedFeedback.feedbackStatus)}
                <div style={{ display: 'flex', gap: '4px', marginLeft: 'auto' }}>
                  <button
                    onClick={() => handleStatusChange(selectedFeedback.id, 'open')}
                    disabled={selectedFeedback.feedbackStatus === 'open'}
                    style={{
                      padding: '4px 8px',
                      fontSize: '9px',
                      backgroundColor: selectedFeedback.feedbackStatus === 'open' ? theme.bgSecondary : 'transparent',
                      color: theme.textSecondary,
                      border: `1px solid ${theme.inputBorder}`,
                      borderRadius: '4px',
                      cursor: 'pointer',
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
                      backgroundColor: selectedFeedback.feedbackStatus === 'resolved' ? theme.bgSecondary : 'transparent',
                      color: theme.textSecondary,
                      border: `1px solid ${theme.inputBorder}`,
                      borderRadius: '4px',
                      cursor: 'pointer',
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
                        backgroundColor: selectedFeedback.feedbackStatus === 'archived' ? theme.bgSecondary : 'transparent',
                        color: theme.textSecondary,
                        border: `1px solid ${theme.inputBorder}`,
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      Archive
                    </button>
                  )}
                </div>
              </div>

              {/* Original feedback content */}
              <div style={{
                padding: '12px',
                backgroundColor: theme.bgSecondary,
                borderRadius: '8px',
                marginBottom: '12px',
              }}>
                {selectedFeedback.contentType === 'image' && selectedFeedback.imageUrl && (
                  <img
                    src={selectedFeedback.imageUrl}
                    alt="Feedback screenshot"
                    style={{
                      maxWidth: '100%',
                      borderRadius: '4px',
                      marginBottom: selectedFeedback.contentText ? '8px' : 0,
                    }}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                )}
                {selectedFeedback.contentText && (
                  <div style={{ fontSize: '12px', color: theme.text, whiteSpace: 'pre-wrap' }}>
                    {selectedFeedback.contentText}
                  </div>
                )}
                <div style={{ fontSize: '9px', color: theme.textSecondary, marginTop: '8px' }}>
                  Submitted {formatRelativeTime(selectedFeedback.createdAt)}
                  {isAdmin && ` by ${selectedFeedback.senderEmail}`}
                </div>
              </div>

              {/* Activity log */}
              {activityLog.length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '10px', color: theme.textSecondary, marginBottom: '4px' }}>
                    Activity
                  </div>
                  {activityLog.map((entry) => (
                    <div key={entry.id} style={{
                      fontSize: '10px',
                      color: theme.textSecondary,
                      padding: '4px 0',
                    }}>
                      <span style={{ color: theme.text }}>{entry.userEmail}</span>
                      {' '}
                      {entry.action === 'created' && 'submitted feedback'}
                      {entry.action === 'status_changed' && `changed status from ${entry.oldStatus} to ${entry.newStatus}`}
                      {entry.action === 'replied' && 'replied'}
                      {' '}
                      <span>{formatRelativeTime(entry.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Replies thread */}
              <div style={{ flex: 1, overflowY: 'auto', marginBottom: '8px' }}>
                {feedbackReplies.map((reply) => (
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
                      {reply.senderEmail} • {formatRelativeTime(reply.createdAt)}
                    </div>
                    {reply.contentType === 'image' && reply.imageUrl && (
                      <img
                        src={reply.imageUrl}
                        alt="Reply image"
                        style={{
                          maxWidth: '200px',
                          borderRadius: '4px',
                          marginBottom: reply.contentText ? '4px' : 0,
                        }}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    )}
                    {reply.contentText && (
                      <div style={{ fontSize: '12px', color: theme.text }}>
                        {reply.contentText}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply input with image preview */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Image preview - shown when an image is pasted */}
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
                      ×
                    </button>
                  </div>
                )}
                
                {/* Text input and send button */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    ref={replyInputRef}
                    type="text"
                    placeholder={replyImage ? "Add a caption (optional)..." : "Add a reply... (paste images with Cmd+V)"}
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
                    {sending ? 'Sending...' : 'Reply'}
                  </button>
                </div>
              </div>
            </>
          ) : activeTab === 'feedback' ? (
            // Feedback compose mode - allows creating new feedback directly.
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '20px',
            }}>
              <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '14px', fontWeight: 500, color: theme.text, marginBottom: '4px' }}>
                  New Feedback
                </div>
                <div style={{ fontSize: '11px', color: theme.textSecondary }}>
                  Type a message, paste an image, or use <kbd style={{ 
                    padding: '1px 4px', 
                    backgroundColor: theme.bgSecondary, 
                    borderRadius: '3px',
                    fontSize: '10px',
                  }}>F</kbd> on a Field to send it as feedback
                </div>
              </div>
              
              {/* Image preview */}
              {replyImage && (
                <div style={{ 
                  position: 'relative', 
                  display: 'inline-block',
                  alignSelf: 'center',
                  marginBottom: '8px',
                }}>
                  <img 
                    src={replyImage.preview} 
                    alt="Pasted image" 
                    style={{ 
                      maxWidth: '300px', 
                      maxHeight: '200px', 
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
                    ×
                  </button>
                </div>
              )}
              
              {/* Compose input */}
              <div style={{ display: 'flex', gap: '8px', maxWidth: '500px', alignSelf: 'center', width: '100%' }}>
                <input
                  type="text"
                  placeholder={replyImage ? "Add a caption (optional)..." : "Type your feedback... (paste images with Cmd+V)"}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !sending && handleNewFeedback()}
                  onPaste={handlePaste}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    fontSize: '12px',
                    border: `1px solid ${theme.inputBorder}`,
                    borderRadius: '6px',
                    backgroundColor: theme.inputBg,
                    color: theme.text,
                  }}
                />
                <button
                  onClick={handleNewFeedback}
                  disabled={sending || (!replyText.trim() && !replyImage)}
                  style={{
                    padding: '10px 16px',
                    fontSize: '12px',
                    fontWeight: 500,
                    backgroundColor: theme.accent,
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: sending ? 'wait' : 'pointer',
                    opacity: sending || (!replyText.trim() && !replyImage) ? 0.5 : 1,
                  }}
                >
                  {sending ? 'Sending...' : 'Send'}
                </button>
              </div>
            </div>
          ) : (
            // No selection (DMs tab)
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: theme.textSecondary,
              fontSize: '12px',
            }}>
              Select a conversation or press D on an item to send a DM
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

