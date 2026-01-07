/**
 * HotMicView - Hot Mic messaging view for Field Theory.
 * 
 * Hot Mic is a messaging system where:
 * - Team members are automatically added as friends
 * - Messages can be sent as regular messages or "Hot Mic" messages
 * - Hot Mic messages show up prominently on the recipient's screen if their Hot Mic is on
 * - If Hot Mic is off, messages just show as unread indicators
 * - The unread dot disappears once you view the message
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
  isHotMic: boolean; // Whether this message was sent as a Hot Mic message.
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

interface HotMicViewProps {
  onSendDM?: (recipientUserId: string, localItemId: number) => void;
}

export default function HotMicView({ onSendDM }: HotMicViewProps) {
  const { theme } = useTheme();
  
  // State
  const [conversations, setConversations] = useState<DMConversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<SocialMessage[]>([]);
  const [contacts, setContacts] = useState<SocialContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  // Hot Mic on/off toggle state - when on, incoming Hot Mic messages show as full preview.
  const [hotMicEnabled, setHotMicEnabled] = useState(false);
  
  // Compose state
  const [replyText, setReplyText] = useState('');
  const [replyImage, setReplyImage] = useState<{ base64: string; preview: string } | null>(null);
  const [sending, setSending] = useState(false);
  
  // Add friend modal
  const [addFriendEmail, setAddFriendEmail] = useState('');
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // New message modal (to start a conversation with a new user)
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [newMessageRecipient, setNewMessageRecipient] = useState('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ==========================================================================
  // Data Loading
  // ==========================================================================

  const loadData = useCallback(async () => {
    if (!window.socialAPI) return;
    
    setLoading(true);
    try {
      const [convos, contactList, hotMicStatus] = await Promise.all([
        window.socialAPI.getConversations(),
        window.socialAPI.getContacts(),
        window.socialAPI.getHotMicEnabled?.() ?? Promise.resolve(false),
      ]);
      
      setConversations(convos);
      setContacts(contactList);
      setHotMicEnabled(hotMicStatus);
    } catch (err) {
      console.error('[HotMicView] Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load messages for selected conversation and mark as read.
  const loadMessages = useCallback(async (userId: string) => {
    if (!window.socialAPI) return;
    
    const msgs = await window.socialAPI.getDMsWithUser(userId);
    setMessages(msgs);
    
    // Mark unread messages as read - this clears the unread indicator.
    for (const msg of msgs) {
      if (!msg.readAt && msg.recipientUserId !== msg.senderUserId) {
        await window.socialAPI.markAsRead(msg.id);
      }
    }
    
    // Reload conversations to update unread counts.
    const convos = await window.socialAPI.getConversations();
    setConversations(convos);
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
  }, [messages]);

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
        if (showNewMessage) {
          e.preventDefault();
          setShowNewMessage(false);
          return;
        }
        if (selectedConversation) {
          e.preventDefault();
          setSelectedConversation(null);
          return;
        }
        window.clipboardAPI?.closeWindow();
        return;
      }

      // j/k or Arrow keys: Navigate list.
      if (key === 'j' || key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, conversations.length - 1));
        return;
      }
      if (key === 'k' || key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        return;
      }

      // Enter: Select the current conversation.
      if (key === 'Enter' && conversations.length > 0) {
        e.preventDefault();
        const convo = conversations[selectedIndex];
        if (convo) setSelectedConversation(convo.otherUserId);
        return;
      }

      // n: New message.
      if (key === 'n' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShowNewMessage(true);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [conversations, selectedIndex, showAddFriend, showNewMessage, selectedConversation]);

  // Scroll selected item into view.
  useEffect(() => {
    if (!listRef.current) return;
    const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
    selectedElement?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIndex]);

  // ==========================================================================
  // Actions
  // ==========================================================================

  // Toggle Hot Mic on/off.
  const handleToggleHotMic = async () => {
    if (!window.socialAPI) return;
    
    const newValue = !hotMicEnabled;
    const success = await window.socialAPI.setHotMicEnabled?.(newValue);
    if (success) {
      setHotMicEnabled(newValue);
    }
  };

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

  // Send a message (regular or Hot Mic).
  const handleSendReply = async (asHotMic: boolean = false) => {
    if (!window.socialAPI) return;
    
    // Need either text or image to send.
    const hasContent = replyText.trim() || replyImage;
    if (!hasContent) return;
    
    setSending(true);
    try {
      if (selectedConversation) {
        if (replyImage) {
          await window.socialAPI.sendImageReply(
            selectedConversation, 
            replyImage.base64, 
            replyText.trim() || undefined,
            undefined, // parentMessageId
            asHotMic
          );
        } else {
          await window.socialAPI.sendTextDM(
            selectedConversation, 
            replyText.trim(),
            undefined, // parentMessageId
            asHotMic
          );
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

  // Start a new conversation with a user.
  const handleStartNewMessage = async () => {
    if (!newMessageRecipient.trim()) return;
    
    // First, add as friend if not already.
    if (window.socialAPI) {
      await window.socialAPI.addFriend(newMessageRecipient.trim());
    }
    
    // Find the user in contacts.
    const contact = contacts.find(
      c => c.contactEmail.toLowerCase() === newMessageRecipient.trim().toLowerCase()
    );
    
    if (contact?.contactUserId) {
      setSelectedConversation(contact.contactUserId);
    }
    
    setShowNewMessage(false);
    setNewMessageRecipient('');
    loadData();
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
      {/* Header with Hot Mic toggle and actions */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '12px',
        alignItems: 'center',
      }}>
        {/* Hot Mic toggle button - prominent visual indicator of on/off state */}
        <button
          onClick={handleToggleHotMic}
          style={{
            padding: '6px 12px',
            fontSize: '11px',
            fontWeight: 600,
            backgroundColor: hotMicEnabled ? '#DC2626' : theme.bgSecondary,
            color: hotMicEnabled ? '#fff' : theme.textSecondary,
            border: hotMicEnabled ? 'none' : `1px solid ${theme.inputBorder}`,
            borderRadius: '6px',
            cursor: 'pointer',
            outline: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.15s ease',
          }}
          title={hotMicEnabled 
            ? 'Hot Mic is ON - incoming hot mic messages will show as full preview' 
            : 'Hot Mic is OFF - messages will only show as notifications'}
        >
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: hotMicEnabled ? '#fff' : theme.textSecondary,
            animation: hotMicEnabled ? 'pulse 2s infinite' : 'none',
          }} />
          {hotMicEnabled ? 'Hot Mic ON' : 'Hot Mic OFF'}
        </button>

        <div style={{ flex: 1 }} />
        
        {/* New message button */}
        <button
          onClick={() => setShowNewMessage(true)}
          style={{
            padding: '4px 8px',
            fontSize: '9px',
            backgroundColor: theme.accent,
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          + New Message
        </button>
        
        {/* Add Friend button */}
        <button
          onClick={() => setShowAddFriend(true)}
          style={{
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

      {/* New Message Modal */}
      {showNewMessage && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
        }} onClick={() => setShowNewMessage(false)}>
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
              New Hot Mic Message
            </h3>
            <p style={{ margin: '0 0 12px 0', fontSize: '11px', color: theme.textSecondary }}>
              Enter the email of the person you want to message.
            </p>
            <input
              type="email"
              placeholder="recipient@example.com"
              value={newMessageRecipient}
              onChange={(e) => setNewMessageRecipient(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleStartNewMessage()}
              autoFocus
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
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowNewMessage(false)}
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
                onClick={handleStartNewMessage}
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
                Start Chat
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
        {/* Left panel: Conversations list */}
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
          {conversations.length === 0 ? (
            <div style={{ color: theme.textSecondary, fontSize: '11px', padding: '8px' }}>
              No conversations yet. Press N to start a new message or click + New Message.
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
                  {/* Unread indicator - only shows if there are unread messages */}
                  {convo.unreadCount > 0 && (
                    <span style={{
                      marginLeft: 'auto',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: '#DC2626',
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
          )}
        </div>

        {/* Right panel: Messages or empty state */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {selectedConversation ? (
            <>
              {/* Messages */}
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
                        backgroundColor: isFromMe 
                          ? (msg.isHotMic ? '#DC2626' : theme.accent) 
                          : theme.bgSecondary,
                        color: isFromMe ? '#fff' : theme.text,
                        position: 'relative',
                      }}>
                        {/* Hot Mic indicator */}
                        {msg.isHotMic && (
                          <span style={{
                            position: 'absolute',
                            top: '-6px',
                            right: isFromMe ? 'auto' : '-6px',
                            left: isFromMe ? '-6px' : 'auto',
                            backgroundColor: '#DC2626',
                            color: '#fff',
                            fontSize: '8px',
                            padding: '2px 4px',
                            borderRadius: '4px',
                            fontWeight: 600,
                          }}>
                            🔥
                          </span>
                        )}
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
                
                {/* Text input and send buttons */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder={replyImage ? "Add a caption (optional)..." : "Type a message... (paste images with Cmd+V)"}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !sending && handleSendReply(false)}
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
                  {/* Regular Send button */}
                  <button
                    onClick={() => handleSendReply(false)}
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
                    {sending ? '...' : 'Send'}
                  </button>
                  {/* Send as Hot Mic button - makes it show prominently on recipient's screen */}
                  <button
                    onClick={() => handleSendReply(true)}
                    disabled={sending || (!replyText.trim() && !replyImage)}
                    style={{
                      padding: '8px 12px',
                      fontSize: '11px',
                      backgroundColor: '#DC2626',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: sending ? 'wait' : 'pointer',
                      opacity: sending || (!replyText.trim() && !replyImage) ? 0.5 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                    title="Send as Hot Mic - shows prominently on recipient's screen if their Hot Mic is on"
                  >
                    🔥 Hot Mic
                  </button>
                </div>
              </div>
            </>
          ) : (
            // No selection - empty state
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: '12px',
              color: theme.textSecondary,
              fontSize: '12px',
            }}>
              <div style={{ fontSize: '32px' }}>🎤</div>
              <div>Select a conversation or press N to start a new message</div>
              <div style={{ fontSize: '10px', color: theme.textSecondary, opacity: 0.7 }}>
                {hotMicEnabled 
                  ? 'Your Hot Mic is ON - incoming hot mic messages will show as full preview' 
                  : 'Your Hot Mic is OFF - messages will only show as notifications'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
