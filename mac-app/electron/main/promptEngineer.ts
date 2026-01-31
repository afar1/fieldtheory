/**
 * Transcript Improvement Service
 *
 * Cleans up spoken transcripts into clear, concise prose using
 * the cloud Edge Function.
 */

import { createLogger } from './logger';

const log = createLogger('PromptEngineer');

// Supabase URL for Edge Functions (set from environment)
let supabaseUrl: string | null = null;

/**
 * Set the Supabase URL for Edge Function calls.
 */
export function setSupabaseUrl(url: string): void {
  supabaseUrl = url;
}

/**
 * Token usage from API response.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Result from transcript improvement operation.
 */
export interface EngineerResult {
  success: boolean;
  refinedPrompt?: string;
  error?: string;
  usage?: TokenUsage;
  wordCount?: number;
  quotaExceeded?: boolean;
  showQuotaMessage?: boolean;
}

/**
 * Improve a transcript by cleaning up spoken language into clear prose.
 *
 * @param rawTranscript - The raw transcribed text to improve
 * @param accessToken - Supabase auth token
 * @returns The improved text, or error if failed
 */
export async function improveTranscript(
  rawTranscript: string,
  accessToken?: string
): Promise<EngineerResult> {
  if (!rawTranscript || rawTranscript.trim().length === 0) {
    return {
      success: false,
      error: 'No transcript provided to improve.',
    };
  }

  if (!supabaseUrl) {
    return {
      success: false,
      error: 'Service not configured. Please sign in.',
    };
  }

  if (!accessToken) {
    return {
      success: false,
      error: 'Not signed in. Please sign in to use this feature.',
    };
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/improve-text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ text: rawTranscript }),
    });

    if (response.status === 429) {
      // Quota exceeded
      const data = await response.json() as { showMessage?: boolean };
      return {
        success: false,
        error: 'Text improvement quota exceeded for this month.',
        quotaExceeded: true,
        showQuotaMessage: data.showMessage === true,
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      log.error('Edge function error:', response.status, errorText);
      return {
        success: false,
        error: `Server error: ${response.status}`,
      };
    }

    const data = await response.json() as {
      improvedText?: string;
      inputTokens?: number;
      outputTokens?: number;
      wordCount?: number;
    };

    if (!data.improvedText) {
      return {
        success: false,
        error: 'No content in response.',
      };
    }

    return {
      success: true,
      refinedPrompt: data.improvedText.trim(),
      usage: data.inputTokens && data.outputTokens ? {
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
      } : undefined,
      wordCount: data.wordCount,
    };

  } catch (error) {
    return {
      success: false,
      error: 'Network unavailable.',
    };
  }
}
