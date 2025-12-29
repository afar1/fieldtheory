/**
 * SharedClipboardSync - Syncs shared clipboard items with Supabase.
 * 
 * This enables collaborative clipboard sharing between users signed into
 * the same account. Users can:
 * - Share items to the shared clipboard
 * - View shared items (same UI as personal clipboard)
 * - Create and modify stacks in the shared view
 * - Copy shared items to their personal clipboard
 * 
 * Once copied to personal, items are independent snapshots - changes to
 * the shared stack don't affect the personal copy.
 */

import { SupabaseClient, Session } from '@supabase/supabase-js';
import { ClipboardManager, ClipboardItem as LocalClipboardItem, ClipboardItemType } from './clipboardManager';
import { EventEmitter } from 'events';
import crypto from 'crypto';

// =============================================================================
// Types
// =============================================================================

/**
 * Shared clipboard item from Supabase.
 */
export interface SharedClipboardItem {
  id: string;
  userId: string;
  sharedByEmail: string | null;
  type: ClipboardItemType;
  content: string | null;
  imageData: string | null; // base64 for IPC (legacy, from bytea)
  imagePath: string | null; // Path in storage bucket (new approach)
  imageUrl: string | null;  // Signed URL for accessing the image
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

/**
 * Shared stack info for UI display.
 */
export interface SharedStackInfo {
  stackId: string;
  name: string | null;
  itemCount: number;
  imageCount: number;
  textCount: number;
  createdByEmail: string | null;
  createdAt: number;
  firstTextPreview: string | null;
}

/**
 * Query options for fetching shared items.
 */
export interface SharedClipboardQueryOptions {
  type?: ClipboardItemType;
  search?: string;
  limit?: number;
  offset?: number;
  stackId?: string;
}

/**
 * Row from Supabase team_clipboard_items table.
 */
interface SharedClipboardRow {
  id: string;
  user_id: string;
  shared_by_email: string | null;
  type: string;
  content: string | null;
  image_data: Buffer | null;  // Legacy bytea column.
  image_path: string | null;  // New storage bucket path.
  image_width: number | null;
  image_height: number | null;
  image_size: number | null;
  improved_content: string | null;
  stack_id: string | null;
  source_app: string | null;
  source_app_name: string | null;
  word_count: number | null;
  char_count: number | null;
  client_id: string;
  client_created_at_ms: number;
  created_at: string;
  updated_at: string;
}

/**
 * Row from Supabase team_clipboard_stacks table.
 */
interface TeamStackRow {
  id: string;
  stack_id: string;
  created_by_user_id: string;
  created_by_email: string | null;
  name: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Row from Supabase team_members table.
 */
interface TeamMemberRow {
  id: string;
  added_by_user_id: string;
  member_email: string;
  created_at: string;
}

/**
 * Team member info for UI display.
 */
export interface TeamMember {
  id: string;
  email: string;
  addedByMe: boolean;  // True if current user added this member.
  createdAt: number;
}

// =============================================================================
// SharedClipboardSync Class
// =============================================================================

/**
 * Manages shared clipboard sync with Supabase.
 * Works alongside ClipboardManager for local storage.
 */
export class SharedClipboardSync extends EventEmitter {
  private clipboardManager: ClipboardManager;
  private supabase: SupabaseClient | null = null;
  private session: Session | null = null;

  constructor(clipboardManager: ClipboardManager) {
    super();
    this.clipboardManager = clipboardManager;
  }

  /**
   * Set the Supabase client (shared with MobileSync).
   */
  setSupabaseClient(supabase: SupabaseClient): void {
    this.supabase = supabase;
  }

  /**
   * Set the authenticated session.
   */
  setSession(session: Session | null): void {
    this.session = session;
    if (session) {
      console.log('[SharedClipboardSync] Session set for user:', session.user?.email);
    } else {
      console.log('[SharedClipboardSync] Session cleared');
    }
  }

  /**
   * Check if authenticated.
   */
  isAuthenticated(): boolean {
    return !!(this.supabase && this.session);
  }

  /**
   * Get current user's email.
   */
  private getUserEmail(): string | null {
    return this.session?.user?.email || null;
  }

  /**
   * Get current user's ID.
   */
  private getUserId(): string | null {
    return this.session?.user?.id || null;
  }

  // ===========================================================================
  // Query Team Items
  // ===========================================================================

  /**
   * Convert Supabase row to SharedClipboardItem.
   * Note: This is a sync conversion. For signed URLs, call rowToTeamItemAsync.
   */
  private rowToTeamItem(row: SharedClipboardRow): SharedClipboardItem {
    // Convert binary image data to base64 for IPC transport (legacy fallback).
    // Supabase can return bytea in different formats depending on context.
    let imageDataBase64: string | null = null;
    if (row.image_data && !row.image_path) {
      // Only process bytea if we don't have a storage path (legacy data).
      try {
        const imgData = row.image_data as unknown;
        if (Buffer.isBuffer(imgData)) {
          imageDataBase64 = imgData.toString('base64');
        } else if (imgData instanceof Uint8Array) {
          imageDataBase64 = Buffer.from(imgData).toString('base64');
        } else if (typeof imgData === 'string') {
          if (imgData.startsWith('\\x')) {
            const hexString = imgData.slice(2);
            imageDataBase64 = Buffer.from(hexString, 'hex').toString('base64');
          } else {
            imageDataBase64 = imgData;
          }
        } else if (typeof imgData === 'object' && imgData !== null) {
          const anyData = imgData as any;
          if (anyData.data && Array.isArray(anyData.data)) {
            imageDataBase64 = Buffer.from(anyData.data).toString('base64');
          } else {
            imageDataBase64 = Buffer.from(imgData as any).toString('base64');
          }
        }
      } catch (err) {
        console.error('[SharedClipboardSync] Failed to convert image_data:', err);
      }
    }

    return {
      id: row.id,
      userId: row.user_id,
      sharedByEmail: row.shared_by_email,
      type: row.type as ClipboardItemType,
      content: row.content,
      imageData: imageDataBase64,
      imagePath: row.image_path,
      imageUrl: null, // Set by rowToTeamItemAsync for storage bucket images.
      imageWidth: row.image_width,
      imageHeight: row.image_height,
      imageSize: row.image_size,
      improvedContent: row.improved_content,
      stackId: row.stack_id,
      sourceApp: row.source_app,
      sourceAppName: row.source_app_name,
      wordCount: row.word_count,
      charCount: row.char_count,
      clientId: row.client_id,
      clientCreatedAtMs: row.client_created_at_ms,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  /**
   * Convert row to SharedClipboardItem with signed URL for storage bucket images.
   * Use this when fetching items for display.
   */
  private async rowToTeamItemAsync(row: SharedClipboardRow): Promise<SharedClipboardItem> {
    const item = this.rowToTeamItem(row);

    // If we have an image_path, generate a signed URL.
    if (row.image_path && this.supabase) {
      try {
        const { data, error } = await this.supabase.storage
          .from('team-clipboard-images')
          .createSignedUrl(row.image_path, 3600); // 1 hour expiry.

        if (data && !error) {
          item.imageUrl = data.signedUrl;
        } else if (error) {
          console.error('[SharedClipboardSync] Failed to create signed URL:', error);
        }
      } catch (err) {
        console.error('[SharedClipboardSync] Error creating signed URL:', err);
      }
    }

    return item;
  }

  /**
   * Batch convert rows to SharedClipboardItems with signed URLs.
   * More efficient than calling rowToTeamItemAsync individually.
   */
  private async rowsToTeamItemsAsync(rows: SharedClipboardRow[]): Promise<SharedClipboardItem[]> {
    // First, convert all rows synchronously.
    const items = rows.map(row => this.rowToTeamItem(row));

    // Collect paths that need signed URLs.
    const pathsToSign: { index: number; path: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].image_path) {
        pathsToSign.push({ index: i, path: rows[i].image_path! });
      }
    }

    // Generate signed URLs in parallel for efficiency.
    if (pathsToSign.length > 0 && this.supabase) {
      const signPromises = pathsToSign.map(async ({ index, path }) => {
        try {
          const { data, error } = await this.supabase!.storage
            .from('team-clipboard-images')
            .createSignedUrl(path, 3600);

          if (data && !error) {
            items[index].imageUrl = data.signedUrl;
          }
        } catch (err) {
          console.error('[SharedClipboardSync] Error signing URL for', path, err);
        }
      });

      await Promise.all(signPromises);
    }

    return items;
  }

  /**
   * Query shared clipboard items.
   * Generates signed URLs for storage bucket images.
   */
  async queryItems(options: SharedClipboardQueryOptions = {}): Promise<SharedClipboardItem[]> {
    if (!this.isAuthenticated()) {
      console.warn('[SharedClipboardSync] Not authenticated');
      return [];
    }

    const { type, search, limit = 50, offset = 0, stackId } = options;

    try {
      let query = this.supabase!
        .from('team_clipboard_items')
        .select('*')
        .order('client_created_at_ms', { ascending: false })
        .range(offset, offset + limit - 1);

      // Filter by type.
      if (type) {
        query = query.eq('type', type);
      }

      // Filter by stack.
      if (stackId) {
        query = query.eq('stack_id', stackId);
      }

      // Basic search on content.
      if (search) {
        query = query.ilike('content', `%${search}%`);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[SharedClipboardSync] Query failed:', error);
        throw error;
      }

      const rows = data as SharedClipboardRow[];
      
      // Use async conversion to get signed URLs for storage bucket images.
      return this.rowsToTeamItemsAsync(rows);
    } catch (error) {
      console.error('[SharedClipboardSync] Failed to query shared items:', error);
      return [];
    }
  }

  /**
   * Get a single shared item by ID.
   */
  async getItem(id: string): Promise<SharedClipboardItem | null> {
    if (!this.isAuthenticated()) {
      return null;
    }

    try {
      const { data, error } = await this.supabase!
        .from('team_clipboard_items')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        console.error('[SharedClipboardSync] Get item failed:', error);
        return null;
      }

      return this.rowToTeamItemAsync(data as SharedClipboardRow);
    } catch (error) {
      console.error('[SharedClipboardSync] Failed to get shared item:', error);
      return null;
    }
  }

  /**
   * Get items by stack ID.
   */
  async getItemsByStackId(stackId: string): Promise<SharedClipboardItem[]> {
    if (!this.isAuthenticated()) {
      return [];
    }

    try {
      const { data, error } = await this.supabase!
        .from('team_clipboard_items')
        .select('*')
        .eq('stack_id', stackId)
        .order('client_created_at_ms', { ascending: true });

      if (error) {
        console.error('[SharedClipboardSync] Get stack items failed:', error);
        return [];
      }

      return this.rowsToTeamItemsAsync(data as SharedClipboardRow[]);
    } catch (error) {
      console.error('[SharedClipboardSync] Failed to get stack items:', error);
      return [];
    }
  }

  // ===========================================================================
  // Share to Team
  // ===========================================================================

  /**
   * Upload an image to the storage bucket.
   * Returns the storage path on success, null on failure.
   */
  private async uploadImageToStorage(
    imageBuffer: Buffer,
    userId: string,
    itemId: string
  ): Promise<string | null> {
    if (!this.supabase) return null;

    // File path: {user_id}/{item_id}.png
    const filePath = `${userId}/${itemId}.png`;

    try {
      const { error } = await this.supabase.storage
        .from('team-clipboard-images')
        .upload(filePath, imageBuffer, {
          contentType: 'image/png',
          upsert: false, // Don't overwrite if exists.
        });

      if (error) {
        console.error('[SharedClipboardSync] Image upload failed:', error);
        return null;
      }

      console.log('[SharedClipboardSync] Uploaded image to storage:', filePath);
      return filePath;
    } catch (err) {
      console.error('[SharedClipboardSync] Error uploading image:', err);
      return null;
    }
  }

  /**
   * Share a local clipboard item to the team.
   * Creates a copy in Supabase's team_clipboard_items table.
   * Images are uploaded to the storage bucket for better performance.
   */
  async shareToTeam(localItemId: number): Promise<SharedClipboardItem | null> {
    if (!this.isAuthenticated()) {
      console.warn('[SharedClipboardSync] Not authenticated, cannot share');
      return null;
    }

    const userId = this.getUserId();
    const userEmail = this.getUserEmail();
    if (!userId) {
      return null;
    }

    // Get the local item.
    const localItem = this.clipboardManager.getItem(localItemId);
    if (!localItem) {
      console.error('[SharedClipboardSync] Local item not found:', localItemId);
      return null;
    }

    // Generate a client ID for deduplication.
    const clientId = `local-${localItemId}-${Date.now()}`;
    
    // Generate a unique item ID for storage path (we'll use this as the DB record ID too).
    const itemId = crypto.randomUUID();

    try {
      // Upload image to storage bucket if this is an image/screenshot.
      let imagePath: string | null = null;
      if (localItem.imageData && (localItem.type === 'image' || localItem.type === 'screenshot')) {
        imagePath = await this.uploadImageToStorage(localItem.imageData, userId, itemId);
      }

      const insertData = {
        id: itemId, // Use our generated ID so it matches the storage path.
        user_id: userId,
        shared_by_email: userEmail,
        type: localItem.type,
        content: localItem.content,
        image_data: null, // No longer storing in bytea.
        image_path: imagePath, // Storage bucket path.
        image_width: localItem.imageWidth,
        image_height: localItem.imageHeight,
        image_size: localItem.imageSize,
        improved_content: localItem.improvedContent,
        stack_id: null, // Shared as individual item, not in a stack.
        source_app: localItem.sourceApp,
        source_app_name: localItem.sourceAppName,
        word_count: localItem.wordCount,
        char_count: localItem.charCount,
        client_id: clientId,
        client_created_at_ms: localItem.createdAt,
      };

      const { data, error } = await this.supabase!
        .from('team_clipboard_items')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error('[SharedClipboardSync] Share to team failed:', error);
        throw error;
      }

      console.log('[SharedClipboardSync] Shared item to team:', data.id);
      
      // Use async conversion to get signed URL for the uploaded image.
      const teamItem = await this.rowToTeamItemAsync(data as SharedClipboardRow);
      this.emit('teamItemAdded', teamItem);
      return teamItem;
    } catch (error) {
      console.error('[SharedClipboardSync] Failed to share to team:', error);
      return null;
    }
  }

  /**
   * Share a stack of local items to the team.
   * Creates copies in Supabase with a shared stack_id.
   * Images are uploaded to the storage bucket.
   */
  async shareStackToTeam(localItemIds: number[]): Promise<string | null> {
    if (!this.isAuthenticated()) {
      console.warn('[SharedClipboardSync] Not authenticated, cannot share stack');
      return null;
    }

    const userId = this.getUserId();
    const userEmail = this.getUserEmail();
    if (!userId || localItemIds.length === 0) {
      return null;
    }

    // Generate a new shared stack ID.
    const teamStackId = crypto.randomUUID();

    try {
      // First, create the stack record.
      const { error: stackError } = await this.supabase!
        .from('team_clipboard_stacks')
        .insert({
          stack_id: teamStackId,
          created_by_user_id: userId,
          created_by_email: userEmail,
          name: null,
        });

      if (stackError) {
        console.error('[SharedClipboardSync] Create shared stack failed:', stackError);
        throw stackError;
      }

      // Now share each item with the stack ID.
      for (const localItemId of localItemIds) {
        const localItem = this.clipboardManager.getItem(localItemId);
        if (!localItem) {
          continue;
        }

        const clientId = `local-${localItemId}-${Date.now()}-${Math.random()}`;
        const itemId = crypto.randomUUID();

        // Upload image to storage bucket if applicable.
        let imagePath: string | null = null;
        if (localItem.imageData && (localItem.type === 'image' || localItem.type === 'screenshot')) {
          imagePath = await this.uploadImageToStorage(localItem.imageData, userId, itemId);
        }

        const insertData = {
          id: itemId,
          user_id: userId,
          shared_by_email: userEmail,
          type: localItem.type,
          content: localItem.content,
          image_data: null, // No longer storing in bytea.
          image_path: imagePath, // Storage bucket path.
          image_width: localItem.imageWidth,
          image_height: localItem.imageHeight,
          image_size: localItem.imageSize,
          improved_content: localItem.improvedContent,
          stack_id: teamStackId,
          source_app: localItem.sourceApp,
          source_app_name: localItem.sourceAppName,
          word_count: localItem.wordCount,
          char_count: localItem.charCount,
          client_id: clientId,
          client_created_at_ms: localItem.createdAt,
        };

        const { error } = await this.supabase!
          .from('team_clipboard_items')
          .insert(insertData);

        if (error) {
          console.error('[SharedClipboardSync] Failed to share item in stack:', error);
        }
      }

      console.log(`[SharedClipboardSync] Shared stack to team: ${teamStackId} (${localItemIds.length} items)`);
      this.emit('teamStackAdded', teamStackId);
      return teamStackId;
    } catch (error) {
      console.error('[SharedClipboardSync] Failed to share stack to team:', error);
      return null;
    }
  }

  // ===========================================================================
  // Delete Team Items
  // ===========================================================================

  /**
   * Delete a shared item.
   * Only the owner can delete their items (enforced by RLS).
   * Also cleans up the image from storage if present.
   */
  async deleteItem(id: string): Promise<boolean> {
    if (!this.isAuthenticated()) {
      return false;
    }

    try {
      // First, get the item to check for image_path.
      const { data: item } = await this.supabase!
        .from('team_clipboard_items')
        .select('image_path')
        .eq('id', id)
        .single();

      // Delete the database record.
      const { error } = await this.supabase!
        .from('team_clipboard_items')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('[SharedClipboardSync] Delete item failed:', error);
        return false;
      }

      // Clean up the image from storage if it exists.
      if (item?.image_path) {
        try {
          await this.supabase!.storage
            .from('team-clipboard-images')
            .remove([item.image_path]);
          console.log('[SharedClipboardSync] Deleted image from storage:', item.image_path);
        } catch (storageErr) {
          // Non-fatal - the DB record is already deleted.
          console.warn('[SharedClipboardSync] Failed to delete image from storage:', storageErr);
        }
      }

      console.log('[SharedClipboardSync] Deleted shared item:', id);
      this.emit('teamItemDeleted', id);
      return true;
    } catch (error) {
      console.error('[SharedClipboardSync] Failed to delete shared item:', error);
      return false;
    }
  }

  // ===========================================================================
  // Stack Operations
  // ===========================================================================

  /**
   * Update stack ID for shared items (move items between stacks).
   */
  async updateStackId(itemIds: string[], stackId: string | null): Promise<boolean> {
    if (!this.isAuthenticated() || itemIds.length === 0) {
      return false;
    }

    try {
      // If creating a new stack, create the stack record first.
      if (stackId) {
        const userId = this.getUserId();
        const userEmail = this.getUserEmail();

        // Check if stack already exists.
        const { data: existing } = await this.supabase!
          .from('team_clipboard_stacks')
          .select('stack_id')
          .eq('stack_id', stackId)
          .single();

        if (!existing) {
          // Create new stack.
          await this.supabase!
            .from('team_clipboard_stacks')
            .insert({
              stack_id: stackId,
              created_by_user_id: userId,
              created_by_email: userEmail,
              name: null,
            });
        }
      }

      // Update the items.
      const { error } = await this.supabase!
        .from('team_clipboard_items')
        .update({ stack_id: stackId })
        .in('id', itemIds);

      if (error) {
        console.error('[SharedClipboardSync] Update stack ID failed:', error);
        return false;
      }

      console.log(`[SharedClipboardSync] Updated stack_id for ${itemIds.length} items to: ${stackId}`);
      return true;
    } catch (error) {
      console.error('[SharedClipboardSync] Failed to update stack ID:', error);
      return false;
    }
  }

  /**
   * Get all shared stacks with summary info.
   */
  async getStacks(): Promise<SharedStackInfo[]> {
    if (!this.isAuthenticated()) {
      return [];
    }

    try {
      // Get stacks with item counts.
      const { data: stacks, error: stacksError } = await this.supabase!
        .from('team_clipboard_stacks')
        .select('*')
        .order('created_at', { ascending: false });

      if (stacksError) {
        console.error('[SharedClipboardSync] Get stacks failed:', stacksError);
        return [];
      }

      // For each stack, get item counts and preview.
      const stackInfos: SharedStackInfo[] = [];

      for (const stack of stacks as TeamStackRow[]) {
        const { data: items } = await this.supabase!
          .from('team_clipboard_items')
          .select('type, content')
          .eq('stack_id', stack.stack_id)
          .order('client_created_at_ms', { ascending: true });

        if (!items || items.length === 0) {
          continue; // Skip empty stacks.
        }

        const imageCount = items.filter(i => i.type === 'image' || i.type === 'screenshot').length;
        const textCount = items.filter(i => i.type === 'text' || i.type === 'transcript').length;
        const firstTextItem = items.find(i => i.content);
        const firstTextPreview = firstTextItem?.content
          ? (firstTextItem.content.length > 100
            ? firstTextItem.content.substring(0, 100) + '...'
            : firstTextItem.content)
          : null;

        stackInfos.push({
          stackId: stack.stack_id,
          name: stack.name,
          itemCount: items.length,
          imageCount,
          textCount,
          createdByEmail: stack.created_by_email,
          createdAt: new Date(stack.created_at).getTime(),
          firstTextPreview,
        });
      }

      return stackInfos;
    } catch (error) {
      console.error('[SharedClipboardSync] Failed to get stacks:', error);
      return [];
    }
  }

  // ===========================================================================
  // Copy to Personal
  // ===========================================================================

  /**
   * Download image data from storage bucket.
   * Returns the image as a Buffer, or null on failure.
   */
  private async downloadImageFromStorage(imagePath: string): Promise<Buffer | null> {
    if (!this.supabase) return null;

    try {
      const { data, error } = await this.supabase.storage
        .from('team-clipboard-images')
        .download(imagePath);

      if (error || !data) {
        console.error('[SharedClipboardSync] Image download failed:', error);
        return null;
      }

      // Convert Blob to Buffer.
      const arrayBuffer = await data.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      console.error('[SharedClipboardSync] Error downloading image:', err);
      return null;
    }
  }

  /**
   * Copy a shared item to personal clipboard.
   * Creates a local copy that's independent of the shared item.
   */
  async copyToPersonal(teamItemId: string): Promise<number | null> {
    if (!this.isAuthenticated()) {
      return null;
    }

    const teamItem = await this.getItem(teamItemId);
    if (!teamItem) {
      console.error('[SharedClipboardSync] Team item not found:', teamItemId);
      return null;
    }

    try {
      if (teamItem.type === 'text' || teamItem.type === 'transcript') {
        // Store text item locally.
        const localId = await this.clipboardManager.storeText(
          teamItem.content || '',
          teamItem.type,
          teamItem.sourceApp || undefined,
          undefined, // No stack - copied as individual item.
          'mac', // Now local.
          teamItem.clientCreatedAtMs
        );
        console.log(`[SharedClipboardSync] Copied shared item ${teamItemId} to personal: ${localId}`);
        return localId;
      } else if (teamItem.type === 'image' || teamItem.type === 'screenshot') {
        // Get image data - prefer storage bucket, fall back to base64.
        let imageBuffer: Buffer | null = null;

        if (teamItem.imagePath) {
          // Download from storage bucket.
          imageBuffer = await this.downloadImageFromStorage(teamItem.imagePath);
        } else if (teamItem.imageData) {
          // Legacy: decode from base64.
          imageBuffer = Buffer.from(teamItem.imageData, 'base64');
        }

        if (!imageBuffer) {
          console.error('[SharedClipboardSync] Team image has no data');
          return null;
        }

        const { nativeImage } = await import('electron');
        const image = nativeImage.createFromBuffer(imageBuffer);

        const localId = await this.clipboardManager.storeImage(
          image,
          imageBuffer,
          teamItem.type,
          teamItem.sourceApp || undefined,
          undefined, // No stack.
          'mac'
        );
        console.log(`[SharedClipboardSync] Copied team image ${teamItemId} to personal: ${localId}`);
        return localId;
      }

      return null;
    } catch (error) {
      console.error('[SharedClipboardSync] Failed to copy to personal:', error);
      return null;
    }
  }

  /**
   * Copy a shared stack to personal clipboard.
   * Creates local copies of all items in the stack with a new local stack ID.
   */
  async copyStackToPersonal(teamStackId: string): Promise<number[]> {
    if (!this.isAuthenticated()) {
      return [];
    }

    const teamItems = await this.getItemsByStackId(teamStackId);
    if (teamItems.length === 0) {
      console.warn('[SharedClipboardSync] Team stack is empty:', teamStackId);
      return [];
    }

    // Generate a new local stack ID.
    const localStackId = crypto.randomUUID();
    const localIds: number[] = [];

    try {
      for (const teamItem of teamItems) {
        if (teamItem.type === 'text' || teamItem.type === 'transcript') {
          const localId = await this.clipboardManager.storeText(
            teamItem.content || '',
            teamItem.type,
            teamItem.sourceApp || undefined,
            localStackId,
            'mac',
            teamItem.clientCreatedAtMs
          );
          if (localId > 0) {
            localIds.push(localId);
          }
        } else if (teamItem.type === 'image' || teamItem.type === 'screenshot') {
          // Get image data - prefer storage bucket, fall back to base64.
          let imageBuffer: Buffer | null = null;

          if (teamItem.imagePath) {
            imageBuffer = await this.downloadImageFromStorage(teamItem.imagePath);
          } else if (teamItem.imageData) {
            imageBuffer = Buffer.from(teamItem.imageData, 'base64');
          }

          if (imageBuffer) {
            const { nativeImage } = await import('electron');
            const image = nativeImage.createFromBuffer(imageBuffer);

            const localId = await this.clipboardManager.storeImage(
              image,
              imageBuffer,
              teamItem.type,
              teamItem.sourceApp || undefined,
              localStackId,
              'mac'
            );
            if (localId > 0) {
              localIds.push(localId);
            }
          }
        }
      }

      console.log(`[SharedClipboardSync] Copied shared stack ${teamStackId} to personal: ${localIds.length} items`);
      return localIds;
    } catch (error) {
      console.error('[SharedClipboardSync] Failed to copy stack to personal:', error);
      return localIds;
    }
  }

  // ===========================================================================
  // Team Membership
  // ===========================================================================

  /**
   * Add a team member by email.
   * The member can see shared items once they create an account with that email.
   */
  async addTeamMember(email: string): Promise<{ success: boolean; error?: string }> {
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
      return { success: false, error: 'Cannot add yourself as a team member' };
    }

    try {
      const { error } = await this.supabase!
        .from('team_members')
        .insert({
          added_by_user_id: userId,
          member_email: email.toLowerCase(),
        });

      if (error) {
        // Handle unique constraint violation.
        if (error.code === '23505') {
          return { success: false, error: 'This person is already on your team' };
        }
        console.error('[SharedClipboardSync] Add team member failed:', error);
        return { success: false, error: error.message };
      }

      console.log('[SharedClipboardSync] Added team member:', email);
      this.emit('teamMemberAdded', email);
      return { success: true };
    } catch (error) {
      console.error('[SharedClipboardSync] Failed to add team member:', error);
      return { success: false, error: 'Failed to add team member' };
    }
  }

  /**
   * Remove a team member.
   * Can remove someone you added, or remove yourself from a team.
   */
  async removeTeamMember(membershipId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isAuthenticated()) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const { error } = await this.supabase!
        .from('team_members')
        .delete()
        .eq('id', membershipId);

      if (error) {
        console.error('[SharedClipboardSync] Remove team member failed:', error);
        return { success: false, error: error.message };
      }

      console.log('[SharedClipboardSync] Removed team member:', membershipId);
      this.emit('teamMemberRemoved', membershipId);
      return { success: true };
    } catch (error) {
      console.error('[SharedClipboardSync] Failed to remove team member:', error);
      return { success: false, error: 'Failed to remove team member' };
    }
  }

  /**
   * Get all team members.
   * Returns people you added and people who added you.
   */
  async getTeamMembers(): Promise<TeamMember[]> {
    if (!this.isAuthenticated()) {
      return [];
    }

    const userId = this.getUserId();
    const myEmail = this.getUserEmail();
    if (!userId || !myEmail) {
      return [];
    }

    try {
      const { data, error } = await this.supabase!
        .from('team_members')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[SharedClipboardSync] Get team members failed:', error);
        return [];
      }

      // Convert rows to TeamMember objects.
      // Each row represents a relationship. We want to show the "other person".
      const members: TeamMember[] = [];
      const seenEmails = new Set<string>();

      for (const row of data as TeamMemberRow[]) {
        const addedByMe = row.added_by_user_id === userId;
        const email = row.member_email;

        // Skip duplicates (could happen if A added B and B added A).
        if (seenEmails.has(email.toLowerCase())) {
          continue;
        }
        seenEmails.add(email.toLowerCase());

        // Don't show my own email in the list.
        if (email.toLowerCase() === myEmail.toLowerCase()) {
          continue;
        }

        members.push({
          id: row.id,
          email: email,
          addedByMe: addedByMe,
          createdAt: new Date(row.created_at).getTime(),
        });
      }

      return members;
    } catch (error) {
      console.error('[SharedClipboardSync] Failed to get team members:', error);
      return [];
    }
  }

  /**
   * Check if the current user has any teammates.
   */
  async hasTeammates(): Promise<boolean> {
    const members = await this.getTeamMembers();
    return members.length > 0;
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.session = null;
    this.supabase = null;
    this.removeAllListeners();
    console.log('[SharedClipboardSync] Destroyed');
  }
}
