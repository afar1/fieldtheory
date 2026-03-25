/**
 * CouncilManager — Orchestrates council.sh debates from the main process.
 *
 * Spawns council.sh with --json-events mode, parses NDJSON stdout,
 * and emits typed events for the renderer to consume.
 */

import { EventEmitter } from 'events';
import { spawn as defaultSpawn, execSync as defaultExecSync, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { app } from 'electron';
import chokidar from 'chokidar';
import { createLogger } from './logger';
import {
  DEFAULT_COUNCIL_MATCHUP,
  isCouncilMatchup,
} from './types/council';
import type {
  CouncilConfig,
  CouncilEvent,
  CouncilMatchup,
  CouncilState,
  CouncilStatus,
  CouncilTokenUsage,
} from './types/council';

const log = createLogger('Council');

type CouncilStartSource = 'manual' | 'kickoff';

export interface CouncilTargetApp {
  bundleId: string;
  name: string;
}

export interface CouncilManagerOptions {
  spawnFn?: typeof defaultSpawn;
  execSyncFn?: typeof defaultExecSync;
  existsSyncFn?: typeof fs.existsSync;
  readFileSyncFn?: typeof fs.readFileSync;
  mkdirSyncFn?: typeof fs.mkdirSync;
  getKickoffDefaults?: () => Partial<Pick<CouncilConfig, 'matchup' | 'maxTurns' | 'repoPath'>>;
  getFrontmostApp?: () => CouncilTargetApp | null;
}

interface KickoffSession {
  id: string;
  filePath: string;
  displayTopic: string;
  returnTargetApp: CouncilTargetApp | null;
  process: ChildProcess;
  transcriptPath: string | null;
  consensusPath: string | null;
}

export class CouncilManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private state: CouncilState = 'idle';
  private currentRound = 0;
  private topic: string | null = null;
  private repoPath: string | null = null;
  private error: string | null = null;
  private matchup: CouncilMatchup = DEFAULT_COUNCIL_MATCHUP;
  private transcriptPath: string | null = null;
  private consensusPath: string | null = null;
  private source: CouncilStartSource = 'manual';
  private returnTargetApp: CouncilTargetApp | null = null;
  private handoffsDir: string | null = null;
  private killTimer: ReturnType<typeof setTimeout> | null = null;
  private kickoffWatcher: chokidar.FSWatcher | null = null;
  private readonly kickoffSessions = new Map<string, KickoffSession>();
  private stopRequested = false;
  private tokenUsage: CouncilTokenUsage = this.createEmptyTokenUsage();
  private spawnFn: typeof defaultSpawn;
  private execSyncFn: typeof defaultExecSync;
  private existsSyncFn: typeof fs.existsSync;
  private readFileSyncFn: typeof fs.readFileSync;
  private mkdirSyncFn: typeof fs.mkdirSync;
  private getKickoffDefaults: () => Partial<Pick<CouncilConfig, 'matchup' | 'maxTurns' | 'repoPath'>>;
  private getFrontmostApp: () => CouncilTargetApp | null;

  constructor(options: CouncilManagerOptions = {}) {
    super();
    this.spawnFn = options.spawnFn || defaultSpawn;
    this.execSyncFn = options.execSyncFn || defaultExecSync;
    this.existsSyncFn = options.existsSyncFn || fs.existsSync;
    this.readFileSyncFn = options.readFileSyncFn || fs.readFileSync;
    this.mkdirSyncFn = options.mkdirSyncFn || fs.mkdirSync;
    this.getKickoffDefaults = options.getKickoffDefaults || (() => ({}));
    this.getFrontmostApp = options.getFrontmostApp || (() => null);
  }

  /**
   * Resolve the path to council.sh — bundled as an app resource.
   */
  private getCouncilPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'council.sh');
    }
    return path.join(app.getAppPath(), 'scripts', 'council.sh');
  }

  /**
   * Set the handoffs directory where transcripts should be copied.
   * Called during initialization with commandsManager.getHandoffsDirectory().
   */
  setHandoffsDirectory(dir: string): void {
    this.handoffsDir = dir;
  }

  getPasteBackInfo(): {
    source: CouncilStartSource;
    returnTargetApp: CouncilTargetApp | null;
    transcriptPath: string | null;
    consensusPath: string | null;
  } {
    return {
      source: this.source,
      returnTargetApp: this.returnTargetApp,
      transcriptPath: this.transcriptPath,
      consensusPath: this.consensusPath,
    };
  }

  /**
   * Start a council debate.
   */
  async start(
    config: CouncilConfig & { source?: CouncilStartSource; returnTargetApp?: CouncilTargetApp | null }
  ): Promise<{ success: boolean; error?: string }> {
    if (this.process) {
      return { success: false, error: 'A debate is already running' };
    }

    const councilPath = this.getCouncilPath();
    const matchup = this.resolveMatchup(config);
    const readinessError = this.getLaunchReadinessError(councilPath, matchup);
    if (readinessError) {
      return { success: false, error: readinessError };
    }

    this.topic = config.topic;
    this.repoPath = config.repoPath ?? null;
    this.currentRound = 0;
    this.error = null;
    this.matchup = matchup;
    this.transcriptPath = null;
    this.consensusPath = null;
    this.source = config.source ?? 'manual';
    this.returnTargetApp = config.returnTargetApp ?? null;
    this.stopRequested = false;
    this.tokenUsage = this.createEmptyTokenUsage();
    this.setState('starting');

    const args = this.buildCouncilArgs({
      topic: config.topic,
      matchup,
      maxTurns: config.maxTurns,
      repoPath: config.repoPath ?? null,
    });

    log.info('Starting council debate: %s', config.topic);
    log.info('Args: %s %s', councilPath, args.join(' '));

    this.process = this.spawnFn('bash', [councilPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      detached: process.platform !== 'win32',
    });

    this.attachManualProcess(this.process);

    return { success: true };
  }

  /**
   * Stop a running debate.
   */
  stop(): void {
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
    if (this.process) {
      log.info('Stopping council debate');
      this.stopRequested = true;
      this.killProcessTreeForProcess(this.process, 'SIGTERM');
      // Give it a moment, then force kill
      this.killTimer = setTimeout(() => {
        this.killTimer = null;
        if (this.process) {
          this.killProcessTreeForProcess(this.process, 'SIGKILL');
          this.process = null;
        }
      }, 3000);
    }
  }

  stopKickoffSession(sessionId: string): boolean {
    const session = this.kickoffSessions.get(sessionId);
    if (!session) {
      return false;
    }

    log.info('Stopping kickoff council debate: %s', session.displayTopic);
    this.killProcessTreeForProcess(session.process, 'SIGTERM');
    return true;
  }

  /**
   * Get current status.
   */
  getStatus(): CouncilStatus {
    return {
      state: this.state,
      currentRound: this.currentRound,
      topic: this.topic,
      repoPath: this.repoPath,
      error: this.error,
      matchup: this.matchup,
      transcriptPath: this.transcriptPath,
      consensusPath: this.consensusPath,
      tokenUsage: { ...this.tokenUsage },
    };
  }

  /**
   * Handle a parsed NDJSON event from council.sh.
   */
  private handleEvent(event: CouncilEvent): void {
    switch (event.type) {
      case 'debate_start':
        if (event.matchup) {
          this.matchup = event.matchup;
        }
        this.setState('debating');
        break;

      case 'turn_start':
        if (event.round !== 'final') {
          this.currentRound = parseInt(event.round, 10) || this.currentRound;
        }
        break;

      case 'turn_end':
        this.accumulateTokenUsage(event);
        this.emit('statusChanged', this.getStatus());
        break;

      case 'state_change':
        if (event.to === 'FINALIZING') {
          this.setState('finalizing');
        }
        break;

      case 'pause_requested':
        this.setState('paused');
        break;

      case 'resume_started':
        this.setState('debating');
        break;

      case 'error':
        log.error('Council error from %s: %s', event.speaker, event.message);
        break;

      case 'transcript_written':
        this.transcriptPath = event.path;
        break;

      case 'consensus_written':
        this.consensusPath = event.path;
        break;

      case 'debate_complete':
        this.setState('done');
        break;
    }

    // Forward all events to renderer
    this.emit('event', event);
  }

  private setState(newState: CouncilState): void {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    log.info('Council state: %s -> %s', oldState, newState);
    this.emit('statusChanged', this.getStatus());
  }

  /**
   * Watch a directory for kickoff .md files. When one appears, read it and start a debate.
   */
  watchKickoffs(dir: string): void {
    // Ensure the directory exists
    this.mkdirSyncFn(dir, { recursive: true });

    this.kickoffWatcher = chokidar.watch('*.md', {
      cwd: dir,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 50 },
      depth: 0,
    });

    this.kickoffWatcher.on('add', (relativePath: string) => {
      const filePath = path.join(dir, relativePath);
      this.handleKickoff(filePath);
    });

    log.info('Watching for kickoff files in %s', dir);
  }

  /**
   * Handle a kickoff file: read it, extract topic, start debate.
   */
  async handleKickoff(filePath: string): Promise<void> {
    let content: string;
    try {
      content = this.readFileSyncFn(filePath, 'utf-8');
    } catch (err) {
      log.error('Failed to read kickoff file %s: %s', filePath, err);
      return;
    }

    if (!content.trim()) {
      log.info('Skipping empty kickoff file %s', filePath);
      return;
    }

    const kickoff = this.parseKickoff(content);

    log.info('Kickoff detected: %s (topic: %s)', filePath, kickoff.displayTopic);

    const defaultConfig = this.getKickoffDefaults();
    const result = await this.startKickoffSession({
      filePath,
      displayTopic: kickoff.displayTopic,
      topic: kickoff.topic,
      matchup: kickoff.config.matchup ?? defaultConfig.matchup,
      maxTurns: kickoff.config.maxTurns ?? defaultConfig.maxTurns,
      repoPath: kickoff.config.repoPath ?? defaultConfig.repoPath ?? null,
      returnTargetApp: this.getFrontmostApp(),
    });

    if (result.success) {
      this.emit('kickoffDetected', {
        filePath,
        displayTopic: kickoff.displayTopic,
        sessionId: result.sessionId,
      });
    } else {
      log.error('Failed to start debate from kickoff: %s', result.error);
    }
  }

  private resolveMatchup(config: CouncilConfig): CouncilMatchup {
    if (config.matchup) {
      return config.matchup;
    }
    if (config.opusVsOpus) {
      return 'opus-vs-opus';
    }
    return DEFAULT_COUNCIL_MATCHUP;
  }

  private matchupNeedsClaude(matchup: CouncilMatchup): boolean {
    return matchup.includes('opus') || matchup.includes('sonnet');
  }

  private matchupNeedsCodex(matchup: CouncilMatchup): boolean {
    return matchup.includes('codex');
  }

  private parseKickoff(content: string): {
    topic: string;
    displayTopic: string;
    config: Partial<Pick<CouncilConfig, 'matchup' | 'maxTurns' | 'repoPath'>>;
  } {
    const { body, frontmatter } = this.extractFrontmatter(content);
    const topic = body.trim() || content.trim();
    const lines = topic.split('\n');
    const displayTopic = lines.find((line) => line.trim())?.trim() || 'Council Debate';
    const config: Partial<Pick<CouncilConfig, 'matchup' | 'maxTurns' | 'repoPath'>> = {};

    if (isCouncilMatchup(frontmatter['matchup'])) {
      config.matchup = frontmatter['matchup'];
    }

    const maxTurnsRaw = frontmatter['max-turns'] ?? frontmatter['max_turns'];
    if (maxTurnsRaw && /^-?\d+$/.test(maxTurnsRaw)) {
      config.maxTurns = parseInt(maxTurnsRaw, 10);
    }

    const repoPath = frontmatter['repo-path'] ?? frontmatter['repo_path'];
    if (repoPath) {
      config.repoPath = repoPath;
    }

    return { topic, displayTopic, config };
  }

  private extractFrontmatter(content: string): {
    body: string;
    frontmatter: Record<string, string>;
  } {
    const lines = content.split(/\r?\n/);
    if (lines[0]?.trim() !== '---') {
      return { body: content, frontmatter: {} };
    }

    const frontmatter: Record<string, string> = {};
    let index = 1;
    for (; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() === '---') {
        index += 1;
        return {
          body: lines.slice(index).join('\n'),
          frontmatter,
        };
      }

      const match = line.match(/^([a-z0-9_-]+):\s*(.*)$/i);
      if (match) {
        frontmatter[match[1].toLowerCase()] = match[2].trim();
      }
    }

    return { body: content, frontmatter: {} };
  }
  /**
   * Clean up on app quit. Force-kills immediately rather than waiting for SIGTERM grace period.
   */
  destroy(): void {
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
    if (this.kickoffWatcher) {
      this.kickoffWatcher.close();
      this.kickoffWatcher = null;
    }
    if (this.process) {
      this.killProcessTreeForProcess(this.process, 'SIGKILL');
      this.process = null;
    }
    for (const session of this.kickoffSessions.values()) {
      this.killProcessTreeForProcess(session.process, 'SIGKILL');
    }
    this.kickoffSessions.clear();
    this.removeAllListeners();
  }

  private getLaunchReadinessError(councilPath: string, matchup: CouncilMatchup): string | null {
    if (!this.existsSyncFn(councilPath)) {
      return `council.sh not found at ${councilPath}`;
    }

    if (this.matchupNeedsClaude(matchup)) {
      try {
        this.execSyncFn('which claude', { stdio: 'ignore' });
      } catch {
        return 'claude CLI not found on PATH';
      }
    }

    if (this.matchupNeedsCodex(matchup)) {
      try {
        this.execSyncFn('which codex', { stdio: 'ignore' });
      } catch {
        return 'codex CLI not found on PATH for the selected matchup.';
      }
    }

    return null;
  }

  private buildCouncilArgs(config: {
    topic: string;
    matchup: CouncilMatchup;
    maxTurns?: number;
    repoPath?: string | null;
  }): string[] {
    const args = ['--json-events', '--matchup', config.matchup];
    if (config.maxTurns != null) {
      args.push('--max-turns', String(config.maxTurns));
    }
    if (config.repoPath) {
      args.push('--repo', config.repoPath);
    }
    if (this.handoffsDir) {
      args.push('--transcript-dir', this.handoffsDir);
    }
    args.push(config.topic);
    return args;
  }

  private attachManualProcess(process: ChildProcess): void {
    let buffer = '';

    process.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as CouncilEvent;
          this.handleEvent(event);
        } catch {
          log.warn('Non-JSON stdout: %s', line.substring(0, 200));
        }
      }
    });

    process.stderr?.on('data', (data: Buffer) => {
      log.warn('council stderr: %s', data.toString().trim());
    });

    process.on('close', (code) => {
      log.info('Council process exited with code %d', code);
      if (this.killTimer) {
        clearTimeout(this.killTimer);
        this.killTimer = null;
      }
      this.process = null;

      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim()) as CouncilEvent;
          this.handleEvent(event);
        } catch {
          // ignore
        }
      }

      if (this.stopRequested) {
        this.stopRequested = false;
        this.error = 'Debate stopped by user';
        this.setState('error');
        return;
      }

      if (code === 42 && this.state === 'paused') {
        return;
      }

      if (this.state !== 'done' && this.state !== 'error') {
        if (code === 0) {
          this.setState('done');
        } else {
          this.error = `Process exited with code ${code}`;
          this.setState('error');
        }
      }
    });

    process.on('error', (err) => {
      log.error('Council process error:', err);
      this.process = null;
      this.error = err.message;
      this.setState('error');
    });
  }

  private async startKickoffSession(config: {
    filePath: string;
    displayTopic: string;
    topic: string;
    matchup?: CouncilMatchup;
    maxTurns?: number;
    repoPath?: string | null;
    returnTargetApp: CouncilTargetApp | null;
  }): Promise<{ success: boolean; sessionId?: string; error?: string }> {
    const councilPath = this.getCouncilPath();
    const matchup = config.matchup ?? DEFAULT_COUNCIL_MATCHUP;
    const readinessError = this.getLaunchReadinessError(councilPath, matchup);
    if (readinessError) {
      return { success: false, error: readinessError };
    }

    const args = this.buildCouncilArgs({
      topic: config.topic,
      matchup,
      maxTurns: config.maxTurns,
      repoPath: config.repoPath,
    });

    log.info('Starting kickoff council debate: %s', config.displayTopic);
    log.info('Kickoff args: %s %s', councilPath, args.join(' '));

    const child = this.spawnFn('bash', [councilPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      detached: process.platform !== 'win32',
    });
    const sessionId = crypto.randomUUID().substring(0, 12);
    const session: KickoffSession = {
      id: sessionId,
      filePath: config.filePath,
      displayTopic: config.displayTopic,
      returnTargetApp: config.returnTargetApp,
      process: child,
      transcriptPath: null,
      consensusPath: null,
    };
    this.kickoffSessions.set(sessionId, session);
    this.attachKickoffProcess(session, matchup);

    return { success: true, sessionId };
  }

  private attachKickoffProcess(session: KickoffSession, matchup: CouncilMatchup): void {
    let buffer = '';

    session.process.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as CouncilEvent;
          this.handleKickoffSessionEvent(session, matchup, event);
        } catch {
          log.warn('Non-JSON kickoff stdout (%s): %s', session.id, line.substring(0, 200));
        }
      }
    });

    session.process.stderr?.on('data', (data: Buffer) => {
      log.warn('kickoff council stderr (%s): %s', session.id, data.toString().trim());
    });

    session.process.on('close', (code) => {
      this.kickoffSessions.delete(session.id);

      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim()) as CouncilEvent;
          this.handleKickoffSessionEvent(session, matchup, event);
        } catch {
          // ignore
        }
      }

      this.emit('kickoffSessionExited', {
        sessionId: session.id,
        filePath: session.filePath,
        displayTopic: session.displayTopic,
        code: code ?? null,
        transcriptPath: session.transcriptPath,
        consensusPath: session.consensusPath,
      });
    });

    session.process.on('error', (error) => {
      this.kickoffSessions.delete(session.id);
      log.error('Kickoff council process error (%s): %s', session.id, error);
      this.emit('kickoffSessionError', {
        sessionId: session.id,
        filePath: session.filePath,
        displayTopic: session.displayTopic,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private handleKickoffSessionEvent(
    session: KickoffSession,
    matchup: CouncilMatchup,
    event: CouncilEvent,
  ): void {
    switch (event.type) {
      case 'transcript_written':
        session.transcriptPath = event.path;
        break;
      case 'consensus_written':
        session.consensusPath = event.path;
        this.emit('kickoffConsensusWritten', {
          sessionId: session.id,
          filePath: session.filePath,
          displayTopic: session.displayTopic,
          path: event.path,
          returnTargetApp: session.returnTargetApp,
        });
        break;
      case 'debate_complete':
        this.emit('kickoffDebateComplete', {
          sessionId: session.id,
          filePath: session.filePath,
          displayTopic: session.displayTopic,
          transcriptPath: session.transcriptPath,
          consensusPath: session.consensusPath,
        });
        break;
    }

    this.emit('kickoffEvent', {
      sessionId: session.id,
      filePath: session.filePath,
      displayTopic: session.displayTopic,
      matchup,
      event,
    });
  }

  private killProcessTreeForProcess(child: ChildProcess, signal: NodeJS.Signals): void {
    if (!child) {
      return;
    }

    const pid = child.pid;
    if (pid && process.platform !== 'win32') {
      try {
        process.kill(-pid, signal);
        return;
      } catch (err) {
        log.warn('Failed to signal council process group %d with %s: %s', pid, signal, err);
      }
    }

    try {
      child.kill(signal);
    } catch (err) {
      log.warn('Failed to signal council process with %s: %s', signal, err);
    }
  }

  private createEmptyTokenUsage(): CouncilTokenUsage {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    };
  }

  private accumulateTokenUsage(event: Extract<CouncilEvent, { type: 'turn_end' }>): void {
    const inputTokens = this.parseTokenCount(event.inputTokens);
    const outputTokens = this.parseTokenCount(event.outputTokens);
    const totalTokens = this.parseTokenCount(event.totalTokens);

    this.tokenUsage = {
      inputTokens: this.sumTokenCounts(this.tokenUsage.inputTokens, inputTokens),
      outputTokens: this.sumTokenCounts(this.tokenUsage.outputTokens, outputTokens),
      totalTokens: this.sumTokenCounts(this.tokenUsage.totalTokens, totalTokens),
    };
  }

  private parseTokenCount(value: string | undefined): number | null {
    if (!value) {
      return null;
    }
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private sumTokenCounts(current: number | null, next: number | null): number | null {
    if (next == null) {
      return current;
    }
    return (current ?? 0) + next;
  }
}
