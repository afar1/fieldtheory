/**
 * Prompt Engineer Service
 * 
 * Takes raw text (prompts, transcripts, notes) and refines them into
 * well-structured, actionable prompts using the Anthropic API.
 * 
 * Users can customize the system prompt via Settings to control how
 * their transcriptions are refined.
 */

import fs from 'fs';
import path from 'path';
import { LocalLLMManager } from './localLLMManager';

// API key is provided at runtime from preferences or environment.
let anthropicApiKey: string | null = null;

// Custom system prompt (set from preferences at runtime).
// If null, use the default system prompt from file.
let customSystemPrompt: string | null = null;

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
 * Set a custom system prompt to use instead of the default.
 * Pass null to reset to the default prompt.
 */
export function setCustomSystemPrompt(prompt: string | null): void {
  customSystemPrompt = prompt;
  console.log('[PromptEngineer] Custom system prompt', prompt ? 'set' : 'cleared');
}

/**
 * Get the currently active system prompt.
 * Returns custom prompt if set, otherwise loads the default.
 */
export function getActiveSystemPrompt(): string {
  return customSystemPrompt || loadDefaultSystemPrompt();
}

/**
 * Load the default system prompt from the markdown file.
 * Reads from file at runtime to allow easy updates.
 */
export function loadDefaultSystemPrompt(): string {
  try {
    // In development, read from source. In production, read from resources.
    const devPath = path.join(__dirname, 'prompts', 'engineer-system-prompt.md');
    const prodPath = path.join(process.resourcesPath || '', 'prompts', 'engineer-system-prompt.md');
    
    // Try dev path first, fall back to prod path
    const promptPath = fs.existsSync(devPath) ? devPath : prodPath;
    
    if (fs.existsSync(promptPath)) {
      return fs.readFileSync(promptPath, 'utf-8');
    }
  } catch (error) {
    console.error('[PromptEngineer] Failed to load system prompt from file:', error);
  }
  
  // Fallback to embedded prompt if file not found
  return getDefaultSystemPrompt();
}

/**
 * Load the system prompt - uses custom if set, otherwise default from file.
 */
function loadSystemPrompt(): string {
  return getActiveSystemPrompt();
}

/**
 * Default system prompt embedded as fallback.
 */
function getDefaultSystemPrompt(): string {
  return `# Prompt Engineer System Prompt

You are a prompt refinement specialist. Your task is to take raw user input—which may be messy, stream-of-consciousness, or incomplete—and transform it into a clear, well-structured prompt that will elicit high-quality responses from a large language model.

## Your Process

1. **Parse** the raw input to understand the user's core intent
2. **Identify** implicit goals, constraints, and context clues
3. **Restructure** into a clean, actionable prompt
4. **Preserve** all meaning—never invent information the user didn't provide

## Output Format

Always produce these sections in this exact order:

### Goal
One sentence stating the primary objective.

### Context
Relevant background information extracted from the input. If minimal context was provided, state what's known.

### Task
A clear, step-by-step description of what needs to be done.

### Constraints
Any limitations, requirements, or boundaries the user specified or implied.

### Output Format
How the response should be structured (e.g., code, prose, list, JSON).

### Clarifying Questions (Optional)
If critical information is genuinely missing and cannot be reasonably inferred, list 2-3 specific questions. Skip this section if the prompt is already actionable.

## Rules

- **Never hallucinate**: Do not add information that wasn't in the original input
- **Preserve ambiguity**: If the user was intentionally vague about something, keep it vague
- **Be concise**: Remove filler words and redundancy, but keep all substantive content
- **Maintain voice**: If the user used specific technical terms or phrasing, preserve them
- **Assume competence**: Don't over-explain unless the input suggests the user needs guidance
- **Handle multimedia references**: If the input mentions images, screenshots, or attachments, include placeholders noting their presence
- **No commentary**: Output only the refined prompt, not explanations about your process`;
}

/**
 * Result from the engineer prompt operation.
 */
export interface EngineerResult {
  success: boolean;
  refinedPrompt?: string;
  error?: string;
}

/**
 * Engineer a prompt by sending it to Anthropic's API with the system prompt.
 * Uses Claude Sonnet 4.5 for prompt refinement.
 * 
 * @param rawInput - The raw text to refine (can be messy transcripts, notes, etc.)
 * @returns The refined, structured prompt
 */
export async function engineerPrompt(rawInput: string): Promise<EngineerResult> {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    return {
      success: false,
      error: 'Anthropic API key not configured. Please set it in Settings.',
    };
  }

  if (!rawInput || rawInput.trim().length === 0) {
    return {
      success: false,
      error: 'No input provided to engineer.',
    };
  }

  const systemPrompt = loadSystemPrompt();

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        // Use Sonnet 4.5 for fast, high-quality prompt refinement
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Please refine the following raw input into a well-structured prompt:\n\n---\n\n${rawInput}\n\n---\n\nOutput only the refined prompt with the specified sections.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[PromptEngineer] API error:', response.status, errorText);
      return {
        success: false,
        error: `API error: ${response.status} - ${errorText}`,
      };
    }

    const data = await response.json() as { content?: Array<{ text?: string }> };
    const content = data.content?.[0]?.text;

    if (!content) {
      return {
        success: false,
        error: 'No content in API response.',
      };
    }

    return {
      success: true,
      refinedPrompt: content,
    };
  } catch (error) {
    console.error('[PromptEngineer] Request failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Engineer a stack of items (text and image descriptions) into a refined prompt.
 * Combines all content from the stack and sends it to be refined.
 * 
 * @param items - Array of items with content and type info
 * @returns The refined prompt combining all stack content
 */
export async function engineerStack(
  items: Array<{ content: string | null; type: string; imageWidth?: number; imageHeight?: number }>
): Promise<EngineerResult> {
  // Combine all content from the stack into a single input
  const combinedParts: string[] = [];

  for (const item of items) {
    if (item.type === 'text' || item.type === 'transcript') {
      if (item.content) {
        combinedParts.push(item.content);
      }
    } else if (item.type === 'image' || item.type === 'screenshot') {
      // For images, include the description if available, otherwise note the image exists
      if (item.content) {
        combinedParts.push(`[Image description: ${item.content}]`);
      } else {
        const dimensions = item.imageWidth && item.imageHeight 
          ? ` (${item.imageWidth}×${item.imageHeight})`
          : '';
        combinedParts.push(`[Screenshot/Image attached${dimensions}]`);
      }
    }
  }

  if (combinedParts.length === 0) {
    return {
      success: false,
      error: 'No content found in stack to engineer.',
    };
  }

  const combinedInput = combinedParts.join('\n\n');
  return engineerPrompt(combinedInput);
}

/**
 * Hardcoded system prompt for transcript improvement (API/large models).
 * Not user-modifiable to ensure consistent quality.
 */
const IMPROVE_TRANSCRIPT_PROMPT = `Rewrite this spoken feedback as clear prose. Same meaning, fewer words, no ambiguity. Replace vague references with specific names. Remove filler words. Keep it as one paragraph. Do not add structure, bullets, or headers.

IMPORTANT: Preserve any [Figure X] references exactly as written. These reference images and must remain in the output in their original positions relative to the surrounding text.`;

/**
 * Simpler prompt for local LLM (1B/3B models need explicit, simple instructions).
 * Critical: Must emphasize returning ONLY the text, no explanations.
 */
const LOCAL_LLM_TRANSCRIPT_PROMPT = `You are a transcript cleaner. Clean up the text below. Remove filler words like "um", "uh", "like", "you know". Fix grammar. Keep the same meaning. Output ONLY the cleaned text. Do not explain. Do not add commentary. Do not say "Here is" or similar.`;

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

  // Use simpler prompt for local models
  const result = await localLLMManager.generateResponse(
    LOCAL_LLM_TRANSCRIPT_PROMPT,
    rawTranscript.trim(),
    512  // Shorter max tokens - transcript cleanup shouldn't need much
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
        // Use Haiku for fast, cheap transcript improvement
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
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

    const data = await response.json() as { content?: Array<{ text?: string }> };
    const content = data.content?.[0]?.text;

    if (!content) {
      return {
        success: false,
        error: 'No content in API response.',
      };
    }

    return {
      success: true,
      refinedPrompt: content.trim(),
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
