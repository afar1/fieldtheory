/**
 * TeamClipboardSync - Syncs shared team clipboard items with Supabase.
 * 
 * This enables collaborative clipboard sharing between users signed into
 * the same account. Users can:
 * - Share items to the team clipboard
 * - View team items (same UI as personal clipboard)
 * - Create and modify stacks in the team view
 * - Copy team items to their personal clipboard
 * 
 * Once copied to personal, items are independent snapshots - changes to
 * the team stack don't affect the personal copy.
 */

import { SupabaseClient, Session } from '@supabase/supabase-js';
import { ClipboardManager, ClipboardItem as LocalClipboardItem, ClipboardItemType } from './clipboardManager';
import { EventEmitter } from 'events';
import crypto from 'crypto';

// =============================================================================
// Types
// =============================================================================

/**
 * Team clipboard item from Supabase.
 */
export interface TeamClipboardItem {
  id: string;
  userId: string;
  sharedByEmail: string | null;
  type: ClipboardItemType;
  content: string | null;
  imageData: string | null; // base64 for IPC
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
 * Team stack info for UI display.
 */
export interface TeamStackInfo {
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
 * Query options for fetching team items.
 */
export interface TeamClipboardQueryOptions {
  type?: ClipboardItemType;
  search?: string;
  limit?: number;
  offset?: number;
  stackId?: string;
}

/**
 * Row from Supabase team_clipboard_items table.
 */
interface TeamClipboardRow {
  id: string;
  user_id: string;
  shared_by_email: string | null;
  type: string;
  content: string | null;
  image_data: Buffer | null;
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

// =============================================================================
// TeamClipboardSync Class
// =============================================================================

/**
 * Manages team clipboard sync with Supabase.
 * Works alongside ClipboardManager for local storage.
 */
export class TeamClipboardSync extends EventEmitter {
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
      console.log('[TeamClipboardSync] Session set for user:', session.user?.email);
    } else {
      console.log('[TeamClipboardSync] Session cleared');
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
   * Convert Supabase row to TeamClipboardItem.
   */
  private rowToTeamItem(row: TeamClipboardRow): TeamClipboardItem {
    return {
      id: row.id,
      userId: row.user_id,
      sharedByEmail: row.shared_by_email,
      type: row.type as ClipboardItemType,
      content: row.content,
      // Convert binary image data to base64 for IPC transport.
      imageData: row.image_data ? Buffer.from(row.image_data).toString('base64') : null,
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
   * Query team clipboard items.
   */
  async queryItems(options: TeamClipboardQueryOptions = {}): Promise<TeamClipboardItem[]> {
    if (!this.isAuthenticated()) {
      console.warn('[TeamClipboardSync] Not authenticated');
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
        console.error('[TeamClipboardSync] Query failed:', error);
        throw error;
      }

      return (data as TeamClipboardRow[]).map(row => this.rowToTeamItem(row));
    } catch (error) {
      console.error('[TeamClipboardSync] Failed to query team items:', error);
      return [];
    }
  }

  /**
   * Get a single team item by ID.
   */
  async getItem(id: string): Promise<TeamClipboardItem | null> {
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
        console.error('[TeamClipboardSync] Get item failed:', error);
        return null;
      }

      return this.rowToTeamItem(data as TeamClipboardRow);
    } catch (error) {
      console.error('[TeamClipboardSync] Failed to get team item:', error);
      return null;
    }
  }

  /**
   * Get items by stack ID.
   */
  async getItemsByStackId(stackId: string): Promise<TeamClipboardItem[]> {
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
        console.error('[TeamClipboardSync] Get stack items failed:', error);
        return [];
      }

      return (data as TeamClipboardRow[]).map(row => this.rowToTeamItem(row));
    } catch (error) {
      console.error('[TeamClipboardSync] Failed to get stack items:', error);
      return [];
    }
  }

  // ===========================================================================
  // Share to Team
  // ===========================================================================

  /**
   * Share a local clipboard item to the team.
   * Creates a copy in Supabase's team_clipboard_items table.
   */
  async shareToTeam(localItemId: number): Promise<TeamClipboardItem | null> {
    if (!this.isAuthenticated()) {
      console.warn('[TeamClipboardSync] Not authenticated, cannot share');
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
      console.error('[TeamClipboardSync] Local item not found:', localItemId);
      return null;
    }

    // Generate a client ID for deduplication.
    const clientId = `local-${localItemId}-${Date.now()}`;

    try {
      // Prepare image data for upload.
      let imageDataForUpload: Buffer | null = null;
      if (localItem.imageData) {
        imageDataForUpload = localItem.imageData;
      }

      const insertData = {
        user_id: userId,
        shared_by_email: userEmail,
        type: localItem.type,
        content: localItem.content,
        image_data: imageDataForUpload,
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
        console.error('[TeamClipboardSync] Share to team failed:', error);
        throw error;
      }

      console.log('[TeamClipboardSync] Shared item to team:', data.id);
      const teamItem = this.rowToTeamItem(data as TeamClipboardRow);
      this.emit('teamItemAdded', teamItem);
      return teamItem;
    } catch (error) {
      console.error('[TeamClipboardSync] Failed to share to team:', error);
      return null;
    }
  }

  /**
   * Share a stack of local items to the team.
   * Creates copies in Supabase with a shared stack_id.
   */
  async shareStackToTeam(localItemIds: number[]): Promise<string | null> {
    if (!this.isAuthenticated()) {
      console.warn('[TeamClipboardSync] Not authenticated, cannot share stack');
      return null;
    }

    const userId = this.getUserId();
    const userEmail = this.getUserEmail();
    if (!userId || localItemIds.length === 0) {
      return null;
    }

    // Generate a new team stack ID.
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
        console.error('[TeamClipboardSync] Create team stack failed:', stackError);
        throw stackError;
      }

      // Now share each item with the stack ID.
      for (const localItemId of localItemIds) {
        const localItem = this.clipboardManager.getItem(localItemId);
        if (!localItem) {
          continue;
        }

        const clientId = `local-${localItemId}-${Date.now()}-${Math.random()}`;

        let imageDataForUpload: Buffer | null = null;
        if (localItem.imageData) {
          imageDataForUpload = localItem.imageData;
        }

        const insertData = {
          user_id: userId,
          shared_by_email: userEmail,
          type: localItem.type,
          content: localItem.content,
          image_data: imageDataForUpload,
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
          console.error('[TeamClipboardSync] Failed to share item in stack:', error);
        }
      }

      console.log(`[TeamClipboardSync] Shared stack to team: ${teamStackId} (${localItemIds.length} items)`);
      this.emit('teamStackAdded', teamStackId);
      return teamStackId;
    } catch (error) {
      console.error('[TeamClipboardSync] Failed to share stack to team:', error);
      return null;
    }
  }

  // ===========================================================================
  // Delete Team Items
  // ===========================================================================

  /**
   * Delete a team item.
   * Only the owner can delete their items (enforced by RLS).
   */
  async deleteItem(id: string): Promise<boolean> {
    if (!this.isAuthenticated()) {
      return false;
    }

    try {
      const { error } = await this.supabase!
        .from('team_clipboard_items')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('[TeamClipboardSync] Delete item failed:', error);
        return false;
      }

      console.log('[TeamClipboardSync] Deleted team item:', id);
      this.emit('teamItemDeleted', id);
      return true;
    } catch (error) {
      console.error('[TeamClipboardSync] Failed to delete team item:', error);
      return false;
    }
  }

  // ===========================================================================
  // Stack Operations
  // ===========================================================================

  /**
   * Update stack ID for team items (move items between stacks).
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
        console.error('[TeamClipboardSync] Update stack ID failed:', error);
        return false;
      }

      console.log(`[TeamClipboardSync] Updated stack_id for ${itemIds.length} items to: ${stackId}`);
      return true;
    } catch (error) {
      console.error('[TeamClipboardSync] Failed to update stack ID:', error);
      return false;
    }
  }

  /**
   * Get all team stacks with summary info.
   */
  async getStacks(): Promise<TeamStackInfo[]> {
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
        console.error('[TeamClipboardSync] Get stacks failed:', stacksError);
        return [];
      }

      // For each stack, get item counts and preview.
      const stackInfos: TeamStackInfo[] = [];

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
      console.error('[TeamClipboardSync] Failed to get stacks:', error);
      return [];
    }
  }

  // ===========================================================================
  // Copy to Personal
  // ===========================================================================

  /**
   * Copy a team item to personal clipboard.
   * Creates a local copy that's independent of the team item.
   */
  async copyToPersonal(teamItemId: string): Promise<number | null> {
    if (!this.isAuthenticated()) {
      return null;
    }

    const teamItem = await this.getItem(teamItemId);
    if (!teamItem) {
      console.error('[TeamClipboardSync] Team item not found:', teamItemId);
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
        console.log(`[TeamClipboardSync] Copied team item ${teamItemId} to personal: ${localId}`);
        return localId;
      } else if (teamItem.type === 'image' || teamItem.type === 'screenshot') {
        // Store image item locally.
        if (!teamItem.imageData) {
          console.error('[TeamClipboardSync] Team image has no data');
          return null;
        }

        const { nativeImage } = await import('electron');
        const imageBuffer = Buffer.from(teamItem.imageData, 'base64');
        const image = nativeImage.createFromBuffer(imageBuffer);

        const localId = await this.clipboardManager.storeImage(
          image,
          imageBuffer,
          teamItem.type,
          teamItem.sourceApp || undefined,
          undefined, // No stack.
          'mac'
        );
        console.log(`[TeamClipboardSync] Copied team image ${teamItemId} to personal: ${localId}`);
        return localId;
      }

      return null;
    } catch (error) {
      console.error('[TeamClipboardSync] Failed to copy to personal:', error);
      return null;
    }
  }

  /**
   * Copy a team stack to personal clipboard.
   * Creates local copies of all items in the stack with a new local stack ID.
   */
  async copyStackToPersonal(teamStackId: string): Promise<number[]> {
    if (!this.isAuthenticated()) {
      return [];
    }

    const teamItems = await this.getItemsByStackId(teamStackId);
    if (teamItems.length === 0) {
      console.warn('[TeamClipboardSync] Team stack is empty:', teamStackId);
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
          if (teamItem.imageData) {
            const { nativeImage } = await import('electron');
            const imageBuffer = Buffer.from(teamItem.imageData, 'base64');
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

      console.log(`[TeamClipboardSync] Copied team stack ${teamStackId} to personal: ${localIds.length} items`);
      return localIds;
    } catch (error) {
      console.error('[TeamClipboardSync] Failed to copy stack to personal:', error);
      return localIds;
    }
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
    console.log('[TeamClipboardSync] Destroyed');
  }
}
