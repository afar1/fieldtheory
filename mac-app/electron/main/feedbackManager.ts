/**
 * FeedbackManager - Handles user feedback to admin.
 *
 * Simplified from socialSync.ts - no DMs, no contacts, no realtime.
 * Just feedback submission, viewing, replies, and status management.
 */

import { SupabaseClient, Session } from '@supabase/supabase-js';
import { ClipboardManager, ClipboardItem as LocalClipboardItem } from './clipboardManager';
import { AuthManager } from './authManager';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { createLogger } from './logger';

const log = createLogger('Feedback');

// =============================================================================
// Types
// =============================================================================

/**
 * Message from Supabase messages table.
 */
export interface FeedbackMessage {
  id: string;
  type: 'feedback';
  senderUserId: string;
  senderEmail: string | null;
  senderName: string | null;
  recipientUserId: string;
  recipientEmail: string | null;
  recipientName: string | null;
  contentType: 'text' | 'image';
  contentText: string | null;
  imagePath: string | null;
  imageUrl: string | null;
  readAt: number | null;
  feedbackStatus: 'open' | 'resolved' | 'archived' | null;
  parentMessageId: string | null;
  createdAt: number;
  updatedAt: number;
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

// =============================================================================
// Internal Row Types (Supabase)
// =============================================================================

interface MessageRow {
  id: string;
  type: string;
  sender_user_id: string;
  recipient_user_id: string;
  content_type: string;
  content_text: string | null;
  image_path: string | null;
  read_at: string | null;
  feedback_status: string | null;
  parent_message_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ProfileRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  is_admin: boolean;
}

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
// FeedbackManager Class
// =============================================================================

export class FeedbackManager extends EventEmitter {
  private clipboardManager: ClipboardManager;
  private authManager: AuthManager;
  private profileCache: Map<string, UserProfile> = new Map();

  constructor(authManager: AuthManager, clipboardManager: ClipboardManager) {
    super();
    this.authManager = authManager;
    this.clipboardManager = clipboardManager;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private get supabase(): SupabaseClient | null {
    return this.authManager.getSupabaseClient();
  }

  private get session(): Session | null {
    return this.authManager.getSession();
  }

  isAuthenticated(): boolean {
    return this.authManager.isAuthenticated();
  }

  private getUserId(): string | null {
    return this.session?.user?.id || null;
  }

  private getUserEmail(): string | null {
    return this.session?.user?.email || null;
  }

  // ===========================================================================
  // Profile Management
  // ===========================================================================

  private async getProfile(userId: string): Promise<UserProfile | null> {
    const cached = this.profileCache.get(userId);
    if (cached) return cached;

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
      };

      this.profileCache.set(userId, profile);
      return profile;
    } catch (err) {
      log.error('Failed to get profile:', err);
      return null;
    }
  }

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
      log.error('Failed to get admin user:', err);
      return null;
    }
  }

  async isCurrentUserAdmin(): Promise<boolean> {
    const userId = this.getUserId();
    if (!userId) return false;
    const profile = await this.getProfile(userId);
    return profile?.isAdmin ?? false;
  }

  // ===========================================================================
  // Message Conversion
  // ===========================================================================

  private async rowToMessage(row: MessageRow): Promise<FeedbackMessage> {
    const senderProfile = await this.getProfile(row.sender_user_id);
    const recipientProfile = await this.getProfile(row.recipient_user_id);

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
        log.error('Failed to create signed URL:', err);
      }
    }

    return {
      id: row.id,
      type: 'feedback',
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
      contentType: row.content_type as 'text' | 'image',
      contentText: row.content_text,
      imagePath: row.image_path,
      imageUrl,
      readAt: row.read_at ? new Date(row.read_at).getTime() : null,
      feedbackStatus: row.feedback_status as 'open' | 'resolved' | 'archived' | null,
      parentMessageId: row.parent_message_id,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  // ===========================================================================
  // Activity Logging
  // ===========================================================================

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
      log.error('Failed to log activity:', err);
    }
  }

  async getActivityLog(feedbackId: string): Promise<ActivityLogEntry[]> {
    if (!this.supabase) return [];

    try {
      const { data, error } = await this.supabase
        .from('message_activity_log')
        .select('*')
        .eq('message_id', feedbackId)
        .order('created_at', { ascending: true });

      if (error) {
        log.error('Get activity log failed:', error);
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
      log.error('Failed to get activity log:', err);
      return [];
    }
  }

  // ===========================================================================
  // Submit Feedback
  // ===========================================================================

  async submitFeedback(localItemId: number): Promise<FeedbackMessage | null> {
    const adminUserId = await this.getAdminUserId();
    if (!adminUserId) {
      log.error('No admin user found');
      return null;
    }

    if (!this.isAuthenticated()) return null;
    const userId = this.getUserId();
    if (!userId) return null;

    const localItem = this.clipboardManager.getItem(localItemId);
    if (!localItem) {
      log.error('Local item not found:', localItemId);
      return null;
    }

    try {
      const isImage = localItem.type === 'image' || localItem.type === 'screenshot';
      const contentType = isImage ? 'image' : 'text';

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
          log.error('Image upload failed:', uploadError);
          imagePath = null;
        }
      }

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
        log.error('Submit feedback failed:', error);
        return null;
      }

      await this.logActivity(data.id, 'created');
      log.info('Feedback submitted:', data.id);
      return this.rowToMessage(data as MessageRow);
    } catch (err) {
      log.error('Failed to submit feedback:', err);
      return null;
    }
  }

  async submitTextFeedback(text: string): Promise<FeedbackMessage | null> {
    const adminUserId = await this.getAdminUserId();
    if (!adminUserId) {
      log.error('No admin user found');
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
        log.error('Submit text feedback failed:', error);
        return null;
      }

      await this.logActivity(data.id, 'created');
      log.info('Text feedback submitted:', data.id);
      return this.rowToMessage(data as MessageRow);
    } catch (err) {
      log.error('Failed to submit text feedback:', err);
      return null;
    }
  }

  async submitImageFeedback(
    imageBase64: string,
    caption?: string,
    sourceAppName?: string
  ): Promise<FeedbackMessage | null> {
    const adminUserId = await this.getAdminUserId();
    if (!adminUserId) {
      log.error('No admin user found');
      return null;
    }

    if (!this.isAuthenticated()) return null;
    const userId = this.getUserId();
    if (!userId) return null;

    try {
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      const itemId = crypto.randomUUID();
      const imagePath = `${userId}/${itemId}.png`;

      const { error: uploadError } = await this.supabase!.storage
        .from('team-clipboard-images')
        .upload(imagePath, imageBuffer, {
          contentType: 'image/png',
          upsert: false,
        });

      if (uploadError) {
        log.error('Image feedback upload failed:', uploadError);
        return null;
      }

      const contentText = caption || (sourceAppName ? `${sourceAppName} screenshot` : null);

      const insertData = {
        type: 'feedback',
        sender_user_id: userId,
        recipient_user_id: adminUserId,
        content_type: 'image',
        content_text: contentText,
        image_path: imagePath,
        feedback_status: 'open',
      };

      const { data, error } = await this.supabase!
        .from('messages')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        log.error('Submit image feedback failed:', error);
        return null;
      }

      await this.logActivity(data.id, 'created');
      log.info('Image feedback submitted:', data.id);
      return this.rowToMessage(data as MessageRow);
    } catch (err) {
      log.error('Failed to submit image feedback:', err);
      return null;
    }
  }

  // ===========================================================================
  // View Feedback
  // ===========================================================================

  async getMyFeedback(): Promise<FeedbackMessage[]> {
    if (!this.isAuthenticated()) return [];
    const userId = this.getUserId();
    if (!userId) return [];

    try {
      const { data, error } = await this.supabase!
        .from('messages')
        .select('*')
        .eq('type', 'feedback')
        .eq('sender_user_id', userId)
        .is('parent_message_id', null)
        .order('created_at', { ascending: false });

      if (error) {
        log.error('Get my feedback failed:', error);
        return [];
      }

      const messages: FeedbackMessage[] = [];
      for (const row of data as MessageRow[]) {
        messages.push(await this.rowToMessage(row));
      }

      return messages;
    } catch (err) {
      log.error('Failed to get my feedback:', err);
      return [];
    }
  }

  async getAllFeedback(): Promise<FeedbackMessage[]> {
    if (!this.isAuthenticated()) return [];

    const isAdmin = await this.isCurrentUserAdmin();
    if (!isAdmin) {
      log.warn('Only admins can get all feedback');
      return [];
    }

    try {
      const { data, error } = await this.supabase!
        .from('messages')
        .select('*')
        .eq('type', 'feedback')
        .is('parent_message_id', null)
        .order('created_at', { ascending: false });

      if (error) {
        log.error('Get all feedback failed:', error);
        return [];
      }

      const messages: FeedbackMessage[] = [];
      for (const row of data as MessageRow[]) {
        messages.push(await this.rowToMessage(row));
      }

      return messages;
    } catch (err) {
      log.error('Failed to get all feedback:', err);
      return [];
    }
  }

  async getFeedbackReplies(feedbackId: string): Promise<FeedbackMessage[]> {
    if (!this.isAuthenticated()) return [];

    try {
      const { data, error } = await this.supabase!
        .from('messages')
        .select('*')
        .eq('parent_message_id', feedbackId)
        .order('created_at', { ascending: true });

      if (error) {
        log.error('Get feedback replies failed:', error);
        return [];
      }

      const messages: FeedbackMessage[] = [];
      for (const row of data as MessageRow[]) {
        messages.push(await this.rowToMessage(row));
      }

      return messages;
    } catch (err) {
      log.error('Failed to get feedback replies:', err);
      return [];
    }
  }

  // ===========================================================================
  // Replies
  // ===========================================================================

  async sendTextReply(
    recipientUserId: string,
    text: string,
    parentMessageId: string
  ): Promise<FeedbackMessage | null> {
    if (!this.isAuthenticated()) return null;
    const userId = this.getUserId();
    if (!userId) return null;

    try {
      const insertData = {
        type: 'feedback',
        sender_user_id: userId,
        recipient_user_id: recipientUserId,
        content_type: 'text',
        content_text: text,
        parent_message_id: parentMessageId,
      };

      const { data, error } = await this.supabase!
        .from('messages')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        log.error('Send text reply failed:', error);
        return null;
      }

      await this.logActivity(parentMessageId, 'replied');
      return this.rowToMessage(data as MessageRow);
    } catch (err) {
      log.error('Failed to send text reply:', err);
      return null;
    }
  }

  async sendImageReply(
    recipientUserId: string,
    imageBase64: string,
    text: string | undefined,
    parentMessageId: string
  ): Promise<FeedbackMessage | null> {
    if (!this.isAuthenticated()) return null;
    const userId = this.getUserId();
    if (!userId) return null;

    try {
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      const itemId = crypto.randomUUID();
      const imagePath = `${userId}/${itemId}.png`;

      const { error: uploadError } = await this.supabase!.storage
        .from('team-clipboard-images')
        .upload(imagePath, imageBuffer, {
          contentType: 'image/png',
          upsert: false,
        });

      if (uploadError) {
        log.error('Image reply upload failed:', uploadError);
        return null;
      }

      const insertData = {
        type: 'feedback',
        sender_user_id: userId,
        recipient_user_id: recipientUserId,
        content_type: 'image',
        content_text: text || null,
        image_path: imagePath,
        parent_message_id: parentMessageId,
      };

      const { data, error } = await this.supabase!
        .from('messages')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        log.error('Send image reply failed:', error);
        return null;
      }

      await this.logActivity(parentMessageId, 'replied');
      return this.rowToMessage(data as MessageRow);
    } catch (err) {
      log.error('Failed to send image reply:', err);
      return null;
    }
  }

  // ===========================================================================
  // Status Management
  // ===========================================================================

  async updateFeedbackStatus(
    feedbackId: string,
    status: 'open' | 'resolved' | 'archived'
  ): Promise<boolean> {
    if (!this.supabase) return false;
    const userId = this.getUserId();
    if (!userId) return false;

    try {
      const { data: current } = await this.supabase
        .from('messages')
        .select('feedback_status')
        .eq('id', feedbackId)
        .single();

      if (!current) return false;

      if (status === 'archived') {
        const isAdmin = await this.isCurrentUserAdmin();
        if (!isAdmin) {
          log.warn('Only admins can archive feedback');
          return false;
        }
      }

      const { error } = await this.supabase
        .from('messages')
        .update({ feedback_status: status })
        .eq('id', feedbackId);

      if (error) {
        log.error('Update feedback status failed:', error);
        return false;
      }

      await this.logActivity(feedbackId, 'status_changed', current.feedback_status, status);
      log.info('Feedback status updated:', feedbackId, status);
      return true;
    } catch (err) {
      log.error('Failed to update feedback status:', err);
      return false;
    }
  }

  // ===========================================================================
  // Read Tracking
  // ===========================================================================

  async markAsRead(messageId: string): Promise<boolean> {
    if (!this.supabase) return false;
    const userId = this.getUserId();
    if (!userId) return false;

    try {
      const { error } = await this.supabase
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('id', messageId)
        .eq('recipient_user_id', userId);

      if (error) {
        log.error('Mark as read failed:', error);
        return false;
      }

      return true;
    } catch (err) {
      log.error('Failed to mark as read:', err);
      return false;
    }
  }

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
        log.error('Batch mark as read failed:', error);
        return false;
      }

      return true;
    } catch (err) {
      log.error('Failed to batch mark as read:', err);
      return false;
    }
  }

  async markAllFeedbackAsRead(): Promise<boolean> {
    if (!this.supabase) return false;
    const userId = this.getUserId();
    if (!userId) return false;

    try {
      const { error } = await this.supabase
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('type', 'feedback')
        .eq('recipient_user_id', userId)
        .is('read_at', null);

      if (error) {
        log.error('Mark all feedback as read failed:', error);
        return false;
      }

      return true;
    } catch (err) {
      log.error('Failed to mark all feedback as read:', err);
      return false;
    }
  }

  async hasUnreadFeedback(): Promise<boolean> {
    if (!this.isAuthenticated()) return false;
    const userId = this.getUserId();
    if (!userId) return false;

    try {
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
  // Cleanup
  // ===========================================================================

  destroy(): void {
    this.profileCache.clear();
    this.removeAllListeners();
  }
}
