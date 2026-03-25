import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/test/app',
  },
}));

import { CouncilManager } from './councilManager';
import type { CouncilEvent, CouncilStatus } from './types/council';

// Fake process that simulates stdout/stderr/close events.
function createFakeProcess() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as any;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.kill = vi.fn();
  return proc;
}

function emitLine(proc: any, json: Record<string, any>) {
  proc.stdout.emit('data', Buffer.from(JSON.stringify(json) + '\n'));
}

describe('CouncilManager', () => {
  let manager: CouncilManager;
  let proc: ReturnType<typeof createFakeProcess>;
  let mockSpawn: ReturnType<typeof vi.fn>;
  let mockExecSync: ReturnType<typeof vi.fn>;
  let mockExistsSync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    proc = createFakeProcess();
    mockSpawn = vi.fn().mockReturnValue(proc);
    mockExecSync = vi.fn().mockReturnValue(Buffer.from('/usr/local/bin/claude\n'));
    mockExistsSync = vi.fn().mockReturnValue(true);
    manager = new CouncilManager({
      spawnFn: mockSpawn as any,
      execSyncFn: mockExecSync as any,
      existsSyncFn: mockExistsSync as any,
    });
  });

  afterEach(() => {
    manager.destroy();
    vi.clearAllMocks();
  });

  // -- start() --

  it('starts a debate and spawns council.sh with correct args', async () => {
    const result = await manager.start({ topic: 'Test topic', opusVsOpus: true });
    expect(result.success).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith(
      'bash',
      expect.arrayContaining(['--json-events', '--matchup', 'opus-vs-opus', 'Test topic']),
      expect.objectContaining({ detached: true })
    );
  });

  it('passes --max-turns and --repo when provided', async () => {
    await manager.start({ topic: 'Test', maxTurns: 10, repoPath: '/tmp/repo', opusVsOpus: true });
    const args = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--max-turns');
    expect(args).toContain('10');
    expect(args).toContain('--repo');
    expect(args).toContain('/tmp/repo');
  });

  it('passes --transcript-dir when handoffs dir is set', async () => {
    manager.setHandoffsDirectory('/tmp/handoffs');
    await manager.start({ topic: 'Test', opusVsOpus: true });
    const args = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--transcript-dir');
    expect(args).toContain('/tmp/handoffs');
  });

  it('rejects if council.sh not found', async () => {
    mockExistsSync.mockReturnValue(false);
    const result = await manager.start({ topic: 'Test', opusVsOpus: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('rejects if claude CLI not available', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    const result = await manager.start({ topic: 'Test', opusVsOpus: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain('claude CLI');
  });

  it('rejects if codex CLI not available (non opus-vs-opus)', async () => {
    // First call (which claude) succeeds, second (which codex) fails
    mockExecSync
      .mockReturnValueOnce(Buffer.from('/usr/local/bin/claude\n'))
      .mockImplementationOnce(() => { throw new Error('not found'); });
    const result = await manager.start({ topic: 'Test', opusVsOpus: false });
    expect(result.success).toBe(false);
    expect(result.error).toContain('codex CLI');
  });

  it('rejects if a debate is already running', async () => {
    await manager.start({ topic: 'First', opusVsOpus: true });
    const result = await manager.start({ topic: 'Second', opusVsOpus: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain('already running');
  });

  it('stops a specific kickoff session without affecting the manual debate slot', async () => {
    const kickoffProc = createFakeProcess();
    mockSpawn.mockReturnValueOnce(kickoffProc);
    const kickoffManager = new CouncilManager({
      spawnFn: mockSpawn as any,
      execSyncFn: mockExecSync as any,
      existsSyncFn: mockExistsSync as any,
      readFileSyncFn: vi.fn().mockReturnValue('Kickoff topic') as any,
    });

    const kickoffDetectedPromise = new Promise<any>((resolve) => {
      kickoffManager.on('kickoffDetected', resolve);
    });
    await kickoffManager.handleKickoff('/tmp/kickoff.md');
    const kickoffDetected = await kickoffDetectedPromise;

    expect(kickoffManager.stopKickoffSession('missing-session')).toBe(false);
    expect(kickoffDetected.sessionId).toBeTruthy();
    expect(kickoffManager.stopKickoffSession(kickoffDetected.sessionId)).toBe(true);
    expect(kickoffProc.kill).toHaveBeenCalledWith('SIGTERM');

    kickoffManager.destroy();
  });

  // -- NDJSON parsing --

  it('parses NDJSON events from stdout', async () => {
    const events: CouncilEvent[] = [];
    manager.on('event', (e) => events.push(e));

    await manager.start({ topic: 'Test', opusVsOpus: true });

    emitLine(proc, { type: 'debate_start', topic: 'Test', maxTurns: '20' });
    emitLine(proc, { type: 'turn_start', speaker: 'Claude A', round: '1' });
    emitLine(proc, { type: 'turn_chunk', speaker: 'Claude A', content: 'Hello' });

    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('debate_start');
    expect(events[1].type).toBe('turn_start');
    expect(events[2].type).toBe('turn_chunk');
  });

  it('handles partial JSON lines (buffer splitting)', async () => {
    const events: CouncilEvent[] = [];
    manager.on('event', (e) => events.push(e));

    await manager.start({ topic: 'Test', opusVsOpus: true });

    // Send a partial line
    proc.stdout.emit('data', Buffer.from('{"type": "debate_start"'));
    expect(events).toHaveLength(0);

    // Complete it
    proc.stdout.emit('data', Buffer.from(', "topic": "Test", "maxTurns": "20"}\n'));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('debate_start');
  });

  it('handles multiple JSON objects in one data chunk', async () => {
    const events: CouncilEvent[] = [];
    manager.on('event', (e) => events.push(e));

    await manager.start({ topic: 'Test', opusVsOpus: true });

    const twoLines = '{"type":"debate_start","topic":"T","maxTurns":"20"}\n{"type":"turn_start","speaker":"A","round":"1"}\n';
    proc.stdout.emit('data', Buffer.from(twoLines));
    expect(events).toHaveLength(2);
  });

  it('skips non-JSON lines without crashing', async () => {
    const events: CouncilEvent[] = [];
    manager.on('event', (e) => events.push(e));

    await manager.start({ topic: 'Test', opusVsOpus: true });

    proc.stdout.emit('data', Buffer.from('some garbage text\n'));
    proc.stdout.emit('data', Buffer.from('{"type":"debate_start","topic":"T","maxTurns":"20"}\n'));

    expect(events).toHaveLength(1);
  });

  it('processes remaining buffer on close', async () => {
    const events: CouncilEvent[] = [];
    manager.on('event', (e) => events.push(e));

    await manager.start({ topic: 'Test', opusVsOpus: true });

    // Send a line without trailing newline
    proc.stdout.emit('data', Buffer.from('{"type":"debate_complete","totalRounds":"3","outcome":"DONE"}'));
    expect(events).toHaveLength(0);

    // Close the process — should flush buffer
    proc.emit('close', 0);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('debate_complete');
  });

  // -- State machine --

  it('transitions through states correctly', async () => {
    const statuses: CouncilStatus[] = [];
    manager.on('statusChanged', (s) => statuses.push(s));

    await manager.start({ topic: 'Test', opusVsOpus: true });

    // starting
    expect(statuses[0].state).toBe('starting');

    // debate_start → debating
    emitLine(proc, { type: 'debate_start', topic: 'Test', maxTurns: '20' });
    expect(statuses[1].state).toBe('debating');

    // state_change → finalizing
    emitLine(proc, { type: 'state_change', from: 'DEBATING', to: 'FINALIZING', reason: 'Converged' });
    expect(statuses[2].state).toBe('finalizing');

    // debate_complete → done
    emitLine(proc, { type: 'debate_complete', totalRounds: '3', outcome: 'DONE' });
    expect(statuses[3].state).toBe('done');
  });

  it('tracks current round from turn_start events', async () => {
    await manager.start({ topic: 'Test', opusVsOpus: true });
    emitLine(proc, { type: 'debate_start', topic: 'Test', maxTurns: '20' });

    emitLine(proc, { type: 'turn_start', speaker: 'Claude A', round: '3' });
    expect(manager.getStatus().currentRound).toBe(3);

    // 'final' round should not change the number
    emitLine(proc, { type: 'turn_start', speaker: 'Claude A', round: 'final' });
    expect(manager.getStatus().currentRound).toBe(3);
  });

  it('moves into paused state when council requests human input', async () => {
    await manager.start({ topic: 'Test', opusVsOpus: true });
    emitLine(proc, {
      type: 'pause_requested',
      reason: 'Need human input',
      round: '1',
      stateFilePath: '/tmp/paused.state.json',
    });

    expect(manager.getStatus().state).toBe('paused');
  });

  it('accumulates token usage from turn_end events', async () => {
    await manager.start({ topic: 'Test', opusVsOpus: true });
    emitLine(proc, {
      type: 'turn_end',
      speaker: 'Claude A',
      round: '1',
      convergence: 'medium',
      action: 'continue',
      inputTokens: '1200',
      outputTokens: '300',
      totalTokens: '1500',
    });
    emitLine(proc, {
      type: 'turn_end',
      speaker: 'Claude B',
      round: '1',
      convergence: 'medium',
      action: 'continue',
      inputTokens: '900',
      outputTokens: '200',
      totalTokens: '1100',
    });

    expect(manager.getStatus().tokenUsage).toEqual({
      inputTokens: 2100,
      outputTokens: 500,
      totalTokens: 2600,
    });
  });

  it('sets error state on non-zero exit', async () => {
    await manager.start({ topic: 'Test', opusVsOpus: true });
    proc.emit('close', 1);
    expect(manager.getStatus().state).toBe('error');
    expect(manager.getStatus().error).toContain('code 1');
  });

  it('sets done state on zero exit when no debate_complete received', async () => {
    await manager.start({ topic: 'Test', opusVsOpus: true });
    emitLine(proc, { type: 'debate_start', topic: 'Test', maxTurns: '20' });
    proc.emit('close', 0);
    expect(manager.getStatus().state).toBe('done');
  });

  it('does not mark a paused debate as errored when council exits with the pause code', async () => {
    await manager.start({ topic: 'Test', opusVsOpus: true });
    emitLine(proc, {
      type: 'pause_requested',
      reason: 'Need human input',
      round: '1',
      stateFilePath: '/tmp/paused.state.json',
    });

    proc.emit('close', 42);
    expect(manager.getStatus().state).toBe('paused');
    expect(manager.getStatus().error).toBeNull();
  });

  it('does not override done state on zero exit after debate_complete', async () => {
    const statuses: CouncilStatus[] = [];
    manager.on('statusChanged', (s) => statuses.push(s));

    await manager.start({ topic: 'Test', opusVsOpus: true });
    emitLine(proc, { type: 'debate_complete', totalRounds: '3', outcome: 'DONE' });

    const doneCount = statuses.filter(s => s.state === 'done').length;
    proc.emit('close', 0);

    // Should not emit an extra 'done' status
    const newDoneCount = statuses.filter(s => s.state === 'done').length;
    expect(newDoneCount).toBe(doneCount);
  });

  // -- stop() --

  it('sends SIGTERM on stop', async () => {
    await manager.start({ topic: 'Test', opusVsOpus: true });
    manager.stop();
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('kills the full process group when the council pid is available', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    proc.pid = 4242;

    await manager.start({ topic: 'Test', opusVsOpus: true });
    manager.stop();

    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGTERM');
    killSpy.mockRestore();
  });

  it('marks the debate as stopped by user after stop closes the process', async () => {
    await manager.start({ topic: 'Test', opusVsOpus: true });
    manager.stop();
    proc.emit('close', null);

    expect(manager.getStatus().state).toBe('error');
    expect(manager.getStatus().error).toBe('Debate stopped by user');
  });

  // -- getStatus() --

  it('returns idle status initially', () => {
    const status = manager.getStatus();
    expect(status.state).toBe('idle');
    expect(status.currentRound).toBe(0);
    expect(status.topic).toBeNull();
    expect(status.repoPath).toBeNull();
    expect(status.matchup).toBe('opus-vs-codex');
    expect(status.transcriptPath).toBeNull();
    expect(status.consensusPath).toBeNull();
    expect(status.tokenUsage).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
  });

  // -- lifecycle --

  it('allows starting a new debate after previous completes', async () => {
    await manager.start({ topic: 'First', opusVsOpus: true });
    proc.emit('close', 0);

    // Reset mock for second spawn
    const proc2 = createFakeProcess();
    mockSpawn.mockReturnValue(proc2);

    const result = await manager.start({ topic: 'Second', opusVsOpus: true });
    expect(result.success).toBe(true);
    expect(manager.getStatus().topic).toBe('Second');
  });

  it('resets accumulated token usage when a new debate starts', async () => {
    await manager.start({ topic: 'First', opusVsOpus: true });
    emitLine(proc, {
      type: 'turn_end',
      speaker: 'Claude A',
      round: '1',
      convergence: 'medium',
      action: 'continue',
      inputTokens: '1200',
      outputTokens: '300',
      totalTokens: '1500',
    });
    proc.emit('close', 0);

    const proc2 = createFakeProcess();
    mockSpawn.mockReturnValue(proc2);

    const result = await manager.start({ topic: 'Second', opusVsOpus: true });
    expect(result.success).toBe(true);
    expect(manager.getStatus().tokenUsage).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
  });

  it('does not skip codex check when opusVsOpus is true', async () => {
    await manager.start({ topic: 'Test', opusVsOpus: true });
    // Only 'which claude' should have been called, not 'which codex'
    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith('which claude', expect.any(Object));
  });

  it('checks codex when opusVsOpus is false', async () => {
    await manager.start({ topic: 'Test', opusVsOpus: false });
    // Both 'which claude' and 'which codex' should have been called
    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenCalledWith('which claude', expect.any(Object));
    expect(mockExecSync).toHaveBeenCalledWith('which codex', expect.any(Object));
  });

  it('supports codex-vs-codex without checking claude', async () => {
    await manager.start({ topic: 'Test', matchup: 'codex-vs-codex' });
    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith('which codex', expect.any(Object));
  });

  it('passes the default matchup when opus-vs-opus is not requested', async () => {
    await manager.start({ topic: 'Test', opusVsOpus: false });
    const args = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--matchup');
    expect(args).toContain('opus-vs-codex');
  });

  it('passes --max-turns 0 when maxTurns is explicitly 0', async () => {
    await manager.start({ topic: 'Test', maxTurns: 0, opusVsOpus: true });
    const args = mockSpawn.mock.calls[0][1];
    expect(args).toContain('--max-turns');
    expect(args).toContain('0');
  });

  // -- process error event --

  it('sets error state on spawn failure', async () => {
    await manager.start({ topic: 'Test', opusVsOpus: true });
    proc.emit('error', new Error('spawn ENOENT'));
    expect(manager.getStatus().state).toBe('error');
    expect(manager.getStatus().error).toContain('ENOENT');
  });

  // -- destroy() --

  it('force-kills process on destroy without waiting', async () => {
    await manager.start({ topic: 'Test', opusVsOpus: true });
    manager.destroy();
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('removes all listeners on destroy', async () => {
    manager.on('event', vi.fn());
    manager.on('statusChanged', vi.fn());
    manager.destroy();
    expect(manager.listenerCount('event')).toBe(0);
    expect(manager.listenerCount('statusChanged')).toBe(0);
  });

  it('clears pending kill timer on destroy', async () => {
    await manager.start({ topic: 'Test', opusVsOpus: true });
    // Start a graceful stop (sets a kill timer)
    manager.stop();
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    // Now destroy — should not leave dangling timer
    manager.destroy();
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  // -- handleKickoff() --

  describe('handleKickoff', () => {
    let kickoffManager: CouncilManager;
    let mockReadFileSync: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockReadFileSync = vi.fn();
      kickoffManager = new CouncilManager({
        spawnFn: mockSpawn as any,
        execSyncFn: mockExecSync as any,
        existsSyncFn: mockExistsSync as any,
        readFileSyncFn: mockReadFileSync as any,
        mkdirSyncFn: vi.fn() as any,
      });
    });

    afterEach(() => {
      kickoffManager.destroy();
    });

    it('extracts first non-empty line as display topic', async () => {
      const content = 'Should we use SQLite or Postgres?\n\nContext: We need fast lookups...';
      mockReadFileSync.mockReturnValue(content);

      const proc2 = createFakeProcess();
      mockSpawn.mockReturnValue(proc2);

      const events: any[] = [];
      kickoffManager.on('kickoffDetected', (e: any) => events.push(e));
      await kickoffManager.handleKickoff('/tmp/kickoff.md');

      // The full content is passed as the topic arg to council.sh
      const spawnArgs = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1][1];
      expect(spawnArgs[spawnArgs.length - 1]).toBe(content);
      expect(events[0]?.displayTopic).toBe('Should we use SQLite or Postgres?');
    });

    it('passes full file content as topic to start()', async () => {
      const content = 'Topic line\n\nLots of context here\nMore details';
      mockReadFileSync.mockReturnValue(content);

      const proc2 = createFakeProcess();
      mockSpawn.mockReturnValue(proc2);

      await kickoffManager.handleKickoff('/tmp/kickoff.md');

      const spawnArgs = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1][1];
      expect(spawnArgs[spawnArgs.length - 1]).toBe(content);
    });

    it('skips empty files', async () => {
      mockReadFileSync.mockReturnValue('   \n\n  ');

      await kickoffManager.handleKickoff('/tmp/empty.md');

      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('starts a kickoff in the background even when a manual debate is already running', async () => {
      mockReadFileSync.mockReturnValue('Some topic');

      const proc2 = createFakeProcess();
      const proc3 = createFakeProcess();
      mockSpawn
        .mockReturnValueOnce(proc2)
        .mockReturnValueOnce(proc3);

      // Start a debate first
      await kickoffManager.start({ topic: 'Already running', opusVsOpus: true });
      const callCount = mockSpawn.mock.calls.length;

      // Now try a kickoff — should spawn a separate background session
      await kickoffManager.handleKickoff('/tmp/kickoff.md');
      expect(mockSpawn.mock.calls.length).toBe(callCount + 1);
      expect(mockReadFileSync).toHaveBeenCalledWith('/tmp/kickoff.md', 'utf-8');
    });

    it('emits kickoffDetected on successful start', async () => {
      const content = 'My debate topic\n\nDetails here';
      mockReadFileSync.mockReturnValue(content);

      const proc2 = createFakeProcess();
      mockSpawn.mockReturnValue(proc2);

      const events: any[] = [];
      kickoffManager.on('kickoffDetected', (e: any) => events.push(e));

      await kickoffManager.handleKickoff('/tmp/kickoff.md');

      expect(events).toHaveLength(1);
      expect(events[0].filePath).toBe('/tmp/kickoff.md');
      expect(events[0].displayTopic).toBe('My debate topic');
    });

    it('handles file read errors gracefully', async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

      await kickoffManager.handleKickoff('/tmp/vanished.md');

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(kickoffManager.getStatus().state).toBe('idle');
    });

    it('skips leading blank lines when extracting display topic', async () => {
      mockReadFileSync.mockReturnValue('\n\n  \nActual topic here\nMore context');

      const proc2 = createFakeProcess();
      mockSpawn.mockReturnValue(proc2);

      const events: any[] = [];
      kickoffManager.on('kickoffDetected', (e: any) => events.push(e));
      await kickoffManager.handleKickoff('/tmp/kickoff.md');

      expect(events[0]?.displayTopic).toBe('Actual topic here');
    });

    it('parses kickoff frontmatter for matchup and max turns', async () => {
      mockReadFileSync.mockReturnValue(`---
matchup: codex-vs-codex
max-turns: 4
repo-path: /tmp/repo
---
# Debate title

Context body`);

      const proc2 = createFakeProcess();
      mockSpawn.mockReturnValue(proc2);

      await kickoffManager.handleKickoff('/tmp/kickoff.md');

      const args = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1][1];
      expect(args).toContain('--matchup');
      expect(args).toContain('codex-vs-codex');
      expect(args).toContain('--max-turns');
      expect(args).toContain('4');
      expect(args).toContain('--repo');
      expect(args).toContain('/tmp/repo');
      expect(args[args.length - 1]).toContain('# Debate title');
    });

    it('allows multiple kickoff debates to run concurrently', async () => {
      mockReadFileSync
        .mockReturnValueOnce('First kickoff')
        .mockReturnValueOnce('Second kickoff');

      const proc2 = createFakeProcess();
      const proc3 = createFakeProcess();
      mockSpawn
        .mockReturnValueOnce(proc2)
        .mockReturnValueOnce(proc3);

      await kickoffManager.handleKickoff('/tmp/one.md');
      await kickoffManager.handleKickoff('/tmp/two.md');

      expect(mockSpawn).toHaveBeenCalledTimes(2);
      const firstArgs = mockSpawn.mock.calls[0]?.[1];
      const secondArgs = mockSpawn.mock.calls[1]?.[1];
      expect(firstArgs[firstArgs.length - 1]).toBe('First kickoff');
      expect(secondArgs[secondArgs.length - 1]).toBe('Second kickoff');
    });
  });
});
