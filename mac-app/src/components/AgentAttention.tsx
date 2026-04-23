import { useEffect, useState } from 'react';
import {
  AGENT_GLYPHS,
  AGENT_PULSE_DURATION_MS,
  AGENT_PULSE_MIN_OPACITY,
} from '../assets/agentSpinners';
import { PillSlot } from './PillSlot';

// =============================================================================
// AgentAttention — one green breathing star whenever any Claude or Codex
// session is waiting on the user.
//
// The main process still polls window positions and computes a 1x4 / 2x2
// spatial layout (see agentLayout.ts + agentAttentionManager.ts). That
// plumbing is intentionally kept in place; this component just doesn't render
// it yet. To light it up, subscribe to window.dynamicIslandAPI.onAgentLayout
// here and branch the render by layout.kind.
// =============================================================================

interface WaitingAgent {
  agentId: string;
  tool: 'claude' | 'codex';
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

const SLOT_WIDTH = 22;
const SLOT_GAP = 6;

interface AgentAttentionProps {
  onCountChanged?: (count: number) => void;
  onSlotSumChange?: (sum: number) => void;
}

export function AgentAttention({ onCountChanged, onSlotSumChange }: AgentAttentionProps = {}) {
  const [agents, setAgents] = useState<WaitingAgent[]>([]);

  useEffect(() => {
    const api = (window as any).dynamicIslandAPI;
    api?.onAgentsChange?.((next: WaitingAgent[]) => setAgents(next));
  }, []);

  useEffect(() => {
    onCountChanged?.(agents.length);
  }, [agents.length, onCountChanged]);

  const visible = agents.length > 0;
  useEffect(() => {
    onSlotSumChange?.(visible ? SLOT_WIDTH + SLOT_GAP : 0);
  }, [visible, onSlotSumChange]);

  const primary = agents[0];
  const glyph = AGENT_GLYPHS.claude; // claude's ✶ is the canonical star shape

  return (
    <PillSlot
      visible={visible}
      width={SLOT_WIDTH}
      marginRight={SLOT_GAP}
      onClick={
        primary
          ? () => (window as any).dynamicIslandAPI?.focusAgent?.(primary.agentId)
          : undefined
      }
      title={agentsTitle(agents)}
    >
      <span
        className="agent-attention-glyph"
        style={{ color: glyph.color, fontSize: glyph.fontSize }}
      >
        {glyph.glyph}
      </span>
    </PillSlot>
  );
}

function agentsTitle(agents: WaitingAgent[]): string | undefined {
  if (agents.length === 0) return undefined;
  if (agents.length === 1) {
    const a = agents[0];
    return `${a.tool} waiting in ${a.terminalApp} — ${a.ttyTitle || a.cwd}`;
  }
  return `${agents.length} agents waiting`;
}
