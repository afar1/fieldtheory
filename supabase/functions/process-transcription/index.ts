// =============================================================================
// Transcription Processing Edge Function
// Turns a transcript into todo/observation diffs without exposing provider keys
// in the mobile bundle.
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

type Todo = {
  id: string;
  text: string;
  completed: boolean;
};

type Observation = {
  id: string;
  text: string;
};

type LLMDiff = {
  todos: {
    create: Array<{ text: string }>;
    update: Array<{ id: string; text?: string; completed?: boolean }>;
    delete: string[];
  };
  observations: {
    create: Array<{ text: string }>;
  };
};

const SYSTEM_PROMPT = `You are a helpful assistant that processes voice transcriptions into structured todos and observations.

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

const emptyDiff = (): LLMDiff => ({
  todos: { create: [], update: [], delete: [] },
  observations: { create: [] },
});

const coerceDiff = (value: LLMDiff): LLMDiff => ({
  todos: {
    create: Array.isArray(value?.todos?.create) ? value.todos.create : [],
    update: Array.isArray(value?.todos?.update) ? value.todos.update : [],
    delete: Array.isArray(value?.todos?.delete) ? value.todos.delete : [],
  },
  observations: {
    create: Array.isArray(value?.observations?.create) ? value.observations.create : [],
  },
});

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    console.error('[process-transcription] Auth error:', authError);
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let transcript = '';
  let currentTodos: Todo[] = [];
  let currentObservations: Observation[] = [];

  try {
    const body = await req.json();
    transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
    currentTodos = Array.isArray(body.currentTodos) ? body.currentTodos : [];
    currentObservations = Array.isArray(body.currentObservations) ? body.currentObservations : [];
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!transcript) {
    return new Response(JSON.stringify(emptyDiff()), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!ANTHROPIC_API_KEY) {
    console.error('[process-transcription] ANTHROPIC_API_KEY not configured');
    return new Response(JSON.stringify({ error: 'Service not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userMessage = `Transcription: "${transcript}"

Current Todos:
${currentTodos.length === 0 ? 'None' : currentTodos.map((t) => `- [${t.completed ? 'x' : ' '}] ${t.text} (id: ${t.id})`).join('\n')}

Current Observations:
${currentObservations.length === 0 ? 'None' : currentObservations.map((o) => `- ${o.text} (id: ${o.id})`).join('\n')}

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
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[process-transcription] Anthropic error:', response.status, errorText);
      return new Response(JSON.stringify({ error: 'API error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await response.json();
    const content = result.content?.[0]?.text ?? '';
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
    const diff = coerceDiff(JSON.parse(jsonText));

    return new Response(JSON.stringify(diff), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[process-transcription] Network or parse error:', error);
    return new Response(JSON.stringify({ error: 'Network error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
