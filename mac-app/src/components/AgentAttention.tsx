import { useEffect, useState } from 'react';
import {
  AGENT_GLYPHS,
  AGENT_PULSE_DURATION_MS,
  AGENT_PULSE_MIN_OPACITY,
  type AgentTool,
} from '../assets/agentSpinners';
import { PillSlot } from './PillSlot';

interface WaitingAgent {
  agentId: string;
  tool: AgentTool;
  pid: number;
  cwd: string;
  ttyTitle: string;
  terminalApp: string;
  waitingSince: number;
}

const KEYFRAMES_ID = 'agent-attention-keyframes';
if (typeof document !== 'undefined' && !document.getElementById(KEYFRAMES_ID)) {
  const sheet = document.createElement('style');
  sheet.id = KEYFRAMES_ID;
  sheet.textContent = `
    @keyframes agentPulse {
      0%, 100% { opacity: ${AGENT_PULSE_MIN_OPACITY}; }
      50% { opacity: 1; }
    }
    .agent-attention-glyph {
      animation: agentPulse ${AGENT_PULSE_DURATION_MS}ms ease-in-out infinite;
      user-select: none;
      line-height: 1;
      font-family: -apple-system, "Menlo", monospace;
      transition: transform 120ms ease;
    }
    .agent-attention-glyph:hover {
      transform: scale(1.15);
    }
  `;
  document.head.appendChild(sheet);
}

const MAX_VISIBLE = 3;
const GLYPH_SLOT_WIDTH = 22;
const OVERFLOW_SLOT_WIDTH = 24;

interface AgentAttentionProps {
  onCountChanged?: (count: number) => void;
}

export function AgentAttention({ onCountChanged }: AgentAttentionProps = {}) {
  const [agents, setAgents] = useState<WaitingAgent[]>([]);

  useEffect(() => {
    const api = (window as any).dynamicIslandAPI;
    api?.onAgentsChange?.((next: WaitingAgent[]) => setAgents(next));
  }, []);

  useEffect(() => {
    onCountChanged?.(agents.length);
  }, [agents.length, onCountChanged]);

  const slots: Array<WaitingAgent | null> = Array.from(
    { length: MAX_VISIBLE },
    (_, i) => agents[i] ?? null
  );
  const overflow = Math.max(0, agents.length - MAX_VISIBLE);

  return (
    <>
      {slots.map((agent, i) => {
        const config = agent ? AGENT_GLYPHS[agent.tool] : null;
        return (
          <PillSlot
            key={`agent-${i}`}
            visible={!!agent}
            width={GLYPH_SLOT_WIDTH}
            marginRight={6}
            onClick={
              agent
                ? () => (window as any).dynamicIslandAPI?.focusAgent?.(agent.agentId)
                : undefined
            }
            title={
              agent
                ? `${agent.tool} waiting in ${agent.terminalApp} — ${agent.ttyTitle || agent.cwd}`
                : undefined
            }
          >
            {config && (
              <span
                className="agent-attention-glyph"
                style={{ color: config.color, fontSize: config.fontSize }}
              >
                {config.glyph}
              </span>
            )}
          </PillSlot>
        );
      })}
      <PillSlot visible={overflow > 0} width={OVERFLOW_SLOT_WIDTH} marginRight={6}>
        {overflow > 0 && (
          <span style={{ color: '#10b981', fontSize: 10, fontWeight: 500 }}>
            +{overflow}
          </span>
        )}
      </PillSlot>
    </>
  );
}
