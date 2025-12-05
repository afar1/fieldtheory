/**
 * Prompt Engineer Service
 * 
 * Takes raw text (prompts, transcripts, notes) and refines them into
 * well-structured, actionable prompts using the Anthropic API.
 */

import fs from 'fs';
import path from 'path';

// API key is provided at runtime from preferences or environment.
let anthropicApiKey: string | null = null;

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
 * Load the system prompt from the markdown file.
 * We read it at runtime so users could theoretically customize it.
 */
function loadSystemPrompt(): string {
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
 * Uses Claude claude-sonnet-4-20250514 for thinking capability.
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
        // Use Sonnet for fast, high-quality prompt refinement
        model: 'claude-sonnet-4-20250514',
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
