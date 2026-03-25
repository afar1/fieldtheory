/**
 * ThreadStore — Persists email debate threads to disk.
 *
 * Each thread gets a JSON file in a single directory. The v1 store is file
 * based on purpose so local-machine development stays simple and inspectable.
 */

import fs from 'fs';
import path from 'path';
import { createLogger } from '../logger';
import {
  createEmptyEmailThreadTokenUsage,
  type EmailDebateThreadStatus,
  type EmailThread,
  type EmailThreadMessage,
  type EmailThreadTokenUsage,
  type EmailThreadTurnTokenUsage,
} from './types';

const log = createLogger('ThreadStore');

export class ThreadStore {
  private readonly threadsDir: string;

  constructor(baseDir?: string) {
    this.threadsDir =
      baseDir ?? path.join(process.env.HOME || '~', '.fieldtheory', 'council', 'threads');
    this.ensureDir();
  }

  private ensureDir(): void {
    try {
      fs.mkdirSync(this.threadsDir, { recursive: true });
    } catch (error) {
      log.error('Failed to create threads directory: %s', error);
    }
  }

  private threadPath(threadId: string): string {
    return path.join(this.threadsDir, `${threadId}.json`);
  }

  save(thread: EmailThread): void {
    const persisted: EmailThread = {
      ...this.normalizeThread(thread),
      updatedAt: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(this.threadPath(thread.id), JSON.stringify(persisted, null, 2), 'utf-8');
    } catch (error) {
      log.error('Failed to save thread %s: %s', thread.id, error);
    }
  }

  load(threadId: string): EmailThread | null {
    try {
      const raw = fs.readFileSync(this.threadPath(threadId), 'utf-8');
      return this.normalizeThread(JSON.parse(raw) as EmailThread);
    } catch {
      return null;
    }
  }

  list(): EmailThread[] {
    try {
      const files = fs.readdirSync(this.threadsDir).filter((file) => file.endsWith('.json'));

      return files
        .map((file) => {
          try {
            const raw = fs.readFileSync(path.join(this.threadsDir, file), 'utf-8');
            return this.normalizeThread(JSON.parse(raw) as EmailThread);
          } catch {
            return null;
          }
        })
        .filter((thread): thread is EmailThread => thread !== null)
        .sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
    } catch {
      return [];
    }
  }

  listActive(): EmailThread[] {
    return this.list().filter((thread) => thread.status === 'active');
  }

  listReplyable(): EmailThread[] {
    return this.list().filter((thread) => thread.status !== 'closed');
  }

  addMessage(threadId: string, message: EmailThreadMessage): EmailThread | null {
    const thread = this.load(threadId);
    if (!thread) {
      return null;
    }

    thread.messages.push(message);

    for (const address of message.to) {
      if (!thread.participants.includes(address)) {
        thread.participants.push(address);
      }
    }

    if (!thread.participants.includes(message.from)) {
      thread.participants.push(message.from);
    }

    if (message.turnNumber != null) {
      thread.modelTurnCount = Math.max(thread.modelTurnCount, message.turnNumber);
    }

    this.save(thread);
    return thread;
  }

  recordTokenUsage(threadId: string, tokenUsage: EmailThreadTurnTokenUsage | null): EmailThread | null {
    const thread = this.load(threadId);
    if (!thread) {
      return null;
    }

    if (!tokenUsage || !this.hasAnyTokenCounts(tokenUsage)) {
      return thread;
    }

    thread.tokenUsage = {
      inputTokens: this.sumTokenCounts(thread.tokenUsage.inputTokens, tokenUsage.inputTokens),
      outputTokens: this.sumTokenCounts(thread.tokenUsage.outputTokens, tokenUsage.outputTokens),
      totalTokens: this.sumTokenCounts(thread.tokenUsage.totalTokens, tokenUsage.totalTokens),
      turnsWithUsage: thread.tokenUsage.turnsWithUsage + 1,
    };

    this.save(thread);
    return thread;
  }

  setStatus(threadId: string, status: EmailDebateThreadStatus): EmailThread | null {
    const thread = this.load(threadId);
    if (!thread) {
      return null;
    }

    thread.status = status;
    this.save(thread);
    return thread;
  }

  setTranscriptPath(threadId: string, transcriptPath: string): void {
    const thread = this.load(threadId);
    if (!thread) {
      return;
    }

    thread.transcriptPath = transcriptPath;
    this.save(thread);
  }

  setConsensusPath(threadId: string, consensusPath: string): void {
    const thread = this.load(threadId);
    if (!thread) {
      return;
    }

    thread.consensusPath = consensusPath;
    this.save(thread);
  }

  setProviderThreadId(threadId: string, providerThreadId: string): void {
    const thread = this.load(threadId);
    if (!thread) {
      return;
    }

    thread.providerThreadId = providerThreadId;
    this.save(thread);
  }

  setResumeStatePath(threadId: string, resumeStatePath: string | null): void {
    const thread = this.load(threadId);
    if (!thread) {
      return;
    }

    thread.resumeStatePath = resumeStatePath;
    this.save(thread);
  }

  setLastInjectedHumanMessageId(threadId: string, messageId: string | null): void {
    const thread = this.load(threadId);
    if (!thread) {
      return;
    }

    thread.lastInjectedHumanMessageId = messageId;
    this.save(thread);
  }

  getAllKnownMessageIds(): Set<string> {
    const ids = new Set<string>();

    for (const thread of this.listReplyable()) {
      for (const message of thread.messages) {
        ids.add(message.messageId);
      }
    }

    return ids;
  }

  getReplyableRootMessageIds(): string[] {
    return this.listReplyable().map((thread) => thread.rootMessageId);
  }

  getReplyableTrackedMessageIds(): string[] {
    const ids = new Set<string>();

    for (const thread of this.listReplyable()) {
      ids.add(thread.rootMessageId);
      for (const message of thread.messages) {
        ids.add(message.messageId);
      }
    }

    return [...ids];
  }

  findThreadByReference(references: string[]): EmailThread | null {
    for (const thread of this.listReplyable()) {
      if (references.includes(thread.rootMessageId)) {
        return thread;
      }

      for (const message of thread.messages) {
        if (references.includes(message.messageId)) {
          return thread;
        }
      }
    }

    return null;
  }

  findThreadByProviderThreadId(providerThreadId: string): EmailThread | null {
    return this.listReplyable().find((thread) => thread.providerThreadId === providerThreadId) ?? null;
  }

  private normalizeThread(thread: EmailThread): EmailThread {
    return {
      ...thread,
      messages: (thread.messages ?? []).map((message) => this.normalizeMessage(message)),
      tokenUsage: this.normalizeThreadTokenUsage(thread.tokenUsage),
    };
  }

  private normalizeMessage(message: EmailThreadMessage): EmailThreadMessage {
    return {
      ...message,
      tokenUsage: this.normalizeTurnTokenUsage(message.tokenUsage),
    };
  }

  private normalizeThreadTokenUsage(
    tokenUsage: Partial<EmailThreadTokenUsage> | null | undefined
  ): EmailThreadTokenUsage {
    const empty = createEmptyEmailThreadTokenUsage();
    return {
      inputTokens: this.normalizeTokenCount(tokenUsage?.inputTokens),
      outputTokens: this.normalizeTokenCount(tokenUsage?.outputTokens),
      totalTokens: this.normalizeTokenCount(tokenUsage?.totalTokens),
      turnsWithUsage:
        typeof tokenUsage?.turnsWithUsage === 'number' && Number.isFinite(tokenUsage.turnsWithUsage)
          ? tokenUsage.turnsWithUsage
          : empty.turnsWithUsage,
    };
  }

  private normalizeTurnTokenUsage(
    tokenUsage: Partial<EmailThreadTurnTokenUsage> | null | undefined
  ): EmailThreadTurnTokenUsage | null {
    if (!tokenUsage) {
      return null;
    }

    const normalized: EmailThreadTurnTokenUsage = {
      inputTokens: this.normalizeTokenCount(tokenUsage.inputTokens),
      outputTokens: this.normalizeTokenCount(tokenUsage.outputTokens),
      totalTokens: this.normalizeTokenCount(tokenUsage.totalTokens),
    };

    return this.hasAnyTokenCounts(normalized) ? normalized : null;
  }

  private normalizeTokenCount(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private hasAnyTokenCounts(tokenUsage: EmailThreadTurnTokenUsage): boolean {
    return (
      tokenUsage.inputTokens != null ||
      tokenUsage.outputTokens != null ||
      tokenUsage.totalTokens != null
    );
  }

  private sumTokenCounts(current: number | null, next: number | null | undefined): number | null {
    if (next == null) {
      return current;
    }
    return (current ?? 0) + next;
  }
}
