import { Todo, Observation } from '../types';
import { supabase } from './supabase';

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
 * Process a transcription through the server function to extract todos and observations.
 * Returns a diff of operations to apply to the current state.
 */
export async function processTranscription(
  transcript: string,
  currentTodos: Todo[],
  currentObservations: Observation[]
): Promise<LLMDiff> {
  try {
    const { data, error } = await supabase.functions.invoke<LLMDiff>('process-transcription', {
      body: {
        transcript,
        currentTodos,
        currentObservations,
      },
    });

    if (error) {
      throw error;
    }

    if (!data?.todos || !data.observations) {
      throw new Error('Invalid response format from process-transcription function');
    }

    return data;
  } catch (error) {
    console.error('Failed to process transcription with LLM:', error);
    throw error;
  }
}
