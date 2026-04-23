import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentAttentionManager } from './agentAttentionManager';
import type { WaitingAgent } from './types/agentAttention';

function makeAgent(partial: Partial<WaitingAgent> & Pick<WaitingAgent, 'agentId' | 'tool'>): WaitingAgent {
  return {
    pid: 12345,
    cwd: '/tmp/work',
    ttyTitle: 'claude — main',
    terminalApp: 'iTerm2',
    waitingSince: Date.now(),
    ...partial,
  } as WaitingAgent;
}

function writeAgent(dir: string, agent: WaitingAgent): void {
  writeFileSync(join(dir, `${agent.agentId}.json`), JSON.stringify(agent));
}

describe('AgentAttentionManager', () => {
  let stateDir: string;
  let mgr: AgentAttentionManager;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'agent-attention-test-'));
  });

  afterEach(() => {
    mgr?.destroy();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates the state directory if missing', () => {
    const missing = join(stateDir, 'nested', 'state');
    mgr = new AgentAttentionManager(missing);
    mgr.start();
    expect(mgr.getWaiting()).toEqual([]);
  });

  it('picks up pre-existing state files on start', () => {
    const agent = makeAgent({ agentId: 'a1', tool: 'claude' });
    writeAgent(stateDir, agent);

    mgr = new AgentAttentionManager(stateDir);
    mgr.start();

    expect(mgr.getWaiting()).toHaveLength(1);
    expect(mgr.getWaiting()[0].agentId).toBe('a1');
  });

  it('sorts waiting agents by waitingSince ascending', () => {
    writeAgent(stateDir, makeAgent({ agentId: 'old', tool: 'claude', waitingSince: 1000 }));
    writeAgent(stateDir, makeAgent({ agentId: 'new', tool: 'codex', waitingSince: 5000 }));

    mgr = new AgentAttentionManager(stateDir);
    mgr.start();

    const waiting = mgr.getWaiting();
    expect(waiting.map(a => a.agentId)).toEqual(['old', 'new']);
  });

  it('ignores malformed JSON without throwing', () => {
    writeFileSync(join(stateDir, 'broken.json'), '{not json');
    writeAgent(stateDir, makeAgent({ agentId: 'ok', tool: 'claude' }));

    mgr = new AgentAttentionManager(stateDir);
    mgr.start();

    expect(mgr.getWaiting()).toHaveLength(1);
    expect(mgr.getWaiting()[0].agentId).toBe('ok');
  });

  it('rejects state files missing required fields', () => {
    writeFileSync(join(stateDir, 'bad.json'), JSON.stringify({ agentId: 'x' }));

    mgr = new AgentAttentionManager(stateDir);
    mgr.start();

    expect(mgr.getWaiting()).toHaveLength(0);
  });

  it('rejects agents with unknown tool values', () => {
    writeFileSync(
      join(stateDir, 'weird.json'),
      JSON.stringify({
        agentId: 'x',
        tool: 'gemini',
        pid: 1,
        cwd: '/',
        ttyTitle: '',
        terminalApp: 'Terminal',
        waitingSince: 1,
      })
    );

    mgr = new AgentAttentionManager(stateDir);
    mgr.start();

    expect(mgr.getWaiting()).toHaveLength(0);
  });

  it('focus() returns false for unknown agent id', async () => {
    mgr = new AgentAttentionManager(stateDir);
    mgr.start();
    const result = await mgr.focus('nonexistent');
    expect(result).toBe(false);
  });

  it('emits change with updated list when a file appears', async () => {
    mgr = new AgentAttentionManager(stateDir);
    mgr.start();

    const changes: WaitingAgent[][] = [];
    mgr.on('change', (agents: WaitingAgent[]) => changes.push(agents));

    writeAgent(stateDir, makeAgent({ agentId: 'fresh', tool: 'claude' }));

    await new Promise(resolve => setTimeout(resolve, 200));

    expect(changes.length).toBeGreaterThan(0);
    expect(changes[changes.length - 1][0].agentId).toBe('fresh');
  });

  it('emits change and drops agent when its file is removed', async () => {
    const agent = makeAgent({ agentId: 'vanishing', tool: 'codex' });
    writeAgent(stateDir, agent);

    mgr = new AgentAttentionManager(stateDir);
    mgr.start();
    expect(mgr.getWaiting()).toHaveLength(1);

    const changes: WaitingAgent[][] = [];
    mgr.on('change', (agents: WaitingAgent[]) => changes.push(agents));

    unlinkSync(join(stateDir, `${agent.agentId}.json`));
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(changes.length).toBeGreaterThan(0);
    expect(changes[changes.length - 1]).toEqual([]);
    expect(mgr.getWaiting()).toHaveLength(0);
  });

  it('setToolFilter hides agents whose tool is disabled', () => {
    writeAgent(stateDir, makeAgent({ agentId: 'c1', tool: 'claude' }));
    writeAgent(stateDir, makeAgent({ agentId: 'x1', tool: 'codex' }));

    mgr = new AgentAttentionManager(stateDir);
    mgr.start();
    expect(mgr.getWaiting()).toHaveLength(2);

    mgr.setToolFilter({ claude: true, codex: false });
    expect(mgr.getWaiting().map(a => a.agentId)).toEqual(['c1']);

    mgr.setToolFilter({ claude: false, codex: false });
    expect(mgr.getWaiting()).toHaveLength(0);
  });

  it('setToolFilter emits change only when the filter actually changes', () => {
    mgr = new AgentAttentionManager(stateDir);
    mgr.start();

    const changes: WaitingAgent[][] = [];
    mgr.on('change', (agents: WaitingAgent[]) => changes.push(agents));

    mgr.setToolFilter({ claude: true, codex: true });
    expect(changes).toHaveLength(0);

    mgr.setToolFilter({ claude: true, codex: false });
    expect(changes).toHaveLength(1);
  });
});
