// =============================================================================
// Pure width math for Dynamic Island pills. Both LeftPill and RightPill call
// these to report their slot-sum up to UnifiedIsland; UnifiedIsland takes the
// max and feeds it back as the section width for both sides (symmetric growth).
//
// All widths are in px. The constants here must stay in sync with the slot
// width/margin values used inside the PillSlot and AgentAttention components.
// =============================================================================

const PILL_PADDING = 18; // 10 + 8
const SLOT_WIDTH = 22;
const SLOT_GAP = 8;
const AGENT_SLOT_WIDTH = 22;
const AGENT_SLOT_GAP = 6;
const AGENT_OVERFLOW_WIDTH = 24;
const AGENT_OVERFLOW_GAP = 6;
const AGENT_MAX_VISIBLE = 3;
const WAVEFORM_WIDTH = 80;
const WAVEFORM_GAP = 8;

export interface LeftPillSlotInputs {
  xExpanded: boolean;
  agentCount: number;
  hamburgerExpanded: boolean;
}

export function computeLeftPillWidth({
  xExpanded,
  agentCount,
  hamburgerExpanded,
}: LeftPillSlotInputs): number {
  const visibleAgents = Math.min(agentCount, AGENT_MAX_VISIBLE);
  const hasOverflow = agentCount > AGENT_MAX_VISIBLE;
  return (
    PILL_PADDING
    + (xExpanded ? SLOT_WIDTH + SLOT_GAP : 0)
    + visibleAgents * (AGENT_SLOT_WIDTH + AGENT_SLOT_GAP)
    + (hasOverflow ? AGENT_OVERFLOW_WIDTH + AGENT_OVERFLOW_GAP : 0)
    + (hamburgerExpanded ? SLOT_WIDTH : 0)
  );
}

export interface RightPillSlotInputs {
  waveformActive: boolean;
  pipeCount: number;
}

export function computeRightPillWidth({
  waveformActive,
  pipeCount,
}: RightPillSlotInputs): number {
  const pipeSlot = pipeSlotWidthForCount(pipeCount);
  return (
    PILL_PADDING
    + (waveformActive ? WAVEFORM_WIDTH + WAVEFORM_GAP : 0)
    + (pipeCount > 0 ? pipeSlot : 0)
  );
}

export function pipeSlotWidthForCount(pipeCount: number): number {
  if (pipeCount >= 10) return 38;
  if (pipeCount > 3) return 32;
  return 22;
}
