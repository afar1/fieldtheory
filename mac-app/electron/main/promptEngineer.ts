/**
 * Transcript Improvement Service
 *
 * Cleans up spoken transcripts into clear, concise prose using
 * either the Anthropic API or a local LLM.
 */

import { LocalLLMManager } from './localLLMManager';

// API key is provided at runtime from preferences or environment.
let anthropicApiKey: string | null = null;

// Local LLM settings
let localLLMManager: LocalLLMManager | null = null;
let useLocalLLM: boolean = false;

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
 * Set the Anthropic API key for the engineer service.
 */
export function setApiKey(key: string): void {
  anthropicApiKey = key;
}

/**
 * Get the API key, checking environment as fallback.
 */
function getApiKey(): string | null {
  return anthropicApiKey || process.env.ANTHROPIC_API_KEY || null;
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
}

/**
 * Hardcoded system prompt for transcript improvement (API/large models).
 * Not user-modifiable to ensure consistent quality.
 */
const IMPROVE_TRANSCRIPT_PROMPT = `Rewrite this spoken feedback as clear prose. Same meaning with less ambiguity. If a portion of the transcript's intent is not obvious, don't attempt to rephrase that portion just include the full sentence. Questions from a user are crtically important and should always be presented as questions. If the transcript contains a question mark, always maintain the same meaning but feel free to rephrase to be more clear and concise. If intent of question is not obvious, include the full original question. Replace vague references with specific names. Remove filler words. Keep it as one paragraph. Do not add structure, bullets, or headers.

IMPORTANT: Preserve any [Figure X] references and [cmd:name.md] references exactly as written. These reference images and commands that must remain in the output in their original positions relative to the surrounding text.`;

/**
 * Prompt for local LLM transcript improvement.
 * Identical to cloud prompt for consistency.
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
    rawTranscript.trim(),
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
 * Check if network is available by attempting a lightweight request.
 */
async function isNetworkAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch('https://api.anthropic.com/', {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return true;
  } catch (error) {
    console.log('[PromptEngineer] Network check failed:', error instanceof Error ? error.message : 'unknown');
    return false;
  }
}

/**
 * Improve a transcript by cleaning up spoken language into clear prose.
 * Uses a hardcoded prompt optimized for transcript improvement.
 *
 * Mode selection:
 * - If useLocalLLM is true: use local model
 * - If useLocalLLM is false (API mode): use API, but fall back to local if network unavailable
 *
 * @param rawTranscript - The raw transcribed text to improve
 * @returns The improved text, or error if failed
 */
export async function improveTranscript(rawTranscript: string): Promise<EngineerResult> {
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

  // API mode - try API first, fall back to local if network unavailable
  const apiKey = getApiKey();

  if (!apiKey) {
    // No API key - try local as fallback
    const localResult = await tryLocalLLM(rawTranscript);
    if (localResult) {
      console.log('[PromptEngineer] No API key, using local LLM fallback');
      return localResult;
    }
    return {
      success: false,
      error: 'No API key configured and no local model available.',
    };
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        // Use Sonnet for high-quality transcript improvement
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: IMPROVE_TRANSCRIPT_PROMPT,
        messages: [
          {
            role: 'user',
            content: rawTranscript.trim(),
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[PromptEngineer] improveTranscript API error:', response.status, errorText);
      return {
        success: false,
        error: `API error: ${response.status}`,
      };
    }

    const data = await response.json() as {
      content?: Array<{ text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const content = data.content?.[0]?.text;

    if (!content) {
      return {
        success: false,
        error: 'No content in API response.',
      };
    }

    // Calculate word count from input
    const wordCount = rawTranscript.trim().split(/\s+/).length;

    return {
      success: true,
      refinedPrompt: content.trim(),
      usage: data.usage ? {
        inputTokens: data.usage.input_tokens || 0,
        outputTokens: data.usage.output_tokens || 0,
      } : undefined,
      wordCount,
    };
  } catch (error) {
    // Network error - try local LLM as fallback
    console.error('[PromptEngineer] API request failed, checking for local fallback:', error);

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
