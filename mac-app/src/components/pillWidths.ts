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
const WAVEFORM_WIDTH = 80;
const WAVEFORM_GAP = 8;

export interface LeftPillSlotInputs {
  xExpanded: boolean;
  // Sum of the agent-attention region's rendered slot widths (including gaps).
  // The AgentAttention component reports this up because it varies with the
  // spatial layout mode (row vs grid) and the per-slot ×N badge state.
  agentsSlotSum: number;
  hamburgerExpanded: boolean;
}

export function computeLeftPillWidth({
  xExpanded,
  agentsSlotSum,
  hamburgerExpanded,
}: LeftPillSlotInputs): number {
  return (
    PILL_PADDING
    + (xExpanded ? SLOT_WIDTH + SLOT_GAP : 0)
    + agentsSlotSum
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
