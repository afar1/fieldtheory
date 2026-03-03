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
import { app } from 'electron';
import chokidar from 'chokidar';
import { createLogger } from './logger';
import type { CouncilConfig, CouncilState, CouncilStatus, CouncilEvent } from './types/council';

const log = createLogger('Council');

export interface CouncilManagerOptions {
  spawnFn?: typeof defaultSpawn;
  execSyncFn?: typeof defaultExecSync;
  existsSyncFn?: typeof fs.existsSync;
  readFileSyncFn?: typeof fs.readFileSync;
  mkdirSyncFn?: typeof fs.mkdirSync;
}

export class CouncilManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private state: CouncilState = 'idle';
  private currentRound = 0;
  private topic: string | null = null;
  private error: string | null = null;
  private handoffsDir: string | null = null;
  private killTimer: ReturnType<typeof setTimeout> | null = null;
  private kickoffWatcher: chokidar.FSWatcher | null = null;
  private spawnFn: typeof defaultSpawn;
  private execSyncFn: typeof defaultExecSync;
  private existsSyncFn: typeof fs.existsSync;
  private readFileSyncFn: typeof fs.readFileSync;
  private mkdirSyncFn: typeof fs.mkdirSync;

  constructor(options: CouncilManagerOptions = {}) {
    super();
    this.spawnFn = options.spawnFn || defaultSpawn;
    this.execSyncFn = options.execSyncFn || defaultExecSync;
    this.existsSyncFn = options.existsSyncFn || fs.existsSync;
    this.readFileSyncFn = options.readFileSyncFn || fs.readFileSync;
    this.mkdirSyncFn = options.mkdirSyncFn || fs.mkdirSync;
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

  /**
   * Start a council debate.
   */
  async start(config: CouncilConfig): Promise<{ success: boolean; error?: string }> {
    if (this.process) {
      return { success: false, error: 'A debate is already running' };
    }

    // Check that council.sh exists
    const councilPath = this.getCouncilPath();
    if (!this.existsSyncFn(councilPath)) {
      return { success: false, error: `council.sh not found at ${councilPath}` };
    }

    // Check that claude CLI is available
    try {
      this.execSyncFn('which claude', { stdio: 'ignore' });
    } catch {
      return { success: false, error: 'claude CLI not found on PATH' };
    }

    // Check codex CLI if not opus-vs-opus
    if (!config.opusVsOpus) {
      try {
        this.execSyncFn('which codex', { stdio: 'ignore' });
      } catch {
        return { success: false, error: 'codex CLI not found on PATH. Enable Opus vs Opus mode or install codex.' };
      }
    }

    this.topic = config.topic;
    this.currentRound = 0;
    this.error = null;
    this.setState('starting');

    // Build args
    const args = ['--json-events'];
    if (config.maxTurns != null) {
      args.push('--max-turns', String(config.maxTurns));
    }
    if (config.opusVsOpus) {
      args.push('--opus-vs-opus');
    }
    if (config.repoPath) {
      args.push('--repo', config.repoPath);
    }
    if (this.handoffsDir) {
      args.push('--transcript-dir', this.handoffsDir);
    }
    args.push(config.topic);

    log.info('Starting council debate: %s', config.topic);
    log.info('Args: %s %s', councilPath, args.join(' '));

    // Spawn with user's shell PATH
    this.process = this.spawnFn('bash', [councilPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    // NDJSON parsing on stdout (buffer-split pattern)
    let buffer = '';
    this.process.stdout?.on('data', (data: Buffer) => {
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

    // Log stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      log.warn('council stderr: %s', data.toString().trim());
    });

    this.process.on('close', (code) => {
      log.info('Council process exited with code %d', code);
      this.process = null;

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim()) as CouncilEvent;
          this.handleEvent(event);
        } catch {
          // ignore
        }
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

    this.process.on('error', (err) => {
      log.error('Council process error:', err);
      this.process = null;
      this.error = err.message;
      this.setState('error');
    });

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
      this.process.kill('SIGTERM');
      // Give it a moment, then force kill
      this.killTimer = setTimeout(() => {
        this.killTimer = null;
        if (this.process) {
          this.process.kill('SIGKILL');
          this.process = null;
        }
      }, 3000);
    }
  }

  /**
   * Get current status.
   */
  getStatus(): CouncilStatus {
    return {
      state: this.state,
      currentRound: this.currentRound,
      topic: this.topic,
      error: this.error,
    };
  }

  /**
   * Handle a parsed NDJSON event from council.sh.
   */
  private handleEvent(event: CouncilEvent): void {
    switch (event.type) {
      case 'debate_start':
        this.setState('debating');
        break;

      case 'turn_start':
        if (event.round !== 'final') {
          this.currentRound = parseInt(event.round, 10) || this.currentRound;
        }
        break;

      case 'state_change':
        if (event.to === 'FINALIZING') {
          this.setState('finalizing');
        }
        break;

      case 'error':
        log.error('Council error from %s: %s', event.speaker, event.message);
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
    if (this.process) {
      log.info('Skipping kickoff %s — debate already running', filePath);
      return;
    }

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

    // First non-empty line is the display topic
    const lines = content.split('\n');
    const displayTopic = lines.find(l => l.trim())?.trim() || 'Council Debate';

    log.info('Kickoff detected: %s (topic: %s)', filePath, displayTopic);

    const result = await this.start({ topic: content, opusVsOpus: true });

    if (result.success) {
      // Override topic with display-friendly first line (start() sets it to full content)
      this.topic = displayTopic;
      this.emit('kickoffDetected', { filePath, displayTopic });
    } else {
      log.error('Failed to start debate from kickoff: %s', result.error);
    }
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
      this.process.kill('SIGKILL');
      this.process = null;
    }
    this.removeAllListeners();
  }
}
