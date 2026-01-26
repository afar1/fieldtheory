/**
 * Transcript Improvement Service
 *
 * Cleans up spoken transcripts into clear, concise prose using
 * the cloud Edge Function or a local LLM.
 */

import { LocalLLMManager } from './localLLMManager';

// Supabase URL for Edge Functions (set from environment)
let supabaseUrl: string | null = null;

// Local LLM settings
let localLLMManager: LocalLLMManager | null = null;
let useLocalLLM: boolean = false;

/**
 * Set the Supabase URL for Edge Function calls.
 */
export function setSupabaseUrl(url: string): void {
  supabaseUrl = url;
  console.log('[PromptEngineer] Supabase URL configured');
}

/**
 * Set the local LLM manager instance.
 */
export function setLocalLLMManager(manager: LocalLLMManager): void {
  localLLMManager = manager;
}

/**
 * Set whether to use local LLM for transcript improvement.
 */
export function setUseLocalLLM(useLocal: boolean): void {
  useLocalLLM = useLocal;
  console.log('[PromptEngineer] Use local LLM:', useLocal);
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
 * Prompt for local LLM transcript improvement.
 */
const LOCAL_LLM_TRANSCRIPT_PROMPT = `Rewrite this spoken feedback as clear prose. Same meaning with less ambiguity. If a portion of the transcript's intent is not obvious, don't attempt to rephrase that portion just include the full sentence. Questions from a user are crtically important and should always be presented as questions. If the transcript contains a question mark, always maintain the same meaning but feel free to rephrase to be more clear and concise. If intent of question is not obvious, include the full original question. Replace vague references with specific names. Remove filler words. Keep it as one paragraph. Do not add structure, bullets, or headers.

IMPORTANT: Preserve any [Figure X] references and [cmd:name.md] references exactly as written. These reference images and commands that must remain in the output in their original positions relative to the surrounding text.`;

/**
 * Strip common LLM preambles and postambles from output.
 * Small models often add "Here is..." or explanatory text despite instructions.
 */
function cleanLocalLLMOutput(output: string): string {
  let cleaned = output.trim();

  // Remove common preambles (case-insensitive)
  const preambles = [
    /^here(?:'s| is) (?:the )?(?:cleaned|improved|corrected|rewritten|revised).*?[:.\n]/i,
    /^(?:the )?(?:cleaned|improved|corrected|rewritten|revised).*?[:.\n]/i,
    /^sure[,!.]?\s*/i,
    /^okay[,!.]?\s*/i,
    /^certainly[,!.]?\s*/i,
  ];

  for (const pattern of preambles) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Remove quotes if the whole response is quoted
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }

  return cleaned.trim();
}

/**
 * Try to improve transcript using local LLM.
 * Returns null if local LLM is not available.
 */
async function tryLocalLLM(rawTranscript: string): Promise<EngineerResult | null> {
  if (!localLLMManager) {
    return null;
  }

  // Check if model is downloaded
  const isAvailable = await localLLMManager.isModelAvailableForSize(localLLMManager.getSelectedModel());
  if (!isAvailable) {
    return null;
  }

  console.log('[PromptEngineer] Using local LLM for transcript improvement');

  // For local models, use generous output limit since user isn't paying per token.
  // The real constraint is the context window (16K tokens configured in localLLMManager).
  // Transcript cleanup typically produces similar or shorter output than input.
  const maxOutputTokens = 8192;

  // Use simpler prompt for local models
  const result = await localLLMManager.generateResponse(
    LOCAL_LLM_TRANSCRIPT_PROMPT,
    `Transcript to improve:\n\n${rawTranscript.trim()}`,
    maxOutputTokens
  );

  if (result.success && result.response) {
    const cleaned = cleanLocalLLMOutput(result.response);
    return {
      success: true,
      refinedPrompt: cleaned,
    };
  }

  console.error('[PromptEngineer] Local LLM failed:', result.error);
  return {
    success: false,
    error: result.error || 'Local LLM failed',
  };
}

/**
 * Improve a transcript by cleaning up spoken language into clear prose.
 *
 * Mode selection:
 * - If useLocalLLM is true: use local model
 * - If useLocalLLM is false (cloud mode): use Edge Function
 *
 * @param rawTranscript - The raw transcribed text to improve
 * @param accessToken - Supabase auth token for cloud mode
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

  // If local LLM mode is explicitly enabled, use it
  if (useLocalLLM) {
    const localResult = await tryLocalLLM(rawTranscript);
    if (localResult) {
      return localResult;
    }
    // Local LLM was selected but isn't available
    return {
      success: false,
      error: 'Local model not available. Download a model in Settings.',
    };
  }

  // Cloud mode - use Edge Function
  if (!supabaseUrl) {
    // Try local as fallback
    const localResult = await tryLocalLLM(rawTranscript);
    if (localResult) {
      console.log('[PromptEngineer] No Supabase URL, using local LLM fallback');
      return localResult;
    }
    return {
      success: false,
      error: 'Service not configured. Please sign in or use local model.',
    };
  }

  if (!accessToken) {
    // Try local as fallback
    const localResult = await tryLocalLLM(rawTranscript);
    if (localResult) {
      console.log('[PromptEngineer] No auth token, using local LLM fallback');
      return localResult;
    }
    return {
      success: false,
      error: 'Not signed in. Please sign in or use local model.',
    };
  }

  try {
    console.log('[PromptEngineer] Calling Edge Function:', `${supabaseUrl}/functions/v1/improve-text`);
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
      console.log('[PromptEngineer] Quota exceeded:', data);
      return {
        success: false,
        error: 'Text improvement quota exceeded for this month.',
        quotaExceeded: true,
        showQuotaMessage: data.showMessage === true,
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[PromptEngineer] Edge function error:', response.status, errorText);

      // Try local fallback on server error
      const localResult = await tryLocalLLM(rawTranscript);
      if (localResult) {
        console.log('[PromptEngineer] Server error, using local LLM fallback');
        return localResult;
      }

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

    console.log('[PromptEngineer] Edge Function success, tokens:', data.inputTokens, '/', data.outputTokens);

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
    // Network error - try local LLM as fallback
    console.error('[PromptEngineer] Network error, checking for local fallback:', error);

    const localResult = await tryLocalLLM(rawTranscript);
    if (localResult) {
      console.log('[PromptEngineer] Network unavailable, using local LLM fallback');
      return localResult;
    }

    return {
      success: false,
      error: 'Network unavailable and no local model available.',
    };
  }
}
