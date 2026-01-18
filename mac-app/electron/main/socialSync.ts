/**
 * SocialSync - Handles DMs, Feedback, and Contacts.
 * 
 * Consolidated class for all social/messaging features:
 * - Direct Messages between users
 * - Feedback to admin (special type of DM)
 * - Contact management (team + friends)
 * - Supabase Realtime subscription for Hot Mic
 */

import { SupabaseClient, Session, RealtimeChannel } from '@supabase/supabase-js';
import { ClipboardManager, ClipboardItem as LocalClipboardItem } from './clipboardManager';
import { AuthManager } from './authManager';
import { EventEmitter } from 'events';
import crypto from 'crypto';

// =============================================================================
// Types
// =============================================================================

/**
 * Message from Supabase messages table.
 */
export interface Message {
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
  imageUrl: string | null;  // Signed URL for image access.
  stackId: string | null;
  sourceItemId: string | null;
  readAt: number | null;
  feedbackStatus: 'open' | 'resolved' | 'archived' | null;
  parentMessageId: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Contact from Supabase contacts table.
 */
export interface Contact {
  id: string;
  ownerUserId: string;
  contactEmail: string;
  contactUserId: string | null;
  contactName: string | null;
  relationshipType: 'team' | 'friend' | null;
  status: 'pending' | 'accepted';
  createdAt: number;
}

/**
 * DM conversation summary for list view.
 */
export interface DMConversation {
  otherUserId: string;
  otherUserEmail: string;
  otherUserName: string | null;
  relationshipType: 'team' | 'friend' | null;
  lastMessage: Message | null;
  unreadCount: number;
}

/**
 * User profile from Supabase.
 */
export interface UserProfile {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean;
  hotMicEnabled: boolean;
}

/**
 * Activity log entry.
 */
export interface ActivityLogEntry {
  id: string;
  messageId: string;
  userId: string;
  userEmail: string | null;
  action: 'created' | 'status_changed' | 'replied';
  oldStatus: string | null;
  newStatus: string | null;
  createdAt: number;
}

/**
 * Row from Supabase messages table.
 */
interface MessageRow {
  id: string;
  type: string;
  sender_user_id: string;
  recipient_user_id: string;
  content_type: string;
  content_text: string | null;
  image_path: string | null;
  stack_id: string | null;
  source_item_id: string | null;
  read_at: string | null;
  feedback_status: string | null;
  parent_message_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Row from Supabase contacts table.
 */
interface ContactRow {
  id: string;
  owner_user_id: string;
  contact_email: string;
  contact_user_id: string | null;
  relationship_type: string | null;
  status: string;
  created_at: string;
}

/**
 * Row from Supabase profiles table.
 */
interface ProfileRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  is_admin: boolean;
  hot_mic_enabled: boolean;
}

/**
 * Row from Supabase activity log table.
 */
interface ActivityLogRow {
  id: string;
  message_id: string;
  user_id: string;
  action: string;
  old_status: string | null;
  new_status: string | null;
  created_at: string;
}

// =============================================================================
// SocialSync Class
// =============================================================================

export class SocialSync extends EventEmitter {
  private clipboardManager: ClipboardManager;
  private authManager: AuthManager;
  private realtimeChannel: RealtimeChannel | null = null;
  private boundHandleSessionChanged: (session: Session | null) => void;

  // Cache of user profiles for display names.
  private profileCache: Map<string, UserProfile> = new Map();

  // Polling fallback for Hot Mic when Realtime isn't working.
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastPolledAt: string | null = null;
  private realtimeConnected: boolean = false;
  private readonly POLLING_INTERVAL_MS = 3000;  // Poll every 3 seconds as fallback.

  constructor(authManager: AuthManager, clipboardManager: ClipboardManager) {
    super();
    this.authManager = authManager;
    this.clipboardManager = clipboardManager;

    // Store bound handler reference for proper cleanup in destroy()
    this.boundHandleSessionChanged = this.handleSessionChanged.bind(this);

    // Subscribe to auth state changes.
    this.authManager.on('sessionChanged', this.boundHandleSessionChanged);

    // If already authenticated, setup realtime.
    if (this.isAuthenticated()) {
      this.setupRealtimeSubscription();
      this.startPollingFallback();
    }
  }

  // ===========================================================================
  // Setup
  // ===========================================================================

  /**
   * Handle session changes from AuthManager.
   */
  private handleSessionChanged(session: Session | null): void {
    if (session) {
      console.log('[SocialSync] Session changed for user:', session.user?.email);
      this.setupRealtimeSubscription();
      this.startPollingFallback();
    } else {
      console.log('[SocialSync] Session cleared');
      this.teardownRealtimeSubscription();
      this.stopPollingFallback();
    }
  }

  /**
   * Get Supabase client from AuthManager.
   */
  private get supabase(): SupabaseClient | null {
    return this.authManager.getSupabaseClient();
  }

  /**
   * Get session from AuthManager.
   */
  private get session(): Session | null {
    return this.authManager.getSession();
  }

  /**
   * Check if authenticated.
   */
  isAuthenticated(): boolean {
    return this.authManager.isAuthenticated();
  }

  /**
   * Get current user's ID.
   */
  private getUserId(): string | null {
    return this.session?.user?.id || null;
  }

  /**
   * Get current user's email.
   */
  private getUserEmail(): string | null {
    return this.session?.user?.email || null;
  }

  // ===========================================================================
  // Realtime Subscription
  // ===========================================================================

  /**
   * Subscribe to new messages for Hot Mic functionality.
   */
  private setupRealtimeSubscription(): void {
    if (!this.supabase || !this.session) return;

    const userId = this.getUserId();
    if (!userId) return;

    // Teardown existing subscription first.
    this.teardownRealtimeSubscription();

    console.log('[SocialSync] Setting up realtime subscription for messages, userId:', userId);

    // Subscribe to messages where current user is the recipient.
    this.realtimeChannel = this.supabase
      .channel('messages-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `recipient_user_id=eq.${userId}`,
        },
        async (payload) => {
          console.log('[SocialSync] New message received via Realtime:', payload);
          const row = payload.new as MessageRow;
          const message = await this.rowToMessage(row);
          this.emit('messageReceived', message);
        }
      )
      .subscribe((status, err) => {
        console.log('[SocialSync] Realtime subscription status:', status);
        if (err) {
          console.error('[SocialSync] Realtime subscription error:', err);
        }
        
        // Handle different states.
        if (status === 'TIMED_OUT') {
          console.log('[SocialSync] Realtime timed out, retrying in 3 seconds...');
          setTimeout(() => {
            if (this.isAuthenticated()) {
              this.setupRealtimeSubscription();
            }
          }, 3000);
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[SocialSync] Realtime channel error, retrying in 5 seconds...');
          setTimeout(() => {
            if (this.isAuthenticated()) {
              this.setupRealtimeSubscription();
            }
          }, 5000);
        } else if (status === 'SUBSCRIBED') {
          console.log('[SocialSync] Realtime subscription active - Hot Mic ready!');
          this.realtimeConnected = true;
          // Stop polling fallback since Realtime is working.
          this.stopPollingFallback();
        }
      });
  }

  /**
   * Unsubscribe from realtime updates.
   */
  private teardownRealtimeSubscription(): void {
    if (this.realtimeChannel) {
      console.log('[SocialSync] Tearing down realtime subscription');
      this.supabase?.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
    this.realtimeConnected = false;
  }

  // ===========================================================================
  // Polling Fallback for Hot Mic
  // ===========================================================================

  /**
   * Start polling for new messages as a fallback when Realtime isn't working.
   */
  private startPollingFallback(): void {
    if (this.pollingInterval) return;  // Already polling.
    
    console.log('[SocialSync] Starting polling fallback for Hot Mic');
    
    // Set initial timestamp to now to avoid fetching old messages.
    this.lastPolledAt = new Date().toISOString();
    
    this.pollingInterval = setInterval(async () => {
      // Skip if Realtime is connected.
      if (this.realtimeConnected) return;
      
      await this.pollForNewMessages();
    }, this.POLLING_INTERVAL_MS);
  }

  /**
   * Stop the polling fallback.
   */
  private stopPollingFallback(): void {
    if (this.pollingInterval) {
      console.log('[SocialSync] Stopping polling fallback');
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Poll for new messages since lastPolledAt.
   */
  private async pollForNewMessages(): Promise<void> {
    if (!this.isAuthenticated()) return;
    
    const userId = this.getUserId();
    if (!userId) return;
    
    try {
      // Query for messages received after lastPolledAt.
      const { data, error } = await this.supabase!
        .from('messages')
        .select('*')
        .eq('recipient_user_id', userId)
        .gt('created_at', this.lastPolledAt || new Date(0).toISOString())
        .order('created_at', { ascending: true });
      
      if (error) {
        console.error('[SocialSync] Polling failed:', error);
        return;
      }
      
      if (data && data.length > 0) {
        console.log('[SocialSync] Polling found', data.length, 'new message(s)');
        
        // Update lastPolledAt to the latest message timestamp.
        const lastMessage = data[data.length - 1];
        this.lastPolledAt = lastMessage.created_at;
        
        // Emit each new message.
        for (const row of data as MessageRow[]) {
          const message = await this.rowToMessage(row);
          this.emit('messageReceived', message);
        }
      }
    } catch (err) {
      console.error('[SocialSync] Polling error:', err);
    }
  }

  // ===========================================================================
  // Profile Helpers
  // ===========================================================================

  /**
   * Get a user profile by ID, with caching.
   */
  private async getProfile(userId: string): Promise<UserProfile | null> {
    // Check cache first.
    if (this.profileCache.has(userId)) {
      return this.profileCache.get(userId)!;
    }

    if (!this.supabase) return null;

    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error || !data) return null;

      const row = data as ProfileRow;
      const profile: UserProfile = {
        id: row.id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        isAdmin: row.is_admin,
        hotMicEnabled: row.hot_mic_enabled,
      };

      this.profileCache.set(userId, profile);
      return profile;
    } catch (err) {
      console.error('[SocialSync] Failed to get profile:', err);
      return null;
    }
  }

  /**
   * Get display name for a user (first name, or email).
   */
  private async getDisplayName(userId: string): Promise<string | null> {
    const profile = await this.getProfile(userId);
    if (!profile) return null;
    if (profile.firstName) {
      return profile.lastName 
        ? `${profile.firstName} ${profile.lastName}`
        : profile.firstName;
    }
    return profile.email;
  }

  /**
   * Get the admin user ID.
   */
  async getAdminUserId(): Promise<string | null> {
    if (!this.supabase) return null;

    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('id')
        .eq('is_admin', true)
        .limit(1)
        .single();

      if (error || !data) return null;
      return data.id;
    } catch (err) {
      console.error('[SocialSync] Failed to get admin user:', err);
      return null;
    }
  }

  /**
   * Check if current user is admin.
   */
  async isCurrentUserAdmin(): Promise<boolean> {
    const userId = this.getUserId();
    if (!userId) return false;
    const profile = await this.getProfile(userId);
    return profile?.isAdmin ?? false;
  }

  /**
   * Get current user's hot mic status.
   */
  async getHotMicEnabled(): Promise<boolean> {
    const userId = this.getUserId();
    if (!userId) return false;
    const profile = await this.getProfile(userId);
    return profile?.hotMicEnabled ?? false;
  }

  /**
   * Set current user's hot mic status.
   */
  async setHotMicEnabled(enabled: boolean): Promise<boolean> {
    if (!this.supabase) return false;
    const userId = this.getUserId();
    if (!userId) return false;

    try {
      const { error } = await this.supabase
        .from('profiles')
        .update({ hot_mic_enabled: enabled })
        .eq('id', userId);

      if (error) {
        console.error('[SocialSync] Failed to set hot mic:', error);
        return false;
      }

      // Update cache.
      const cached = this.profileCache.get(userId);
      if (cached) {
        cached.hotMicEnabled = enabled;
      }

      console.log('[SocialSync] Hot mic set to:', enabled);
      return true;
    } catch (err) {
      console.error('[SocialSync] Failed to set hot mic:', err);
      return false;
    }
  }

  // ===========================================================================
  // Message Conversion
  // ===========================================================================

  /**
   * Convert a message row to Message type with user info.
   */
  private async rowToMessage(row: MessageRow): Promise<Message> {
    const senderProfile = await this.getProfile(row.sender_user_id);
    const recipientProfile = await this.getProfile(row.recipient_user_id);

    // Generate signed URL for image if present.
    let imageUrl: string | null = null;
    if (row.image_path && this.supabase) {
      try {
        const { data } = await this.supabase.storage
          .from('team-clipboard-images')
          .createSignedUrl(row.image_path, 3600);
        if (data) {
          imageUrl = data.signedUrl;
        }
      } catch (err) {
        console.error('[SocialSync] Failed to create signed URL:', err);
      }
    }

    return {
      id: row.id,
      type: row.type as 'dm' | 'feedback',
      senderUserId: row.sender_user_id,
      senderEmail: senderProfile?.email || null,
      senderName: senderProfile?.firstName 
        ? (senderProfile.lastName 
          ? `${senderProfile.firstName} ${senderProfile.lastName}`
          : senderProfile.firstName)
        : null,
      recipientUserId: row.recipient_user_id,
      recipientEmail: recipientProfile?.email || null,
      recipientName: recipientProfile?.firstName
        ? (recipientProfile.lastName
          ? `${recipientProfile.firstName} ${recipientProfile.lastName}`
          : recipientProfile.firstName)
        : null,
      contentType: row.content_type as 'text' | 'image' | 'stack',
      contentText: row.content_text,
      imagePath: row.image_path,
      imageUrl,
      stackId: row.stack_id,
      sourceItemId: row.source_item_id,
      readAt: row.read_at ? new Date(row.read_at).getTime() : null,
      feedbackStatus: row.feedback_status as 'open' | 'resolved' | 'archived' | null,
      parentMessageId: row.parent_message_id,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  // ===========================================================================
  // DM Operations
  // ===========================================================================

  /**
   * Send a DM with a clipboard item.
   */
  async sendDM(recipientUserId: string, localItemId: number): Promise<Message | null> {
    if (!this.isAuthenticated()) {
      console.warn('[SocialSync] Not authenticated, cannot send DM');
      return null;
    }

    const userId = this.getUserId();
    if (!userId) return null;

    // Get the local clipboard item.
    const localItem = this.clipboardManager.getItem(localItemId);
    if (!localItem) {
      console.error('[SocialSync] Local item not found:', localItemId);
      return null;
    }

    try {
      // Determine content type.
      const isImage = localItem.type === 'image' || localItem.type === 'screenshot';
      const contentType = isImage ? 'image' : 'text';

      // Upload image to storage if needed.
      let imagePath: string | null = null;
      if (isImage && localItem.imageData) {
        const itemId = crypto.randomUUID();
        imagePath = `${userId}/${itemId}.png`;
        
        const { error: uploadError } = await this.supabase!.storage
          .from('team-clipboard-images')
          .upload(imagePath, localItem.imageData, {
            contentType: 'image/png',
            upsert: false,
          });

        if (uploadError) {
          console.error('[SocialSync] Image upload failed:', uploadError);
          imagePath = null;
        }
      }

      // Insert the message.
      const insertData = {
        type: 'dm',
        sender_user_id: userId,
        recipient_user_id: recipientUserId,
        content_type: contentType,
        content_text: localItem.content,
        image_path: imagePath,
        source_item_id: null,  // Could store local item reference if needed.
      };

      const { data, error } = await this.supabase!
        .from('messages')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error('[SocialSync] Send DM failed:', error);
        return null;
      }

      console.log('[SocialSync] DM sent:', data.id);
      return this.rowToMessage(data as MessageRow);
    } catch (err) {
      console.error('[SocialSync] Failed to send DM:', err);
      return null;
    }
  }

  /**
   * Send a text-only DM (for replies in feedback threads).
   */
  async sendTextDM(recipientUserId: string, text: string, parentMessageId?: string): Promise<Message | null> {
    if (!this.isAuthenticated()) return null;
    const userId = this.getUserId();
    if (!userId) return null;

    try {
      const insertData = {
        type: parentMessageId ? 'feedback' : 'dm',  // Replies to feedback stay as feedback.
        sender_user_id: userId,
        recipient_user_id: recipientUserId,
        content_type: 'text',
        content_text: text,
        parent_message_id: parentMessageId || null,
      };

      const { data, error } = await this.supabase!
        .from('messages')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error('[SocialSync] Send text DM failed:', error);
        return null;
      }

      return this.rowToMessage(data as MessageRow);
    } catch (err) {
      console.error('[SocialSync] Failed to send text DM:', err);
      return null;
    }
  }

  /**
   * Send an image reply (for feedback threads with pasted images).
   * Accepts base64 image data and optional text.
   */
  async sendImageReply(
    recipientUserId: string, 
    imageBase64: string, 
    text?: string, 
    parentMessageId?: string
  ): Promise<Message | null> {
    if (!this.isAuthenticated()) return null;
    const userId = this.getUserId();
    if (!userId) return null;

    try {
      // Decode base64 to buffer for upload.
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      const itemId = crypto.randomUUID();
      const imagePath = `${userId}/${itemId}.png`;

      // Upload image to storage.
      const { error: uploadError } = await this.supabase!.storage
        .from('team-clipboard-images')
        .upload(imagePath, imageBuffer, {
          contentType: 'image/png',
          upsert: false,
        });

      if (uploadError) {
        console.error('[SocialSync] Image reply upload failed:', uploadError);
        return null;
      }

      // Insert message with image.
      const insertData = {
        type: parentMessageId ? 'feedback' : 'dm',
        sender_user_id: userId,
        recipient_user_id: recipientUserId,
        content_type: 'image',
        content_text: text || null,
        image_path: imagePath,
        parent_message_id: parentMessageId || null,
      };

      const { data, error } = await this.supabase!
        .from('messages')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error('[SocialSync] Send image reply failed:', error);
        return null;
      }

      return this.rowToMessage(data as MessageRow);
    } catch (err) {
      console.error('[SocialSync] Failed to send image reply:', err);
      return null;
    }
  }

  /**
   * Get all DM conversations for the current user.
   */
  async getDMConversations(): Promise<DMConversation[]> {
    if (!this.isAuthenticated()) return [];
    const userId = this.getUserId();
    if (!userId) return [];

    try {
      // Get all DMs where user is sender or recipient.
      const { data, error } = await this.supabase!
        .from('messages')
        .select('*')
        .eq('type', 'dm')
        .or(`sender_user_id.eq.${userId},recipient_user_id.eq.${userId}`)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[SocialSync] Get conversations failed:', error);
        return [];
      }

      const rows = data as MessageRow[];

      // Group by other user.
      const conversationMap = new Map<string, { messages: MessageRow[]; unreadCount: number }>();

      for (const row of rows) {
        const otherUserId = row.sender_user_id === userId 
          ? row.recipient_user_id 
          : row.sender_user_id;

        if (!conversationMap.has(otherUserId)) {
          conversationMap.set(otherUserId, { messages: [], unreadCount: 0 });
        }

        const conv = conversationMap.get(otherUserId)!;
        conv.messages.push(row);

        // Count unread (messages TO me that I haven't read).
        if (row.recipient_user_id === userId && !row.read_at) {
          conv.unreadCount++;
        }
      }

      // Build conversation list.
      const conversations: DMConversation[] = [];

      for (const [otherUserId, data] of conversationMap) {
        const profile = await this.getProfile(otherUserId);
        const contact = await this.getContactByUserId(otherUserId);
        
        const lastMessageRow = data.messages[0];  // Already sorted desc.
        const lastMessage = lastMessageRow ? await this.rowToMessage(lastMessageRow) : null;

        conversations.push({
          otherUserId,
          otherUserEmail: profile?.email || 'Unknown',
          otherUserName: profile?.firstName 
            ? (profile.lastName 
              ? `${profile.firstName} ${profile.lastName}`
              : profile.firstName)
            : null,
          relationshipType: contact?.relationshipType || null,
          lastMessage,
          unreadCount: data.unreadCount,
        });
      }

      // Sort by last message time.
      conversations.sort((a, b) => {
        const aTime = a.lastMessage?.createdAt || 0;
        const bTime = b.lastMessage?.createdAt || 0;
        return bTime - aTime;
      });

      return conversations;
    } catch (err) {
      console.error('[SocialSync] Failed to get conversations:', err);
      return [];
    }
  }

  /**
   * Get all messages with a specific user.
   */
  async getDMsWithUser(otherUserId: string): Promise<Message[]> {
    if (!this.isAuthenticated()) return [];
    const userId = this.getUserId();
    if (!userId) return [];

    try {
      const { data, error } = await this.supabase!
        .from('messages')
        .select('*')
        .eq('type', 'dm')
        .or(
          `and(sender_user_id.eq.${userId},recipient_user_id.eq.${otherUserId}),` +
          `and(sender_user_id.eq.${otherUserId},recipient_user_id.eq.${userId})`
        )
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[SocialSync] Get DMs failed:', error);
        return [];
      }

      const messages: Message[] = [];
      for (const row of data as MessageRow[]) {
        messages.push(await this.rowToMessage(row));
      }

      return messages;
    } catch (err) {
      console.error('[SocialSync] Failed to get DMs:', err);
      return [];
    }
  }

  /**
   * Mark a message as read. Only works if current user is the recipient.
   */
  async markAsRead(messageId: string): Promise<boolean> {
    if (!this.supabase) return false;
    const userId = this.getUserId();
    if (!userId) return false;

    try {
      // Only update if current user is the recipient.
      const { error } = await this.supabase
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('id', messageId)
        .eq('recipient_user_id', userId);

      if (error) {
        console.error('[SocialSync] Mark as read failed:', error);
        return false;
      }

      return true;
    } catch (err) {
      console.error('[SocialSync] Failed to mark as read:', err);
      return false;
    }
  }

  /**
   * Mark multiple messages as read in a single batch.
   * More efficient than calling markAsRead for each message.
   */
  async markAsReadBatch(messageIds: string[]): Promise<boolean> {
    if (!this.supabase || messageIds.length === 0) return false;
    const userId = this.getUserId();
    if (!userId) return false;

    try {
      const { error } = await this.supabase
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .in('id', messageIds)
        .eq('recipient_user_id', userId);

      if (error) {
        console.error('[SocialSync] Batch mark as read failed:', error);
        return false;
      }

      return true;
    } catch (err) {
      console.error('[SocialSync] Failed to batch mark as read:', err);
      return false;
    }
  }

  /**
   * Check if there are any unread messages.
   */
  async hasUnreadMessages(): Promise<boolean> {
    if (!this.isAuthenticated()) return false;
    const userId = this.getUserId();
    if (!userId) return false;

    try {
      const { count, error } = await this.supabase!
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('recipient_user_id', userId)
        .is('read_at', null);

      if (error) return false;
      return (count || 0) > 0;
    } catch (err) {
      return false;
    }
  }

  /**
   * Check if there are any unread feedback messages (for feedback notifications).
   * This includes: new feedback, status changes, and replies.
   */
  async hasUnreadFeedback(): Promise<boolean> {
    if (!this.isAuthenticated()) return false;
    const userId = this.getUserId();
    if (!userId) return false;

    try {
      // Check for unread feedback where user is recipient (admin gets notifications from users,
      // users get notifications from admin responses).
      const { count, error } = await this.supabase!
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('type', 'feedback')
        .eq('recipient_user_id', userId)
        .is('read_at', null);

      if (error) return false;
      return (count || 0) > 0;
    } catch (err) {
      return false;
    }
  }

  // ===========================================================================
  // Feedback Operations
  // ===========================================================================

  /**
   * Submit feedback (send item to admin).
   */
  async submitFeedback(localItemId: number): Promise<Message | null> {
    const adminUserId = await this.getAdminUserId();
    if (!adminUserId) {
      console.error('[SocialSync] No admin user found');
      return null;
    }

    if (!this.isAuthenticated()) return null;
    const userId = this.getUserId();
    if (!userId) return null;

    // Get the local clipboard item.
    const localItem = this.clipboardManager.getItem(localItemId);
    if (!localItem) {
      console.error('[SocialSync] Local item not found:', localItemId);
      return null;
    }

    try {
      const isImage = localItem.type === 'image' || localItem.type === 'screenshot';
      const contentType = isImage ? 'image' : 'text';

      // Upload image if needed.
      let imagePath: string | null = null;
      if (isImage && localItem.imageData) {
        const itemId = crypto.randomUUID();
        imagePath = `${userId}/${itemId}.png`;
        
        const { error: uploadError } = await this.supabase!.storage
          .from('team-clipboard-images')
          .upload(imagePath, localItem.imageData, {
            contentType: 'image/png',
            upsert: false,
          });

        if (uploadError) {
          console.error('[SocialSync] Image upload failed:', uploadError);
          imagePath = null;
        }
      }

      // Insert feedback message.
      const insertData = {
        type: 'feedback',
        sender_user_id: userId,
        recipient_user_id: adminUserId,
        content_type: contentType,
        content_text: localItem.content,
        image_path: imagePath,
        feedback_status: 'open',
      };

      const { data, error } = await this.supabase!
        .from('messages')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error('[SocialSync] Submit feedback failed:', error);
        return null;
      }

      // Log the creation.
      await this.logActivity(data.id, 'created');

      console.log('[SocialSync] Feedback submitted:', data.id);
      return this.rowToMessage(data as MessageRow);
    } catch (err) {
      console.error('[SocialSync] Failed to submit feedback:', err);
      return null;
    }
  }

  /**
   * Submit text-only feedback (for diagnostics, etc.).
   */
  async submitTextFeedback(text: string): Promise<Message | null> {
    const adminUserId = await this.getAdminUserId();
    if (!adminUserId) {
      console.error('[SocialSync] No admin user found');
      return null;
    }

    if (!this.isAuthenticated()) return null;
    const userId = this.getUserId();
    if (!userId) return null;

    try {
      const insertData = {
        type: 'feedback',
        sender_user_id: userId,
        recipient_user_id: adminUserId,
        content_type: 'text',
        content_text: text,
        feedback_status: 'open',
      };

      const { data, error } = await this.supabase!
        .from('messages')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error('[SocialSync] Submit text feedback failed:', error);
        return null;
      }

      // Log the creation.
      await this.logActivity(data.id, 'created');

      console.log('[SocialSync] Text feedback submitted:', data.id);
      return this.rowToMessage(data as MessageRow);
    } catch (err) {
      console.error('[SocialSync] Failed to submit text feedback:', err);
      return null;
    }
  }

  /**
   * Submit image feedback with optional caption.
   */
  async submitImageFeedback(imageBase64: string, caption?: string): Promise<Message | null> {
    const adminUserId = await this.getAdminUserId();
    if (!adminUserId) {
      console.error('[SocialSync] No admin user found');
      return null;
    }

    if (!this.isAuthenticated()) return null;
    const userId = this.getUserId();
    if (!userId) return null;

    try {
      // Decode base64 to buffer for upload.
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      const itemId = crypto.randomUUID();
      const imagePath = `${userId}/${itemId}.png`;

      // Upload image to storage.
      const { error: uploadError } = await this.supabase!.storage
        .from('team-clipboard-images')
        .upload(imagePath, imageBuffer, {
          contentType: 'image/png',
          upsert: false,
        });

      if (uploadError) {
        console.error('[SocialSync] Image feedback upload failed:', uploadError);
        return null;
      }

      const insertData = {
        type: 'feedback',
        sender_user_id: userId,
        recipient_user_id: adminUserId,
        content_type: 'image',
        content_text: caption || null,
        image_path: imagePath,
        feedback_status: 'open',
      };

      const { data, error } = await this.supabase!
        .from('messages')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error('[SocialSync] Submit image feedback failed:', error);
        return null;
      }

      // Log the creation.
      await this.logActivity(data.id, 'created');

      console.log('[SocialSync] Image feedback submitted:', data.id);
      return this.rowToMessage(data as MessageRow);
    } catch (err) {
      console.error('[SocialSync] Failed to submit image feedback:', err);
      return null;
    }
  }

  /**
   * Get current user's submitted feedback.
   */
  async getMyFeedback(): Promise<Message[]> {
    if (!this.isAuthenticated()) return [];
    const userId = this.getUserId();
    if (!userId) return [];

    try {
      const { data, error } = await this.supabase!
        .from('messages')
        .select('*')
        .eq('type', 'feedback')
        .eq('sender_user_id', userId)
        .is('parent_message_id', null)  // Only root feedback items.
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[SocialSync] Get my feedback failed:', error);
        return [];
      }

      const messages: Message[] = [];
      for (const row of data as MessageRow[]) {
        messages.push(await this.rowToMessage(row));
      }

      return messages;
    } catch (err) {
      console.error('[SocialSync] Failed to get my feedback:', err);
      return [];
    }
  }

  /**
   * Get all feedback (admin only).
   */
  async getAllFeedback(): Promise<Message[]> {
    if (!this.isAuthenticated()) return [];
    
    const isAdmin = await this.isCurrentUserAdmin();
    if (!isAdmin) {
      console.warn('[SocialSync] Only admins can get all feedback');
      return [];
    }

    try {
      const { data, error } = await this.supabase!
        .from('messages')
        .select('*')
        .eq('type', 'feedback')
        .is('parent_message_id', null)  // Only root feedback items.
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[SocialSync] Get all feedback failed:', error);
        return [];
      }

      const messages: Message[] = [];
      for (const row of data as MessageRow[]) {
        messages.push(await this.rowToMessage(row));
      }

      return messages;
    } catch (err) {
      console.error('[SocialSync] Failed to get all feedback:', err);
      return [];
    }
  }

  /**
   * Get replies to a feedback item.
   */
  async getFeedbackReplies(feedbackId: string): Promise<Message[]> {
    if (!this.isAuthenticated()) return [];

    try {
      const { data, error } = await this.supabase!
        .from('messages')
        .select('*')
        .eq('parent_message_id', feedbackId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[SocialSync] Get feedback replies failed:', error);
        return [];
      }

      const messages: Message[] = [];
      for (const row of data as MessageRow[]) {
        messages.push(await this.rowToMessage(row));
      }

      return messages;
    } catch (err) {
      console.error('[SocialSync] Failed to get feedback replies:', err);
      return [];
    }
  }

  /**
   * Update feedback status.
   */
  async updateFeedbackStatus(feedbackId: string, status: 'open' | 'resolved' | 'archived'): Promise<boolean> {
    if (!this.supabase) return false;
    const userId = this.getUserId();
    if (!userId) return false;

    try {
      // Get current status for logging.
      const { data: current } = await this.supabase
        .from('messages')
        .select('feedback_status, sender_user_id, recipient_user_id')
        .eq('id', feedbackId)
        .single();

      if (!current) return false;

      // Only admin can archive.
      if (status === 'archived') {
        const isAdmin = await this.isCurrentUserAdmin();
        if (!isAdmin) {
          console.warn('[SocialSync] Only admins can archive feedback');
          return false;
        }
      }

      // Update status.
      const { error } = await this.supabase
        .from('messages')
        .update({ feedback_status: status })
        .eq('id', feedbackId);

      if (error) {
        console.error('[SocialSync] Update feedback status failed:', error);
        return false;
      }

      // Log the change.
      await this.logActivity(feedbackId, 'status_changed', current.feedback_status, status);

      console.log('[SocialSync] Feedback status updated:', feedbackId, status);
      return true;
    } catch (err) {
      console.error('[SocialSync] Failed to update feedback status:', err);
      return false;
    }
  }

  /**
   * Log an activity on a message.
   */
  private async logActivity(
    messageId: string, 
    action: 'created' | 'status_changed' | 'replied',
    oldStatus?: string | null,
    newStatus?: string | null
  ): Promise<void> {
    if (!this.supabase) return;
    const userId = this.getUserId();
    if (!userId) return;

    try {
      await this.supabase.from('message_activity_log').insert({
        message_id: messageId,
        user_id: userId,
        action,
        old_status: oldStatus || null,
        new_status: newStatus || null,
      });
    } catch (err) {
      console.error('[SocialSync] Failed to log activity:', err);
    }
  }

  /**
   * Get activity log for a feedback item.
   */
  async getActivityLog(feedbackId: string): Promise<ActivityLogEntry[]> {
    if (!this.supabase) return [];

    try {
      const { data, error } = await this.supabase
        .from('message_activity_log')
        .select('*')
        .eq('message_id', feedbackId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[SocialSync] Get activity log failed:', error);
        return [];
      }

      const entries: ActivityLogEntry[] = [];
      for (const row of data as ActivityLogRow[]) {
        const profile = await this.getProfile(row.user_id);
        entries.push({
          id: row.id,
          messageId: row.message_id,
          userId: row.user_id,
          userEmail: profile?.email || null,
          action: row.action as 'created' | 'status_changed' | 'replied',
          oldStatus: row.old_status,
          newStatus: row.new_status,
          createdAt: new Date(row.created_at).getTime(),
        });
      }

      return entries;
    } catch (err) {
      console.error('[SocialSync] Failed to get activity log:', err);
      return [];
    }
  }

  // ===========================================================================
  // Contact Operations
  // ===========================================================================

  /**
   * Get all contacts for current user.
   */
  async getContacts(): Promise<Contact[]> {
    if (!this.isAuthenticated()) return [];
    const userId = this.getUserId();
    const userEmail = this.getUserEmail();
    if (!userId) return [];

    try {
      const { data, error } = await this.supabase!
        .from('contacts')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[SocialSync] Get contacts failed:', error);
        return [];
      }

      const contacts: Contact[] = [];
      const seenEmails = new Set<string>();

      for (const row of data as ContactRow[]) {
        const email = row.contact_email.toLowerCase();
        
        // Skip duplicates and self.
        if (seenEmails.has(email)) continue;
        if (userEmail && email === userEmail.toLowerCase()) continue;
        
        seenEmails.add(email);

        // Get display name if they have a profile.
        let contactName: string | null = null;
        if (row.contact_user_id) {
          contactName = await this.getDisplayName(row.contact_user_id);
        }

        contacts.push({
          id: row.id,
          ownerUserId: row.owner_user_id,
          contactEmail: row.contact_email,
          contactUserId: row.contact_user_id,
          contactName,
          relationshipType: row.relationship_type as 'team' | 'friend' | null,
          status: row.status as 'pending' | 'accepted',
          createdAt: new Date(row.created_at).getTime(),
        });
      }

      return contacts;
    } catch (err) {
      console.error('[SocialSync] Failed to get contacts:', err);
      return [];
    }
  }

  /**
   * Get a contact by their user ID.
   */
  private async getContactByUserId(contactUserId: string): Promise<Contact | null> {
    if (!this.supabase) return null;
    const userId = this.getUserId();
    if (!userId) return null;

    try {
      const { data, error } = await this.supabase
        .from('contacts')
        .select('*')
        .or(`owner_user_id.eq.${userId},contact_user_id.eq.${userId}`)
        .or(`contact_user_id.eq.${contactUserId},owner_user_id.eq.${contactUserId}`)
        .limit(1)
        .single();

      if (error || !data) return null;

      const row = data as ContactRow;
      return {
        id: row.id,
        ownerUserId: row.owner_user_id,
        contactEmail: row.contact_email,
        contactUserId: row.contact_user_id,
        contactName: null,
        relationshipType: row.relationship_type as 'team' | 'friend' | null,
        status: row.status as 'pending' | 'accepted',
        createdAt: new Date(row.created_at).getTime(),
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * Add a friend by email (creates pending contact).
   */
  async addFriend(email: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isAuthenticated()) {
      return { success: false, error: 'Not authenticated' };
    }

    const userId = this.getUserId();
    const myEmail = this.getUserEmail();
    if (!userId) {
      return { success: false, error: 'No user ID' };
    }

    // Can't add yourself.
    if (myEmail && email.toLowerCase() === myEmail.toLowerCase()) {
      return { success: false, error: 'Cannot add yourself as a friend' };
    }

    try {
      // Check if they already have an account.
      const { data: existingUser } = await this.supabase!
        .from('profiles')
        .select('id')
        .ilike('email', email)
        .single();

      // Always create with pending status - the contact must accept the invite.
      // This ensures users have control over who can message them.
      const { error } = await this.supabase!
        .from('contacts')
        .insert({
          owner_user_id: userId,
          contact_email: email.toLowerCase(),
          contact_user_id: existingUser?.id || null,
          relationship_type: 'friend',
          status: 'pending',
        });

      if (error) {
        if (error.code === '23505') {
          return { success: false, error: 'This person is already in your contacts' };
        }
        console.error('[SocialSync] Add friend failed:', error);
        return { success: false, error: error.message };
      }

      console.log('[SocialSync] Friend added:', email);
      return { success: true };
    } catch (err) {
      console.error('[SocialSync] Failed to add friend:', err);
      return { success: false, error: 'Failed to add friend' };
    }
  }

  /**
   * Search contacts by name or email.
   */
  async searchContacts(query: string): Promise<Contact[]> {
    const contacts = await this.getContacts();
    const queryLower = query.toLowerCase();

    return contacts.filter(c => 
      c.contactEmail.toLowerCase().includes(queryLower) ||
      (c.contactName && c.contactName.toLowerCase().includes(queryLower))
    );
  }

  /**
   * Get pending invites where I'm the target (someone wants to add me).
   * These are contacts where I'm the contact_user_id or contact_email, status is pending,
   * and I'm not the owner (not my own outgoing invites).
   */
  async getPendingInvites(): Promise<Contact[]> {
    if (!this.isAuthenticated()) return [];
    const userId = this.getUserId();
    const userEmail = this.getUserEmail();
    if (!userId) return [];

    try {
      // Build OR filter for matching by user_id or email.
      let orFilter = `contact_user_id.eq.${userId}`;
      if (userEmail) {
        orFilter += `,contact_email.ilike.${userEmail.toLowerCase()}`;
      }

      const { data, error } = await this.supabase!
        .from('contacts')
        .select('*')
        .or(orFilter)
        .eq('status', 'pending')
        .neq('owner_user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[SocialSync] Get pending invites failed:', error);
        return [];
      }

      const invites: Contact[] = [];
      for (const row of data as ContactRow[]) {
        // Get display name of the person who sent the invite.
        let ownerName: string | null = null;
        if (row.owner_user_id) {
          ownerName = await this.getDisplayName(row.owner_user_id);
        }

        invites.push({
          id: row.id,
          ownerUserId: row.owner_user_id,
          contactEmail: row.contact_email,
          contactUserId: row.contact_user_id,
          contactName: ownerName, // Use owner's name since they sent the invite
          relationshipType: row.relationship_type as 'team' | 'friend' | null,
          status: row.status as 'pending' | 'accepted',
          createdAt: new Date(row.created_at).getTime(),
        });
      }

      return invites;
    } catch (err) {
      console.error('[SocialSync] Failed to get pending invites:', err);
      return [];
    }
  }

  /**
   * Respond to a pending invite - accept or reject.
   * Accept: updates status to 'accepted', enabling bidirectional messaging.
   * Reject: deletes the contact row.
   */
  async respondToInvite(contactId: string, accept: boolean): Promise<boolean> {
    if (!this.isAuthenticated()) return false;
    const userId = this.getUserId();
    const userEmail = this.getUserEmail();
    if (!userId) return false;

    try {
      if (accept) {
        // Accept: update status to accepted.
        // Also set contact_user_id if not already set (for invites by email).
        const { error } = await this.supabase!
          .from('contacts')
          .update({ 
            status: 'accepted',
            contact_user_id: userId, // Ensure our user ID is linked
          })
          .eq('id', contactId)
          .or(`contact_user_id.eq.${userId},contact_email.ilike.${userEmail?.toLowerCase() || ''}`);

        if (error) {
          console.error('[SocialSync] Accept invite failed:', error);
          return false;
        }

        console.log('[SocialSync] Invite accepted:', contactId);
        return true;
      } else {
        // Reject: delete the contact row.
        const { error } = await this.supabase!
          .from('contacts')
          .delete()
          .eq('id', contactId)
          .or(`contact_user_id.eq.${userId},contact_email.ilike.${userEmail?.toLowerCase() || ''}`);

        if (error) {
          console.error('[SocialSync] Reject invite failed:', error);
          return false;
        }

        console.log('[SocialSync] Invite rejected:', contactId);
        return true;
      }
    } catch (err) {
      console.error('[SocialSync] Failed to respond to invite:', err);
      return false;
    }
  }

  /**
   * Remove a friend/contact (unfriend or leave team).
   * Works for both contacts I own and contacts where I'm the target.
   */
  async removeFriend(contactId: string): Promise<boolean> {
    if (!this.isAuthenticated()) return false;
    const userId = this.getUserId();
    const userEmail = this.getUserEmail();
    if (!userId) return false;

    try {
      // Delete where I'm either the owner or the contact.
      const { error } = await this.supabase!
        .from('contacts')
        .delete()
        .eq('id', contactId)
        .or(`owner_user_id.eq.${userId},contact_user_id.eq.${userId},contact_email.ilike.${userEmail?.toLowerCase() || ''}`);

      if (error) {
        console.error('[SocialSync] Remove friend failed:', error);
        return false;
      }

      console.log('[SocialSync] Friend removed:', contactId);
      return true;
    } catch (err) {
      console.error('[SocialSync] Failed to remove friend:', err);
      return false;
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.teardownRealtimeSubscription();
    this.stopPollingFallback();
    this.authManager.removeListener('sessionChanged', this.boundHandleSessionChanged);
    this.profileCache.clear();
    this.removeAllListeners();
    console.log('[SocialSync] Destroyed');
  }
}

