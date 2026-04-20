import { describe, expect, it } from 'vitest';
import {
  computeAgentLayout,
  matchAgentToWindow,
  windowCenterFraction,
  type DisplayBounds,
} from './agentLayout';
import type { WaitingAgent } from './types/agentAttention';
import type { NativeWindowInfo } from './types/audio';

function agent(partial: Partial<WaitingAgent> & Pick<WaitingAgent, 'agentId'>): WaitingAgent {
  return {
    tool: 'claude',
    pid: 1,
    cwd: '/Users/me/projects/widget',
    ttyTitle: 'claude — widget',
    terminalApp: 'Ghostty',
    waitingSince: Date.now(),
    ...partial,
  } as WaitingAgent;
}

function win(partial: Partial<NativeWindowInfo> & Pick<NativeWindowInfo, 'title'>): NativeWindowInfo {
  return {
    windowId: 1,
    ownerName: 'Ghostty',
    ownerPID: 1,
    ownerBundleId: 'com.mitchellh.ghostty',
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    layer: 0,
    ...partial,
  };
}

const SCREEN: DisplayBounds[] = [{ x: 0, y: 0, width: 2000, height: 1200 }];

describe('matchAgentToWindow', () => {
  it('returns null when no window matches the terminal app', () => {
    const a = agent({ agentId: 'a', terminalApp: 'Ghostty' });
    const windows = [win({ title: 'widget', ownerName: 'Terminal' })];
    expect(matchAgentToWindow(a, windows)).toBeNull();
  });

  it('picks the window whose title contains the cwd basename', () => {
    const a = agent({ agentId: 'a', cwd: '/Users/me/projects/widget' });
    const match = win({ title: 'zsh — widget', ownerName: 'Ghostty' });
    const other = win({ title: 'zsh — home', ownerName: 'Ghostty', windowId: 2 });
    expect(matchAgentToWindow(a, [other, match])?.windowId).toBe(match.windowId);
  });

  it('falls back to first app window when cwd has no tokens', () => {
    const a = agent({ agentId: 'a', cwd: '/' });
    const first = win({ title: 'misc', ownerName: 'Ghostty' });
    expect(matchAgentToWindow(a, [first])).toBe(first);
  });

  it('matches Warp under both "Warp" and "WarpTerminal" owner names', () => {
    const a = agent({ agentId: 'a', terminalApp: 'Warp', cwd: '/Users/me/fieldtheory' });
    const w = win({ title: 'zsh — fieldtheory', ownerName: 'WarpTerminal' });
    expect(matchAgentToWindow(a, [w])).toBe(w);
  });
});

describe('windowCenterFraction', () => {
  it('returns [0,1] coords on a single display', () => {
    const w = win({ title: 't', x: 500, y: 300, width: 1000, height: 600 });
    const frac = windowCenterFraction(w, SCREEN);
    expect(frac).toEqual({ x: 0.5, y: 0.5 });
  });

  it('normalizes per display for multi-monitor setups', () => {
    const displays: DisplayBounds[] = [
      { x: 0, y: 0, width: 1000, height: 1000 },
      { x: 1000, y: 0, width: 1000, height: 1000 },
    ];
    // Window center at x=1750 belongs to display 2; fx = (1750-1000)/1000 = 0.75
    const w = win({ title: 't', x: 1500, y: 0, width: 500, height: 500 });
    expect(windowCenterFraction(w, displays)).toEqual({ x: 0.75, y: 0.25 });
  });

  it('returns null for zero-area windows', () => {
    expect(windowCenterFraction(win({ title: 't', width: 0, height: 0 }), SCREEN)).toBeNull();
  });
});

describe('computeAgentLayout', () => {
  it('returns empty layout when agents list is empty', () => {
    const layout = computeAgentLayout([], [], SCREEN);
    expect(layout).toEqual({ kind: 'row', slots: [], unmatched: [] });
  });

  it('puts all agents into unmatched when no windows match', () => {
    const a = agent({ agentId: 'a' });
    const layout = computeAgentLayout([a], [], SCREEN);
    expect(layout.slots).toEqual([]);
    expect(layout.unmatched).toEqual(['a']);
  });

  it('renders horizontal windows as a row ordered left-to-right', () => {
    const agents = [
      agent({ agentId: 'right', cwd: '/projects/foxtrot' }),
      agent({ agentId: 'left', cwd: '/projects/alpha' }),
      agent({ agentId: 'middle', cwd: '/projects/charlie' }),
    ];
    const windows = [
      win({ windowId: 1, title: 'zsh — alpha', x: 0, y: 500, width: 500, height: 400 }),
      win({ windowId: 2, title: 'zsh — charlie', x: 800, y: 500, width: 500, height: 400 }),
      win({ windowId: 3, title: 'zsh — foxtrot', x: 1500, y: 500, width: 400, height: 400 }),
    ];

    const layout = computeAgentLayout(agents, windows, SCREEN);
    expect(layout.kind).toBe('row');
    expect(layout.slots.map(s => s.agentIds)).toEqual([['left'], ['middle'], ['right']]);
    expect(layout.unmatched).toEqual([]);
  });

  it('switches to 2x2 grid when windows are vertically spread', () => {
    const agents = [
      agent({ agentId: 'tl', cwd: '/projects/alpha' }),
      agent({ agentId: 'tr', cwd: '/projects/bravo' }),
      agent({ agentId: 'bl', cwd: '/projects/charlie' }),
      agent({ agentId: 'br', cwd: '/projects/delta' }),
    ];
    const windows = [
      win({ windowId: 1, title: 'alpha', x: 100, y: 100, width: 500, height: 400 }),
      win({ windowId: 2, title: 'bravo', x: 1300, y: 100, width: 500, height: 400 }),
      win({ windowId: 3, title: 'charlie', x: 100, y: 800, width: 500, height: 300 }),
      win({ windowId: 4, title: 'delta', x: 1300, y: 800, width: 500, height: 300 }),
    ];

    const layout = computeAgentLayout(agents, windows, SCREEN);
    expect(layout.kind).toBe('grid');
    const byPos = Object.fromEntries(layout.slots.map(s => [s.position, s.agentIds]));
    expect(byPos[0]).toEqual(['tl']);
    expect(byPos[1]).toEqual(['tr']);
    expect(byPos[2]).toEqual(['bl']);
    expect(byPos[3]).toEqual(['br']);
  });

  it('clusters nearby windows in row layout as ×N', () => {
    const agents = [
      agent({ agentId: 'a1', cwd: '/projects/alpha' }),
      agent({ agentId: 'a2', cwd: '/projects/alpha2' }),
    ];
    const windows = [
      win({ windowId: 1, title: 'alpha', x: 100, y: 500, width: 400, height: 400 }),
      win({ windowId: 2, title: 'alpha2', x: 150, y: 500, width: 400, height: 400 }),
    ];

    const layout = computeAgentLayout(agents, windows, SCREEN);
    expect(layout.kind).toBe('row');
    expect(layout.slots).toHaveLength(1);
    expect(layout.slots[0].agentIds.sort()).toEqual(['a1', 'a2']);
  });

  it('pushes excess agents past 4 row slots into unmatched (+N)', () => {
    const agents = Array.from({ length: 6 }, (_, i) =>
      agent({ agentId: `a${i}`, cwd: `/projects/w${i}` })
    );
    const windows = Array.from({ length: 6 }, (_, i) =>
      win({
        windowId: i + 1,
        title: `w${i}`,
        x: i * 300,
        y: 500,
        width: 250,
        height: 400,
      })
    );

    const layout = computeAgentLayout(agents, windows, SCREEN);
    expect(layout.kind).toBe('row');
    expect(layout.slots).toHaveLength(4);
    expect(layout.unmatched).toHaveLength(2);
  });

  it('stacks multiple agents in the same quadrant for grid layout', () => {
    const agents = [
      agent({ agentId: 'tl1', cwd: '/projects/foo' }),
      agent({ agentId: 'tl2', cwd: '/projects/bar' }),
      agent({ agentId: 'br1', cwd: '/projects/baz' }),
    ];
    const windows = [
      win({ windowId: 1, title: 'foo', x: 100, y: 100, width: 400, height: 300 }),
      win({ windowId: 2, title: 'bar', x: 200, y: 150, width: 400, height: 300 }),
      win({ windowId: 3, title: 'baz', x: 1300, y: 900, width: 400, height: 200 }),
    ];

    const layout = computeAgentLayout(agents, windows, SCREEN);
    expect(layout.kind).toBe('grid');
    const byPos = Object.fromEntries(layout.slots.map(s => [s.position, s.agentIds.sort()]));
    expect(byPos[0]?.sort()).toEqual(['tl1', 'tl2']);
    expect(byPos[3]).toEqual(['br1']);
  });
});
