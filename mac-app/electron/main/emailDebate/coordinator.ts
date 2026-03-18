/**
 * EmailDebateCoordinator — runs local council.sh debates and mirrors them into
 * email threads via EmailDebateManager.
 *
 * This is the multi-session local runner for v1. It intentionally sits outside
 * the existing CouncilManager so multiple debates can run at once.
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import { spawn as defaultSpawn, type ChildProcess } from 'child_process';
import type { CouncilEvent } from '../types/council';
import { createLogger } from '../logger';
import { EmailDebateManager, type CreateThreadOptions } from './manager';

const log = createLogger('EmailDebateCoordinator');

export interface StartEmailDebateOptions extends CreateThreadOptions {
  transcriptDir?: string;
}

export interface EmailDebateCoordinatorOptions {
  councilPath: string;
  emailManager: EmailDebateManager;
  spawnFn?: typeof defaultSpawn;
  existsSyncFn?: typeof fs.existsSync;
}

export class EmailDebateCoordinator extends EventEmitter {
  private readonly councilPath: string;
  private readonly emailManager: EmailDebateManager;
  private readonly spawnFn: typeof defaultSpawn;
  private readonly existsSyncFn: typeof fs.existsSync;
  private readonly processes = new Map<string, ChildProcess>();

  constructor(options: EmailDebateCoordinatorOptions) {
    super();
    this.councilPath = options.councilPath;
    this.emailManager = options.emailManager;
    this.spawnFn = options.spawnFn ?? defaultSpawn;
    this.existsSyncFn = options.existsSyncFn ?? fs.existsSync;
  }

  startDebate(options: StartEmailDebateOptions): { threadId: string } {
    if (!this.existsSyncFn(this.councilPath)) {
      throw new Error(`council.sh not found at ${this.councilPath}`);
    }

    const thread = this.emailManager.createThread(options);
    const args = ['--json-events', '--matchup', options.matchup];

    if (options.maxTurns != null) {
      args.push('--max-turns', String(options.maxTurns));
    }
    if (options.repoPath) {
      args.push('--repo', options.repoPath);
    }
    if (options.transcriptDir) {
      args.push('--transcript-dir', options.transcriptDir);
    }
    args.push(options.topic);

    const child = this.spawnFn('bash', [this.councilPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      detached: process.platform !== 'win32',
    });

    this.processes.set(thread.id, child);
    this.attachProcess(thread.id, child);
    this.emit('debate_started', { threadId: thread.id, args: [this.councilPath, ...args] });
    return { threadId: thread.id };
  }

  stopDebate(threadId: string): boolean {
    const child = this.processes.get(threadId);
    if (!child) {
      return false;
    }

    child.kill('SIGTERM');
    this.processes.delete(threadId);
    this.emit('debate_stopped', { threadId });
    return true;
  }

  getActiveThreadIds(): string[] {
    return [...this.processes.keys()];
  }

  destroy(): void {
    for (const [threadId, child] of this.processes) {
      child.kill('SIGTERM');
      this.emit('debate_stopped', { threadId });
    }
    this.processes.clear();
    this.removeAllListeners();
  }

  private attachProcess(threadId: string, child: ChildProcess): void {
    let buffer = '';

    child.stdout?.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        try {
          const event = JSON.parse(line) as CouncilEvent;
          void this.forwardCouncilEvent(threadId, event);
        } catch {
          log.warn('Non-JSON stdout for %s: %s', threadId, line.substring(0, 200));
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const content = chunk.toString().trim();
      if (!content) {
        return;
      }

      this.emit('stderr', { threadId, content });
    });

    child.on('error', (error) => {
      this.processes.delete(threadId);
      log.error('Debate process error for %s: %s', threadId, error);
      this.emit('debate_error', {
        threadId,
        message: error instanceof Error ? error.message : String(error),
      });
    });

    child.on('close', (code) => {
      this.processes.delete(threadId);

      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim()) as CouncilEvent;
          void this.forwardCouncilEvent(threadId, event);
        } catch {
          // Ignore trailing non-JSON content.
        }
      }

      this.emit('debate_exited', { threadId, code: code ?? null });
    });
  }

  private async forwardCouncilEvent(threadId: string, event: CouncilEvent): Promise<void> {
    try {
      await this.emailManager.handleCouncilEvent(threadId, event);
      this.emit('council_event', { threadId, event });
    } catch (error) {
      log.error('Failed handling council event for %s: %s', threadId, error);
      this.emit('debate_error', {
        threadId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
