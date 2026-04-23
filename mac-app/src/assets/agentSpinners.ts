export type AgentTool = 'claude' | 'codex';

export interface AgentGlyph {
  glyph: string;
  color: string;
  fontSize: number;
}

export const AGENT_GLYPHS: Record<AgentTool, AgentGlyph> = {
  claude: { glyph: '\u2736', color: '#10b981', fontSize: 14 },
  codex: { glyph: '\u28e7', color: '#10b981', fontSize: 14 },
};

export const AGENT_PULSE_DURATION_MS = 1600;
export const AGENT_PULSE_MIN_OPACITY = 0.6;
