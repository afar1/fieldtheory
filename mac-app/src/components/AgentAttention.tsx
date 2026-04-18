import { useEffect, useState } from 'react';
import {
  AGENT_GLYPHS,
  AGENT_PULSE_DURATION_MS,
  AGENT_PULSE_MIN_OPACITY,
  type AgentTool,
} from '../assets/agentSpinners';

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
      cursor: pointer;
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

  if (agents.length === 0) return null;

  const visible = agents.slice(0, MAX_VISIBLE);
  const overflow = agents.length - visible.length;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 4px',
      }}
    >
      {visible.map(agent => {
        const config = AGENT_GLYPHS[agent.tool];
        return (
          <span
            key={agent.agentId}
            className="agent-attention-glyph"
            onClick={() => (window as any).dynamicIslandAPI?.focusAgent?.(agent.agentId)}
            title={`${agent.tool} waiting in ${agent.terminalApp} — ${agent.ttyTitle || agent.cwd}`}
            style={{
              color: config.color,
              fontSize: config.fontSize,
            }}
          >
            {config.glyph}
          </span>
        );
      })}
      {overflow > 0 && (
        <span
          style={{
            color: '#10b981',
            fontSize: 10,
            fontWeight: 500,
            opacity: 0.85,
          }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
