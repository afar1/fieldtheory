import type { WaitingAgent } from './types/agentAttention';
import type { NativeWindowInfo } from './types/audio';

// =============================================================================
// Pure layout math for waiting-agent dots in the Dynamic Island.
// Decides between a 1x4 row (windows at similar y) and a 2x2 grid (windows
// spread vertically), clusters co-located agents into ×N dots, and buckets
// anything we couldn't place into +N unmatched.
//
// No I/O here — caller supplies the window list (from nativeHelper) and
// display bounds (from electron.screen). Keeps the module unit-testable.
// =============================================================================

export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

type AgentLayoutKind = 'row' | 'grid';

export interface AgentLayoutSlot {
  // row: 0..3 left-to-right. grid: 0=TL, 1=TR, 2=BL, 3=BR.
  position: number;
  agentIds: string[];
}

export interface AgentLayout {
  kind: AgentLayoutKind;
  slots: AgentLayoutSlot[];
  // Agents we couldn't match to a window OR that overflowed past the 4 slots.
  unmatched: string[];
}

const MAX_SLOTS = 4;

// Below this vertical spread (as a fraction of screen height), treat windows
// as "all in the same row" and lay out 1x4 horizontally. Above it, switch to
// the 2x2 quadrant grid.
const VERTICAL_SPREAD_THRESHOLD = 0.3;

// Windows with center-x closer than this (as fraction of screen width) get
// merged into the same row slot. Keeps the row layout readable when windows
// are near each other.
const ROW_CLUSTER_THRESHOLD = 0.12;

// Map the agent's declared terminalApp (from the hook) to plausible
// CGWindowList ownerName values. Most are 1:1, but Warp and VS Code variants
// differ.
const TERMINAL_APP_OWNER_NAMES: Record<string, string[]> = {
  iTerm2: ['iTerm2', 'iTerm'],
  iTerm: ['iTerm2', 'iTerm'],
  Terminal: ['Terminal'],
  Ghostty: ['Ghostty'],
  Warp: ['Warp', 'WarpTerminal'],
  Code: ['Code', 'Visual Studio Code'],
  Cursor: ['Cursor'],
};

interface Positioned {
  agentId: string;
  // Center of the window in [0,1] relative to its display.
  fx: number;
  fy: number;
}

export function computeAgentLayout(
  agents: WaitingAgent[],
  windows: NativeWindowInfo[],
  displays: DisplayBounds[]
): AgentLayout {
  const positioned: Positioned[] = [];
  const unmatched: string[] = [];

  for (const agent of agents) {
    const win = matchAgentToWindow(agent, windows);
    if (!win) {
      unmatched.push(agent.agentId);
      continue;
    }
    const frac = windowCenterFraction(win, displays);
    if (!frac) {
      unmatched.push(agent.agentId);
      continue;
    }
    positioned.push({ agentId: agent.agentId, fx: frac.x, fy: frac.y });
  }

  if (positioned.length === 0) {
    return { kind: 'row', slots: [], unmatched };
  }

  const kind = decideLayoutKind(positioned);
  const { slots, overflow } =
    kind === 'row' ? assignRowSlots(positioned) : assignGridSlots(positioned);

  return { kind, slots, unmatched: [...unmatched, ...overflow] };
}

// ---------------------------------------------------------------------------
// Matching: agent → window
// ---------------------------------------------------------------------------

export function matchAgentToWindow(
  agent: WaitingAgent,
  windows: NativeWindowInfo[]
): NativeWindowInfo | null {
  const ownerCandidates =
    TERMINAL_APP_OWNER_NAMES[agent.terminalApp] ?? [agent.terminalApp];

  // Filter to the right app first. If ownerName isn't populated, fall back to
  // any window (rare — mostly happens when the helper runs without proper
  // perms and titles/owners come back empty).
  const appWindows = windows.filter(w =>
    ownerCandidates.some(c => w.ownerName.toLowerCase() === c.toLowerCase())
  );
  if (appWindows.length === 0) return null;

  // Score by how many cwd tokens appear in the window title. Tokens are the
  // path segments of the agent's cwd — `/Users/afar/dev/fieldtheory/mac-app`
  // gives tokens ['afar', 'dev', 'fieldtheory', 'mac-app']. The last token
  // (immediate directory) is the one shells most reliably expose in titles,
  // so we weight it double.
  const cwdTokens = tokensFromCwd(agent.cwd);
  if (cwdTokens.length === 0) {
    // No tokens to match — pick the first app window as a best effort.
    return appWindows[0];
  }

  const last = cwdTokens[cwdTokens.length - 1].toLowerCase();

  let bestWin: NativeWindowInfo | null = null;
  let bestScore = 0;
  for (const w of appWindows) {
    const title = w.title.toLowerCase();
    let score = 0;
    for (const t of cwdTokens) {
      if (title.includes(t.toLowerCase())) score += 1;
    }
    if (title.includes(last)) score += 1; // double-weight immediate dir
    if (score > bestScore) {
      bestScore = score;
      bestWin = w;
    }
  }

  // Require at least a one-token match; otherwise we're guessing.
  return bestScore > 0 ? bestWin : null;
}

function tokensFromCwd(cwd: string): string[] {
  return cwd.split('/').filter(p => p.length > 0);
}

// ---------------------------------------------------------------------------
// Positioning: window bounds → [0,1] in its display
// ---------------------------------------------------------------------------

export function windowCenterFraction(
  w: NativeWindowInfo,
  displays: DisplayBounds[]
): { x: number; y: number } | null {
  if (w.width <= 0 || w.height <= 0) return null;
  const cx = w.x + w.width / 2;
  const cy = w.y + w.height / 2;

  // Pick the display that actually contains the window center. If none match
  // (e.g., off-screen after a display change), fall back to the first display
  // so the dot still renders somewhere sensible rather than vanishing.
  const display =
    displays.find(
      d =>
        cx >= d.x && cx <= d.x + d.width && cy >= d.y && cy <= d.y + d.height
    ) ?? displays[0];
  if (!display || display.width <= 0 || display.height <= 0) return null;

  const fx = clamp01((cx - display.x) / display.width);
  const fy = clamp01((cy - display.y) / display.height);
  return { x: fx, y: fy };
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// ---------------------------------------------------------------------------
// Layout decision: row vs grid
// ---------------------------------------------------------------------------

function decideLayoutKind(positioned: Positioned[]): AgentLayoutKind {
  if (positioned.length <= 1) return 'row';
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of positioned) {
    if (p.fy < minY) minY = p.fy;
    if (p.fy > maxY) maxY = p.fy;
  }
  return maxY - minY < VERTICAL_SPREAD_THRESHOLD ? 'row' : 'grid';
}

// ---------------------------------------------------------------------------
// Row layout: cluster by x, cap at 4, overflow → unmatched
// ---------------------------------------------------------------------------

function assignRowSlots(positioned: Positioned[]): {
  slots: AgentLayoutSlot[];
  overflow: string[];
} {
  // Greedy 1D clustering: sort by x, merge neighbors within threshold.
  const sorted = [...positioned].sort((a, b) => a.fx - b.fx);
  const clusters: Positioned[][] = [];
  for (const p of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && p.fx - meanFx(last) < ROW_CLUSTER_THRESHOLD) {
      last.push(p);
    } else {
      clusters.push([p]);
    }
  }

  // If we have more than MAX_SLOTS clusters, keep the MAX_SLOTS by leftmost
  // x-position and push everything else into overflow. Preserves spatial
  // correctness ("where are the 4 groups") over recency.
  const visible = clusters.slice(0, MAX_SLOTS);
  const overflow = clusters.slice(MAX_SLOTS).flatMap(c => c.map(p => p.agentId));

  const slots: AgentLayoutSlot[] = visible.map((c, i) => ({
    position: i,
    agentIds: c.map(p => p.agentId),
  }));

  return { slots, overflow };
}

function meanFx(cluster: Positioned[]): number {
  let sum = 0;
  for (const p of cluster) sum += p.fx;
  return sum / cluster.length;
}

// ---------------------------------------------------------------------------
// Grid layout: 2x2 quadrants. No cluster-level overflow possible (only 4
// quadrants), but agents can pile up inside a single cell as ×N.
// ---------------------------------------------------------------------------

function assignGridSlots(positioned: Positioned[]): {
  slots: AgentLayoutSlot[];
  overflow: string[];
} {
  const buckets: string[][] = [[], [], [], []];
  for (const p of positioned) {
    const col = p.fx < 0.5 ? 0 : 1;
    const row = p.fy < 0.5 ? 0 : 1;
    const pos = row * 2 + col; // 0=TL, 1=TR, 2=BL, 3=BR
    buckets[pos].push(p.agentId);
  }

  const slots: AgentLayoutSlot[] = [];
  for (let i = 0; i < 4; i++) {
    if (buckets[i].length > 0) {
      slots.push({ position: i, agentIds: buckets[i] });
    }
  }
  return { slots, overflow: [] };
}
