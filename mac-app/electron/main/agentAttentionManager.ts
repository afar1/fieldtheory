import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createLogger } from './logger';
import type { AgentTool, WaitingAgent } from './types/agentAttention';
import {
  computeAgentLayout,
  type AgentLayout,
  type DisplayBounds,
} from './agentLayout';
import type { NativeWindowInfo } from './types/audio';

const log = createLogger('AgentAttention');
const execAsync = promisify(exec);

// Provider interface for spatial layout inputs. Injected so the manager
// doesn't import electron or nativeHelper directly — keeps it testable and
// lets us skip window enumeration in headless/test contexts.
export interface AgentLayoutProvider {
  listWindows(): Promise<NativeWindowInfo[]>;
  listDisplays(): DisplayBounds[];
}

// =============================================================================
// AgentAttentionManager - Watches ~/.fieldtheory/agents/state/ for JSON
// snapshots written by Claude Code / Codex Stop hooks. Each file represents
// one agent session currently waiting on the user. The manager emits 'change'
// with a sorted list whenever the set changes, and exposes focus() to bring
// the associated terminal window to the foreground.
//
// When ≥2 agents are waiting AND a layout provider is attached, the manager
// also polls the native window list to compute a spatial 1x4 / 2x2 layout
// and emits it on the 'layout' event for the Dynamic Island to render.
// =============================================================================

export class AgentAttentionManager extends EventEmitter {
  private readonly stateDir: string;
  private waiting: Map<string, WaitingAgent> = new Map();
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly RESCAN_DEBOUNCE_MS = 80;
  // When set, real file-watcher updates are suppressed and getWaiting() returns
  // the synthetic list. Used by the dev hotkey (Ctrl+Alt+Shift+A) to stress-test
  // Dynamic Island pill sizing with N agents without needing live CLI sessions.
  private syntheticOverride: WaitingAgent[] | null = null;
  // Tracks per-tool visibility. Driven by AgentHookInstaller.getStatus() —
  // when a tool's hook is uninstalled, its agents are filtered out of the
  // emitted list so the Dynamic Island dots disappear immediately.
  private toolFilter: Record<AgentTool, boolean> = { claude: true, codex: true };
  // Spatial layout plumbing. Poll only runs while agents.length ≥ 2 so we
  // don't burn cycles when there's nothing to position.
  private layoutProvider: AgentLayoutProvider | null = null;
  private layoutPollTimer: NodeJS.Timeout | null = null;
  private lastLayoutKey: string | null = null;
  private readonly LAYOUT_POLL_INTERVAL_MS = 250;

  constructor(stateDir?: string) {
    super();
    this.stateDir =
      stateDir ?? path.join(os.homedir(), '.fieldtheory', 'agents', 'state');
  }

  start(): void {
    fs.mkdirSync(this.stateDir, { recursive: true });
    this.rescan();
    try {
      this.watcher = fs.watch(this.stateDir, () => this.scheduleRescan());
    } catch (err) {
      log.warn('fs.watch failed, falling back to polling:', err);
      this.pollTimer = setInterval(() => this.rescan(), 1000);
    }
  }

  getWaiting(): WaitingAgent[] {
    if (this.syntheticOverride !== null) return [...this.syntheticOverride];
    return Array.from(this.waiting.values())
      .filter(a => this.toolFilter[a.tool])
      .sort((a, b) => a.waitingSince - b.waitingSince);
  }

  setToolFilter(filter: Record<AgentTool, boolean>): void {
    const changed =
      this.toolFilter.claude !== filter.claude ||
      this.toolFilter.codex !== filter.codex;
    this.toolFilter = { ...filter };
    if (changed) {
      this.emit('change', this.getWaiting());
      this.reconcileLayoutPolling();
    }
  }

  setLayoutProvider(provider: AgentLayoutProvider | null): void {
    this.layoutProvider = provider;
    this.reconcileLayoutPolling();
  }

  // Starts polling when ≥2 agents are waiting, stops when fewer. Called from
  // every path that changes the waiting set (rescan, setSynthetic, filter
  // changes). Safe to call redundantly — it's idempotent.
  private reconcileLayoutPolling(): void {
    const shouldPoll =
      this.layoutProvider !== null && this.getWaiting().length >= 2;
    if (shouldPoll && !this.layoutPollTimer) {
      // Fire one immediate tick so dots snap into place without waiting for
      // the next interval (~250ms delay feels laggy on the first appearance).
      void this.tickLayout();
      this.layoutPollTimer = setInterval(
        () => void this.tickLayout(),
        this.LAYOUT_POLL_INTERVAL_MS
      );
    } else if (!shouldPoll && this.layoutPollTimer) {
      clearInterval(this.layoutPollTimer);
      this.layoutPollTimer = null;
      this.lastLayoutKey = null;
    }
  }

  private async tickLayout(): Promise<void> {
    const provider = this.layoutProvider;
    if (!provider) return;
    const agents = this.getWaiting();
    if (agents.length < 2) return;

    let windows: NativeWindowInfo[] = [];
    try {
      windows = await provider.listWindows();
    } catch (err) {
      log.warn('listWindows failed during layout tick:', err);
      return;
    }

    const layout = computeAgentLayout(agents, windows, provider.listDisplays());
    const key = layoutKey(layout);
    if (key === this.lastLayoutKey) return; // no visible change → skip IPC
    this.lastLayoutKey = key;
    this.emit('layout', layout);
  }

  setSynthetic(count: number): void {
    if (count <= 0) {
      this.syntheticOverride = null;
      this.emit('change', this.getWaiting());
      this.reconcileLayoutPolling();
      return;
    }
    const tools: AgentTool[] = ['claude', 'codex'];
    const now = Date.now();
    this.syntheticOverride = Array.from({ length: count }, (_, i) => ({
      agentId: `synthetic-${i}`,
      tool: tools[i % tools.length],
      pid: 0,
      cwd: `/synthetic/${i}`,
      ttyTitle: `synthetic-${i}`,
      terminalApp: 'synthetic',
      waitingSince: now + i,
    }));
    this.emit('change', [...this.syntheticOverride]);
    this.reconcileLayoutPolling();
  }

  async focus(agentId: string): Promise<boolean> {
    const agent = this.waiting.get(agentId);
    if (!agent) {
      log.info('focus requested for unknown agent: %s', agentId);
      return false;
    }
    const script = this.buildFocusScript(agent);
    if (!script) {
      log.warn('no focus strategy for terminal app: %s', agent.terminalApp);
      return false;
    }
    try {
      await execAsync(`osascript -e ${JSON.stringify(script)}`);
      return true;
    } catch (err) {
      log.error('focus failed for %s:', agentId, err);
      return false;
    }
  }

  destroy(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.layoutPollTimer) {
      clearInterval(this.layoutPollTimer);
      this.layoutPollTimer = null;
    }
  }

  private scheduleRescan(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.rescan(), this.RESCAN_DEBOUNCE_MS);
  }

  private rescan(): void {
    // Synthetic override freezes the agent list so the dev hotkey's chosen
    // count isn't immediately overwritten by the real watcher emitting an
    // empty set (no real agents waiting in dev).
    if (this.syntheticOverride !== null) return;
    let files: string[];
    try {
      files = fs.readdirSync(this.stateDir).filter(f => f.endsWith('.json'));
    } catch {
      return;
    }

    const seen = new Set<string>();
    let changed = false;

    for (const file of files) {
      const full = path.join(this.stateDir, file);
      let agent: WaitingAgent;
      try {
        agent = JSON.parse(fs.readFileSync(full, 'utf8')) as WaitingAgent;
      } catch {
        continue;
      }
      if (!this.isValidAgent(agent)) continue;
      seen.add(agent.agentId);
      const prev = this.waiting.get(agent.agentId);
      if (
        !prev ||
        prev.waitingSince !== agent.waitingSince ||
        prev.ttyTitle !== agent.ttyTitle
      ) {
        changed = true;
      }
      this.waiting.set(agent.agentId, agent);
    }

    for (const id of Array.from(this.waiting.keys())) {
      if (!seen.has(id)) {
        this.waiting.delete(id);
        changed = true;
      }
    }

    if (changed) {
      this.emit('change', this.getWaiting());
      this.reconcileLayoutPolling();
    }
  }

  private isValidAgent(value: unknown): value is WaitingAgent {
    if (!value || typeof value !== 'object') return false;
    const a = value as Record<string, unknown>;
    return (
      typeof a.agentId === 'string' &&
      (a.tool === 'claude' || a.tool === 'codex') &&
      typeof a.pid === 'number' &&
      typeof a.waitingSince === 'number' &&
      typeof a.terminalApp === 'string'
    );
  }

  private buildFocusScript(agent: WaitingAgent): string | null {
    const app = agent.terminalApp;
    const titleMatch = agent.ttyTitle ? this.escapeAppleScript(agent.ttyTitle) : '';

    if (app === 'iTerm2' || app === 'iTerm') {
      if (!titleMatch) return `tell application "iTerm" to activate`;
      return `tell application "iTerm"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if name of s contains "${titleMatch}" then
          select t
          tell w to set frontmost to true
          return
        end if
      end repeat
    end repeat
  end repeat
end tell`;
    }

    if (app === 'Terminal') {
      return `tell application "Terminal"
  activate
  ${titleMatch ? `repeat with w in windows
    repeat with t in tabs of w
      if (custom title of t) contains "${titleMatch}" or (name of t) contains "${titleMatch}" then
        set selected of t to true
        set frontmost of w to true
        return
      end if
    end repeat
  end repeat` : ''}
end tell`;
    }

    if (app === 'Ghostty') {
      return `tell application "Ghostty" to activate`;
    }

    if (app === 'Warp') {
      return `tell application "Warp" to activate`;
    }

    // Fallback: bring the app itself forward.
    return `tell application "${this.escapeAppleScript(app)}" to activate`;
  }

  private escapeAppleScript(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}

// Stable string fingerprint for a layout. Used to skip redundant IPC emits
// when the poll tick produces an identical layout to the last one.
function layoutKey(layout: AgentLayout): string {
  const slotKey = layout.slots
    .map(s => `${s.position}:${s.agentIds.slice().sort().join(',')}`)
    .join('|');
  const unmatched = layout.unmatched.slice().sort().join(',');
  return `${layout.kind}@${slotKey}#${unmatched}`;
}
