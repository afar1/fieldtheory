import { Todo, Observation } from '../types';

// Get API key from environment variable (loaded via babel-plugin-inline-dotenv)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

interface LLMDiff {
  todos: {
    create: Array<{ text: string }>;
    update: Array<{ id: string; text?: string; completed?: boolean }>;
    delete: string[]; // Array of todo IDs to delete
  };
  observations: {
    create: Array<{ text: string }>;
  };
}

/**
 * Process a transcription with Anthropic's API to extract todos and observations.
 * Returns a diff of operations to apply to the current state.
 */
export async function processTranscription(
  transcript: string,
  currentTodos: Todo[],
  currentObservations: Observation[]
): Promise<LLMDiff> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured. Please set it in .env file.');
  }

  const systemPrompt = `You are a helpful assistant that processes voice transcriptions into structured todos and observations.

Given a transcription and the current state of todos and observations, return a JSON diff with operations to update the state.

Rules:
- Only create todos/observations that are explicitly mentioned in the transcription
- For todos: if the user mentions completing a task, update the existing todo by ID (match by text similarity)
- For todos: if the user mentions deleting or removing a task, add its ID to the delete array
- For todos: if the user mentions updating a task, update it by ID
- Keep todo text concise (one line)
- Observations are facts or notes, not actionable items
- Only create new items if they're clearly stated in the transcription
- If nothing relevant is found, return empty arrays

Return JSON in this exact format:
{
  "todos": {
    "create": [{"text": "string"}],
    "update": [{"id": "string", "text": "string", "completed": boolean}],
    "delete": ["id1", "id2"]
  },
  "observations": {
    "create": [{"text": "string"}]
  }
}`;

  const userMessage = `Transcription: "${transcript}"

Current Todos:
${currentTodos.length === 0 ? 'None' : currentTodos.map(t => `- [${t.completed ? 'x' : ' '}] ${t.text} (id: ${t.id})`).join('\n')}

Current Observations:
${currentObservations.length === 0 ? 'None' : currentObservations.map(o => `- ${o.text} (id: ${o.id})`).join('\n')}

Return the JSON diff with operations to apply.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userMessage,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const content = data.content[0].text;

    // Parse JSON from the response
    // Claude may wrap JSON in markdown code blocks, so we extract it
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
    const diff: LLMDiff = JSON.parse(jsonText);

    // Validate structure
    if (!diff.todos || !diff.observations) {
      throw new Error('Invalid response format from LLM');
    }

    return diff;
  } catch (error) {
    console.error('Failed to process transcription with LLM:', error);
    throw error;
  }
}

