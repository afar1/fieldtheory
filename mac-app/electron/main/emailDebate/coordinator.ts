/**
 * EmailDebateCoordinator — runs local council.sh debates and mirrors them into
 * email threads via EmailDebateManager.
 *
 * This is the multi-session local runner for v1. It intentionally sits outside
 * the existing CouncilManager so multiple debates can run at once.
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { spawn as defaultSpawn, type ChildProcess } from 'child_process';
import type { CouncilEvent } from '../types/council';
import { createLogger } from '../logger';
import {
  EmailDebateManager,
  type CreateThreadOptions,
  type DeferredTurnDelivery,
} from './manager';
import type { EmailThread, EmailThreadMessage } from './types';

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
  private readonly stoppingThreadIds = new Set<string>();
  private readonly deferredRestarts = new Map<
    string,
    { body: string; preferredStarterSpeaker: string }
  >();

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

  startThread(threadId: string): { success: boolean; error?: string } {
    if (this.processes.has(threadId) || this.stoppingThreadIds.has(threadId) || this.deferredRestarts.has(threadId)) {
      return { success: false, error: `Debate already running for thread ${threadId}` };
    }

    const thread = this.emailManager.getThread(threadId);
    if (!thread) {
      return { success: false, error: `Unknown email debate thread: ${threadId}` };
    }

    const args = ['--json-events', '--matchup', thread.matchup];
    if (thread.maxTurns != null) {
      args.push('--max-turns', String(thread.maxTurns));
    }
    if (thread.repoPath) {
      args.push('--repo', thread.repoPath);
    }
    if (thread.transcriptPath) {
      args.push('--transcript-dir', path.dirname(thread.transcriptPath));
    }
    if (thread.preferredStartSide) {
      args.push('--start-side', thread.preferredStartSide);
    }
    args.push(thread.topic);

    this.launchThreadProcess(threadId, args);
    this.emit('debate_started', { threadId, args: [this.councilPath, ...args] });
    return { success: true };
  }

  handleHumanReply(
    threadId: string,
    humanInput: string,
    options?: { preferredStarterSpeaker?: string },
  ): { success: boolean; mode?: 'resume' | 'follow_up'; error?: string } {
    if (this.processes.has(threadId) || this.stoppingThreadIds.has(threadId) || this.deferredRestarts.has(threadId)) {
      return { success: false, error: `Debate already running for thread ${threadId}` };
    }

    const thread = this.emailManager.getThread(threadId);
    if (!thread) {
      return { success: false, error: `Unknown email debate thread: ${threadId}` };
    }

    if (thread.resumeStatePath) {
      this.launchThreadProcess(threadId, this.buildResumeArgs(thread, humanInput));
      this.emit('debate_resumed', { threadId, resumeStatePath: thread.resumeStatePath });
      return { success: true, mode: 'resume' };
    }

    this.launchThreadProcess(
      threadId,
      this.buildFollowUpArgs(thread, humanInput, options?.preferredStarterSpeaker)
    );
    this.emit('debate_follow_up_started', { threadId });
    return { success: true, mode: 'follow_up' };
  }

  stopDebate(threadId: string): boolean {
    const child = this.processes.get(threadId);
    if (!child) {
      return false;
    }

    this.stoppingThreadIds.add(threadId);
    child.kill('SIGTERM');
    this.emit('debate_stopped', { threadId });
    return true;
  }

  getActiveThreadIds(): string[] {
    return [...this.processes.keys()];
  }

  destroy(): void {
    for (const [threadId, child] of this.processes) {
      this.stoppingThreadIds.add(threadId);
      child.kill('SIGTERM');
      this.emit('debate_stopped', { threadId });
    }
    this.processes.clear();
    this.stoppingThreadIds.clear();
    this.deferredRestarts.clear();
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
      this.stoppingThreadIds.delete(threadId);
      log.error('Debate process error for %s: %s', threadId, error);
      this.emit('debate_error', {
        threadId,
        message: error instanceof Error ? error.message : String(error),
      });
    });

    child.on('close', (code) => {
      void this.handleProcessClose(threadId, code, buffer);
    });
  }

  private async forwardCouncilEvent(threadId: string, event: CouncilEvent): Promise<void> {
    try {
      const result = await this.emailManager.handleCouncilEvent(threadId, event);
      this.emit('council_event', { threadId, event });

      if (result.deferredTurn) {
        this.deferThreadForHumanReply(threadId, result.deferredTurn);
      }
    } catch (error) {
      log.error('Failed handling council event for %s: %s', threadId, error);
      this.emit('debate_error', {
        threadId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleProcessClose(
    threadId: string,
    code: number | null,
    trailingBuffer: string,
  ): Promise<void> {
    this.processes.delete(threadId);
    this.stoppingThreadIds.delete(threadId);

    if (trailingBuffer.trim()) {
      try {
        const event = JSON.parse(trailingBuffer.trim()) as CouncilEvent;
        await this.forwardCouncilEvent(threadId, event);
      } catch {
        // Ignore trailing non-JSON content.
      }
    }

    const deferredRestart = this.deferredRestarts.get(threadId);
    if (deferredRestart) {
      this.deferredRestarts.delete(threadId);
      const result = this.handleHumanReply(threadId, deferredRestart.body, {
        preferredStarterSpeaker: deferredRestart.preferredStarterSpeaker,
      });
      if (!result.success) {
        this.emit('debate_error', {
          threadId,
          message: result.error ?? 'Failed restarting deferred debate thread',
        });
      }
    }

    const pendingReply = this.emailManager.getPendingHumanReply(threadId);
    const thread = this.emailManager.getThread(threadId);
    const shouldResumePendingReply =
      Boolean(pendingReply) && (code === 42 || thread?.status === 'concluded');

    if (pendingReply && shouldResumePendingReply) {
      const result = this.handleHumanReply(threadId, pendingReply.body);
      if (!result.success) {
        this.emit('debate_error', {
          threadId,
          message: result.error ?? 'Failed restarting debate thread with pending human reply',
        });
      }
    }

    this.emit('debate_exited', { threadId, code: code ?? null });
  }

  private launchThreadProcess(threadId: string, args: string[]): void {
    if (!this.existsSyncFn(this.councilPath)) {
      throw new Error(`council.sh not found at ${this.councilPath}`);
    }

    const child = this.spawnFn('bash', [this.councilPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      detached: process.platform !== 'win32',
    });

    this.processes.set(threadId, child);
    this.attachProcess(threadId, child);
  }

  private buildResumeArgs(thread: EmailThread, humanInput: string): string[] {
    const args = ['--json-events', '--resume-state', thread.resumeStatePath ?? ''];
    const trimmedInput = humanInput.trim();
    if (trimmedInput) {
      args.push('--human-input', trimmedInput);
    }
    return args;
  }

  private buildFollowUpArgs(
    thread: EmailThread,
    humanInput: string,
    preferredStarterSpeaker?: string,
  ): string[] {
    const args = ['--json-events', '--matchup', thread.matchup];

    if (thread.maxTurns != null) {
      args.push('--max-turns', String(thread.maxTurns));
    }
    if (thread.repoPath) {
      args.push('--repo', thread.repoPath);
    }
    if (thread.transcriptPath) {
      args.push('--transcript-dir', path.dirname(thread.transcriptPath));
    }
    const preferredStartSide = this.resolvePreferredStartSide(thread, preferredStarterSpeaker);
    if (preferredStartSide) {
      args.push('--start-side', preferredStartSide);
    }

    args.push(this.buildFollowUpTopic(thread, humanInput));
    return args;
  }

  private buildFollowUpTopic(thread: EmailThread, humanInput: string): string {
    const recentMessages = thread.messages.slice(-8).map((message) => this.formatThreadMessage(message));
    const sections = [
      'Continue this email thread between the same collaborators.',
      'Carry forward the prior discussion unless the human explicitly redirects it.',
      'Pick the conversation back up naturally instead of restarting from scratch.',
      '',
      `Original topic:\n${thread.topic}`,
      '',
      `Matchup: ${thread.matchup}`,
      thread.maxTurns != null ? `Max turns: ${thread.maxTurns}` : null,
      thread.repoPath ? `Repo: ${thread.repoPath}` : null,
      recentMessages.length > 0 ? `Recent thread context:\n${recentMessages.join('\n\n---\n\n')}` : null,
      '',
      `New human reply:\n${humanInput.trim() || '[No additional guidance provided]'}`,
    ].filter(Boolean);

    return sections.join('\n');
  }

  private formatThreadMessage(message: EmailThreadMessage): string {
    const body = this.stripTransportSignature(message.body.replace(/\r\n/g, '\n').trim());
    const trimmedBody =
      body.length > 2_000
        ? `${body.slice(0, 2_000).trimEnd()}\n[Message truncated for follow-up context]`
        : body;

    return `[${message.fromName} | ${message.sentAt}]\n${trimmedBody}`;
  }

  private stripTransportSignature(body: string): string {
    return body
      .replace(/\n--\n[\s\S]*?\nReply to this email to continue the debate\.\s*$/u, '')
      .trim();
  }

  private deferThreadForHumanReply(threadId: string, deferredTurn: DeferredTurnDelivery): void {
    if (!this.processes.has(threadId) || this.deferredRestarts.has(threadId)) {
      return;
    }

    this.deferredRestarts.set(threadId, {
      body: deferredTurn.humanBody,
      preferredStarterSpeaker: deferredTurn.speaker,
    });
    this.stopDebate(threadId);
  }

  private resolvePreferredStartSide(
    thread: EmailThread,
    preferredStarterSpeaker?: string,
  ): 'a' | 'b' | null {
    if (!preferredStarterSpeaker) {
      return null;
    }

    const normalizedSpeaker = preferredStarterSpeaker.trim().toLowerCase();
    if (normalizedSpeaker.endsWith(' a')) {
      return 'a';
    }
    if (normalizedSpeaker.endsWith(' b')) {
      return 'b';
    }

    const [leftModel, rightModel] = thread.matchup.split('-vs-');
    const normalizedModel =
      normalizedSpeaker.includes('codex')
        ? 'codex'
        : normalizedSpeaker.includes('sonnet')
          ? 'sonnet'
          : normalizedSpeaker.includes('opus')
            ? 'opus'
            : null;

    if (!normalizedModel) {
      return null;
    }
    if (normalizedModel === leftModel && normalizedModel !== rightModel) {
      return 'a';
    }
    if (normalizedModel === rightModel && normalizedModel !== leftModel) {
      return 'b';
    }

    return null;
  }
}
