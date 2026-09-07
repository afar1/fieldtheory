import os from 'os';
import type { BookmarkCredentials } from './bookmarkAuth';
import type { QuickBookmarkSync } from './bookmarkSyncController';

type ExecResult = { stdout: string; stderr?: string };
export type BookmarkCliCommand = { executable: string; args?: string[]; env: NodeJS.ProcessEnv };
type Exec = (file: string, args: string[], options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number; signal: AbortSignal; killSignal: NodeJS.Signals }) => Promise<ExecResult> & { child?: { pid?: number; stdin?: { end: (value: string) => unknown; on?: (event: string, listener: () => void) => unknown } } };

/** Requires an explicit quick-mode capability; older CLIs must never run a full sync. */
export class BookmarkSyncRunner {
  private supportedCommand: string | null = null;
  constructor(private readonly resolve: () => BookmarkCliCommand | null, private readonly exec: Exec, private readonly credentials: () => Promise<BookmarkCredentials | null> = async () => null) {}

  async quick(signal: AbortSignal): Promise<QuickBookmarkSync> {
    const credentials = await this.credentials();
    if (!credentials) return { status: 'auth_required' };
    const command = this.resolve();
    if (!command) return { status: 'unsupported', error: 'Bookmark sync CLI is not available.' };
    const key = JSON.stringify([command.executable, command.args]);
    if (this.supportedCommand !== key) {
      try {
        const help = await this.run(command, ['sync', '--help'], signal, 5000);
        if (!/--quick\b/.test(help.stdout) || !/--credentials-stdin\b/.test(help.stdout)) return { status: 'unsupported', error: 'Bookmark sync requires a CLI with quick sync support.' };
        this.supportedCommand = key;
      } catch (error) {
        if (signal.aborted) throw error;
        return { status: 'unsupported', error: 'Bookmark sync CLI could not be checked.' };
      }
    }
    let output: ExecResult;
    try {
      output = await this.run(command, ['sync', '--quick', '--json', '--credentials-stdin'], signal, 45_000, JSON.stringify(credentials));
    } catch (error) {
      if (signal.aborted) throw error;
      const failure = error as { stdout?: string; killed?: boolean; code?: string };
      if (failure.stdout) return this.parseQuick(failure.stdout);
      return { status: failure.killed ? 'timeout' : 'error', error: failure.killed ? 'Bookmark check reached its time limit.' : 'Bookmark check could not complete.' };
    }
    return this.parseQuick(output.stdout);
  }

  async maintenance(signal: AbortSignal, work: { index: boolean } = { index: false }): Promise<{ remaining?: boolean; changed?: boolean; retryAfterSec?: number }> {
    const command = this.resolve();
    if (!command || this.supportedCommand !== JSON.stringify([command.executable, command.args])) return {};
    if (work.index) {
      const indexOutput = await this.run(command, ['index', '--json'], signal, 20_000);
      const indexResult = JSON.parse(indexOutput.stdout);
      if (indexResult.mode !== 'index' || indexResult.status !== 'complete') throw new Error('Bookmark index maintenance did not complete.');
    }
    const output = await this.run(command, ['fetch-media', '--limit', '8', '--max-bytes', '5242880', '--json'], signal, 25_000);
    const result = JSON.parse(output.stdout);
    if (!['complete', 'timeout', 'rate_limited'].includes(result.status)) throw new Error('Bookmark media maintenance did not complete.');
    return {
      remaining: result.remaining === true || result.status !== 'complete',
      changed: Number(result.downloaded) > 0,
      retryAfterSec: Number.isFinite(result.retryAfterSec) ? Math.max(0, result.retryAfterSec) : undefined,
    };
  }

  private parseQuick(stdout: string): QuickBookmarkSync {
    try {
      const result = JSON.parse(stdout);
      if (result.mode !== 'quick' || !['synced', 'rate_limited', 'timeout', 'error', 'auth_required'].includes(result.status)) {
        return { status: 'unsupported', error: 'Bookmark CLI returned an unsupported response.' };
      }
      return {
        status: result.status,
        added: Number.isFinite(result.added) ? Math.max(0, result.added) : 0,
        changed: Number.isFinite(result.changed) ? Math.max(0, result.changed) : 0,
        retryAfterSec: Number.isFinite(result.retryAfterSec) ? Math.max(0, result.retryAfterSec) : undefined,
        // Avoid sending CLI diagnostics, credential paths, or raw network errors to renderers.
        error: result.status === 'error' ? 'Bookmark check could not complete.' : undefined,
      };
    } catch { return { status: 'unsupported', error: 'Bookmark CLI returned an unsupported response.' }; }
  }
  private run(command: BookmarkCliCommand, args: string[], signal: AbortSignal, timeout: number, input?: string): Promise<ExecResult> {
    const job = this.exec(command.executable, [...(command.args ?? []), ...args], {
      env: command.env, timeout, signal, maxBuffer: 512 * 1024, killSignal: 'SIGKILL',
    });
    if (input !== undefined) {
      if (!job.child?.stdin) throw new Error('Bookmark worker input unavailable.');
      job.child.stdin.on?.('error', () => { /* Process exit is reported by the job promise. */ });
      job.child.stdin.end(input);
    }
    if ((args[0] === 'index' || args[0] === 'fetch-media') && job.child?.pid) {
      try { os.setPriority(job.child.pid, os.constants.priority.PRIORITY_LOW); } catch { /* Child may have exited already. */ }
    }
    return job;
  }
}
