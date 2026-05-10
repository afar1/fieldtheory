/**
 * Commands Service - Fetch and manage portable commands from Supabase.
 *
 * Commands are synced from the Mac app's watched directories when mobile sync is enabled.
 * This service:
 * 1. Fetches commands from Supabase user_commands table
 * 2. Caches them locally for offline use
 * 3. Detects command invocations in transcribed text
 * 4. Formats command content for inline expansion
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { getSession } from './auth';
import { Command, CommandDetectionResult } from '../types';

// Storage key for cached commands.
// The legacy key is removed on auth changes so synced commands do not leak
// across users on a shared device.
const LEGACY_COMMANDS_KEY = '@littleai/commands';
const COMMANDS_KEY_PREFIX = '@littleai/commands';

/**
 * Row from Supabase user_commands table.
 */
interface CommandRow {
  id: string;
  user_id: string;
  name: string;
  display_name: string;
  content: string;
  source_path: string | null;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Convert Supabase row to local Command type.
 */
const toLocalCommand = (row: CommandRow): Command => ({
  id: row.id,
  name: row.name,
  displayName: row.display_name,
  content: row.content,
  updatedAt: new Date(row.updated_at).getTime(),
});

/**
 * Normalize command for storage.
 */
const normalizeCommand = (raw: Command): Command => ({
  ...raw,
  updatedAt: raw.updatedAt ?? Date.now(),
});

/**
 * Commands service for fetching, caching, and detecting portable commands.
 */
export class CommandsService {
  private static cacheKeyForUser(userId: string): string {
    return `${COMMANDS_KEY_PREFIX}/${userId}`;
  }

  /**
   * Fetch commands from Supabase and cache locally.
   * Returns the fetched commands.
   */
  static async fetchCommands(): Promise<Command[]> {
    const session = await getSession();
    if (!session) {
      return [];
    }

    try {
      const { data, error } = await supabase
        .from('user_commands')
        .select('*')
        .order('name', { ascending: true });

      if (error) {
        console.error('CommandsService: Fetch error:', error);
        return this.getCachedCommands();
      }

      const commands = (data ?? []).map(toLocalCommand);

      // Cache for offline use
      await this.cacheCommands(commands, session.user.id);

      return commands;
    } catch (error) {
      console.error('CommandsService: Network error:', error);
      return this.getCachedCommands();
    }
  }

  /**
   * Get cached commands from local storage.
   */
  static async getCachedCommands(): Promise<Command[]> {
    try {
      const session = await getSession();
      if (!session) return [];

      const data = await AsyncStorage.getItem(this.cacheKeyForUser(session.user.id));
      return data ? JSON.parse(data).map(normalizeCommand) : [];
    } catch (error) {
      console.error('CommandsService: Cache read error:', error);
      return [];
    }
  }

  /**
   * Cache commands to local storage.
   */
  static async cacheCommands(commands: Command[], userId?: string): Promise<void> {
    try {
      const session = userId ? null : await getSession();
      const cacheUserId = userId ?? session?.user.id;
      if (!cacheUserId) return;

      await AsyncStorage.setItem(this.cacheKeyForUser(cacheUserId), JSON.stringify(commands));
    } catch (error) {
      console.error('CommandsService: Cache write error:', error);
    }
  }

  /**
   * Get a command by name (case-insensitive).
   */
  static async getCommandByName(name: string): Promise<Command | null> {
    const commands = await this.getCachedCommands();
    const lowerName = name.toLowerCase();
    return commands.find(cmd => cmd.name.toLowerCase() === lowerName) || null;
  }

  /**
   * Detect command invocations in text.
   * Looks for patterns like:
   * - "use the [name] command"
   * - "use the commands [name], [name], and [name]"
   *
   * Ported from Mac app's CommandsManager.detectCommands()
   */
  static async detectCommands(
    text: string,
    availableCommands?: Command[]
  ): Promise<CommandDetectionResult> {
    const commands = availableCommands || await this.getCachedCommands();
    const commandsByName = new Map(commands.map(c => [c.name.toLowerCase(), c]));

    const result: CommandDetectionResult = {
      detected: false,
      commandNames: [],
      matchedCommands: [],
      unmatchedNames: [],
      textWithoutCommandRefs: text,
    };

    if (commands.length === 0) {
      return result;
    }

    // Singular pattern: "use the [name] command"
    const singularPattern = /use\s+the\s+(\S+)\s+command/gi;
    let match;
    const detectedNames = new Set<string>();

    while ((match = singularPattern.exec(text)) !== null) {
      const name = match[1].toLowerCase().replace(/[.,!?;:'"]+$/, '');
      detectedNames.add(name);
    }

    // Plural pattern: "use the commands X, Y, and Z"
    const pluralPattern = /use\s+the\s+commands?\s+(.+?)(?:\.|$)/gi;
    while ((match = pluralPattern.exec(text)) !== null) {
      const nameList = match[1];
      // Parse comma-separated list with optional "and"
      const names = nameList
        .split(/[,\s]+and\s+|,\s*/)
        .map(n => n.trim().toLowerCase().replace(/[.,!?;:'"]+$/, ''))
        .filter(n => n.length > 0);
      names.forEach(n => detectedNames.add(n));
    }

    if (detectedNames.size === 0) {
      return result;
    }

    // Match detected names to available commands
    for (const name of detectedNames) {
      result.commandNames.push(name);
      const command = commandsByName.get(name);
      if (command) {
        result.matchedCommands.push(command);
      } else {
        result.unmatchedNames.push(name);
      }
    }

    result.detected = result.matchedCommands.length > 0;

    // Replace command invocations with inline references
    if (result.detected) {
      let modifiedText = text;
      let refIndex = 1;
      const refs: string[] = [];

      for (const cmd of result.matchedCommands) {
        // Replace "use the [name] command" with "[cmd#: name]"
        const refPattern = new RegExp(
          `use\\s+the\\s+${cmd.name}\\s+command`,
          'gi'
        );
        const refLabel = `[cmd${refIndex}: ${cmd.displayName}]`;
        modifiedText = modifiedText.replace(refPattern, refLabel);
        refs.push(`${refLabel}`);
        refIndex++;
      }

      result.textWithoutCommandRefs = modifiedText;
    }

    return result;
  }

  /**
   * Format transcribed text with expanded command content.
   * This is what gets copied to clipboard on mobile.
   *
   * Example output:
   * ```
   * Please review this code and use the review command
   *
   * ---
   * # Commands
   *
   * ## review
   *
   * [full markdown content here]
   *
   * ---
   * ```
   */
  static formatWithExpandedCommands(
    text: string,
    matchedCommands: Command[]
  ): string {
    if (matchedCommands.length === 0) {
      return text;
    }

    const commandsSection = matchedCommands
      .map(cmd => {
        return `## ${cmd.displayName}\n\n${cmd.content}`;
      })
      .join('\n\n');

    return `${text}

---
# Commands

The following commands were invoked. Please follow the instructions in each command carefully.

${commandsSection}

---`;
  }

  /**
   * Process transcribed text: detect commands and format with expanded content.
   * Returns the processed text ready for clipboard.
   */
  static async processTranscription(text: string): Promise<{
    processedText: string;
    detectedCommands: Command[];
  }> {
    const detection = await this.detectCommands(text);

    if (!detection.detected) {
      return {
        processedText: text,
        detectedCommands: [],
      };
    }

    const processedText = this.formatWithExpandedCommands(
      text,
      detection.matchedCommands
    );

    return {
      processedText,
      detectedCommands: detection.matchedCommands,
    };
  }

  /**
   * Create a new command from raw user input.
   *
   * Convention: the first line of `rawText` becomes the display name; the rest
   * (or the full text if there's only one line) becomes the content. The slug
   * `name` is derived from the display name. Inserted into Supabase
   * user_commands and added to the local cache.
   */
  static async createCommand(rawText: string): Promise<Command | null> {
    const session = await getSession();
    if (!session) {
      console.warn('CommandsService.createCommand: not signed in');
      return null;
    }

    const trimmed = rawText.trim();
    if (!trimmed) return null;

    const lines = trimmed.split(/\r?\n/);
    const displayName = (lines[0] ?? '').trim().slice(0, 80) || 'Untitled';
    const content = lines.length > 1 ? lines.slice(1).join('\n').trim() : trimmed;
    const slug = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || `cmd-${Date.now()}`;

    try {
      const { data, error } = await supabase
        .from('user_commands')
        .insert({
          user_id: session.user.id,
          name: slug,
          display_name: displayName,
          content,
          source_path: null,
          content_hash: null,
        })
        .select('*')
        .single();

      if (error || !data) {
        console.error('CommandsService.createCommand: insert error', error);
        return null;
      }

      const cmd = toLocalCommand(data as CommandRow);
      const cached = await this.getCachedCommands();
      await this.cacheCommands([...cached, cmd], session.user.id);
      return cmd;
    } catch (err) {
      console.error('CommandsService.createCommand: network error', err);
      return null;
    }
  }

  /**
   * Clear cached commands (for sign out).
   */
  static async clearCache(userId?: string): Promise<void> {
    try {
      const session = userId ? null : await getSession().catch(() => null);
      const cacheUserId = userId ?? session?.user.id;
      await AsyncStorage.removeItem(LEGACY_COMMANDS_KEY);
      if (cacheUserId) {
        await AsyncStorage.removeItem(this.cacheKeyForUser(cacheUserId));
      }
    } catch (error) {
      console.error('CommandsService: Clear cache error:', error);
    }
  }
}
