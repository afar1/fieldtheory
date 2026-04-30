import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpawnOptions } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AgentKickoffManager,
  appendFooterToFile,
  buildCommand,
  buildFooter,
  buildPrompt,
  extractSummary,
  validateArgs,
} from './agentKickoffManager';

// Lightweight ChildProcess fake — emits provided stdout/stderr lines, then
// fires 'exit' with the configured code so the manager's promise resolves.
class FakeChild extends EventEmitter {
  stdout = new Readable({ read() {} });
  stderr = new Readable({ read() {} });
  killed = false;
  killSignal: NodeJS.Signals | undefined;

  finish(opts: { stdoutChunks?: string[]; stderrChunks?: string[]; exitCode?: number; signal?: NodeJS.Signals | null } = {}) {
    queueMicrotask(() => {
      for (const chunk of opts.stdoutChunks ?? []) this.stdout.push(chunk);
      for (const chunk of opts.stderrChunks ?? []) this.stderr.push(chunk);
      this.stdout.push(null);
      this.stderr.push(null);
      // Defer 'exit' until after stream 'data' emissions drain — Readable
      // delivers buffered chunks on nextTick, while emit() is synchronous.
      setImmediate(() => this.emit('exit', opts.exitCode ?? 0, opts.signal ?? null));
    });
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.killSignal = signal;
    return true;
  }
}

describe('agentKickoffManager helpers', () => {
  describe('validateArgs', () => {
    let dir: string;
    let mdPath: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'kickoff-validate-'));
      mdPath = join(dir, 'note.md');
      writeFileSync(mdPath, '# Hello\n', 'utf-8');
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('rejects relative paths', () => {
      expect(validateArgs({ absPath: 'note.md', instruction: 'go', model: 'claude' })).toMatch(/file path/i);
    });

    it('rejects non-markdown extensions', () => {
      const txt = join(dir, 'note.txt');
      writeFileSync(txt, 'x', 'utf-8');
      expect(validateArgs({ absPath: txt, instruction: 'go', model: 'claude' })).toMatch(/markdown/i);
    });

    it('rejects missing files', () => {
      expect(validateArgs({ absPath: join(dir, 'missing.md'), instruction: 'go', model: 'claude' })).toMatch(/does not exist/i);
    });

    it('rejects empty instructions', () => {
      expect(validateArgs({ absPath: mdPath, instruction: '   ', model: 'claude' })).toMatch(/empty/i);
    });

    it('rejects unknown models', () => {
      // @ts-expect-error — testing runtime guard
      expect(validateArgs({ absPath: mdPath, instruction: 'go', model: 'gpt' })).toMatch(/unknown model/i);
    });

    it('passes for a valid wiki page', () => {
      expect(validateArgs({ absPath: mdPath, instruction: 'tighten the prose', model: 'claude' })).toBeNull();
    });
  });

  describe('buildPrompt', () => {
    it('embeds path and instruction and forbids frontmatter edits', () => {
      const prompt = buildPrompt('/tmp/notes/foo.md', 'Summarize this.');
      expect(prompt).toContain('/tmp/notes/foo.md');
      expect(prompt).toContain('Summarize this.');
      expect(prompt).toMatch(/Do NOT add, modify, or reorder YAML frontmatter/);
      expect(prompt).toMatch(/Do NOT append your own/);
    });
  });

  describe('buildCommand', () => {
    it('uses claude -p for the claude model', () => {
      const { command, commandArgs } = buildCommand('claude', 'PROMPT');
      expect(command).toBe('claude');
      expect(commandArgs).toEqual(['-p', 'PROMPT']);
    });
    it('uses codex exec for the codex model', () => {
      const { command, commandArgs } = buildCommand('codex', 'PROMPT');
      expect(command).toBe('codex');
      expect(commandArgs).toEqual(['exec', '--skip-git-repo-check', 'PROMPT']);
    });
  });

  describe('extractSummary', () => {
    it('returns the trailing 4 non-empty lines joined', () => {
      const out = ['working...', 'edited section A', '', 'done', 'Tightened the rambling intro and removed two filler sentences.'].join('\n');
      expect(extractSummary(out)).toContain('Tightened the rambling intro');
    });
    it('returns empty for empty stdout', () => {
      expect(extractSummary('   \n  \n')).toBe('');
    });
    it('truncates absurdly long output', () => {
      const long = 'x'.repeat(2000);
      expect(extractSummary(long).length).toBeLessThanOrEqual(600);
    });
  });

  describe('buildFooter', () => {
    it('formats timestamp, model, instruction, and summary', () => {
      const footer = buildFooter('claude', 'tighten prose', 'I removed three filler sentences.', new Date('2026-04-25T18:39:00'));
      expect(footer).toContain('## Agent run — 2026-04-25 18:39 (claude)');
      expect(footer).toContain('**Instruction:** tighten prose');
      expect(footer).toContain('**Summary:** I removed three filler sentences.');
    });
  });

  describe('appendFooterToFile', () => {
    let dir: string;
    let mdPath: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'kickoff-footer-'));
      mdPath = join(dir, 'note.md');
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('appends a separator and footer to a file with one trailing newline', () => {
      writeFileSync(mdPath, '# Hello\n\nbody\n', 'utf-8');
      const ok = appendFooterToFile(mdPath, 'claude', 'do it', 'did it.');
      expect(ok).toBe(true);
      const updated = readFileSync(mdPath, 'utf-8');
      expect(updated).toMatch(/^# Hello\n\nbody\n\n---\n\n## Agent run — /);
      expect(updated).toContain('**Summary:** did it.');
    });

    it('appends without trailing newlines duplicating', () => {
      writeFileSync(mdPath, '# No trailing newline', 'utf-8');
      appendFooterToFile(mdPath, 'codex', 'go', 'done.');
      const updated = readFileSync(mdPath, 'utf-8');
      expect(updated.startsWith('# No trailing newline\n\n---\n')).toBe(true);
    });

    it('handles a file already ending with two newlines', () => {
      writeFileSync(mdPath, '# Hi\n\n', 'utf-8');
      appendFooterToFile(mdPath, 'claude', 'go', 'ok.');
      const updated = readFileSync(mdPath, 'utf-8');
      // Should NOT add a third blank line before the separator.
      expect(updated).toMatch(/# Hi\n\n---\n/);
    });
  });
});

describe('AgentKickoffManager.kickoff', () => {
  let dir: string;
  let mdPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kickoff-run-'));
    mdPath = join(dir, 'note.md');
    writeFileSync(mdPath, '# Hello\n\nbody\n', 'utf-8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects invalid args without spawning', async () => {
    let spawnedCount = 0;
    const fakeSpawn = (() => {
      spawnedCount += 1;
      return new FakeChild() as never;
    }) as never;
    const mgr = new AgentKickoffManager(fakeSpawn);
    const result = await mgr.kickoff({ absPath: 'relative.md', instruction: 'x', model: 'claude' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/file path/i);
    expect(spawnedCount).toBe(0);
  });

  it('captures stdout, extracts a summary, and appends a footer on exit code 0', async () => {
    const fake = new FakeChild();
    const mgr = new AgentKickoffManager(((cmd: string, args: ReadonlyArray<string>) => {
      expect(cmd).toBe('claude');
      expect(args[0]).toBe('-p');
      return fake as never;
    }) as never);
    fake.finish({
      stdoutChunks: ['working\n', 'I tightened the intro and removed filler sentences.\n'],
      exitCode: 0,
    });
    const result = await mgr.kickoff({ absPath: mdPath, instruction: 'tighten prose', model: 'claude' });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('tightened the intro');
    expect(result.appendedFooter).toBe(true);
    const updated = readFileSync(mdPath, 'utf-8');
    expect(updated).toContain('## Agent run —');
    expect(updated).toContain('**Instruction:** tighten prose');
  });

  it('reports a friendly message when the binary is missing (ENOENT)', async () => {
    const fake = new FakeChild();
    const mgr = new AgentKickoffManager(((_: string, __: ReadonlyArray<string>) => {
      queueMicrotask(() => fake.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })));
      return fake as never;
    }) as never);
    const result = await mgr.kickoff({ absPath: mdPath, instruction: 'go', model: 'codex' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Codex CLI is installed/);
    expect(result.appendedFooter).toBe(false);
    expect(readFileSync(mdPath, 'utf-8')).toContain('**Status:** Error');
  });

  it('updates the footer when the agent exits non-zero', async () => {
    const fake = new FakeChild();
    const mgr = new AgentKickoffManager(((_: string, __: ReadonlyArray<string>) => fake as never) as never);
    fake.finish({ stdoutChunks: ['oops\n'], stderrChunks: ['boom\n'], exitCode: 2 });
    const result = await mgr.kickoff({ absPath: mdPath, instruction: 'go', model: 'claude' });
    expect(result.ok).toBe(false);
    expect(result.appendedFooter).toBe(true);
    expect(result.error).toMatch(/exited with code 2/);
    expect(readFileSync(mdPath, 'utf-8')).toContain('**Status:** Error');
  });

  it('emits progress events with stdout chunks', async () => {
    const fake = new FakeChild();
    const mgr = new AgentKickoffManager(((_: string, __: ReadonlyArray<string>) => fake as never) as never);
    const chunks: string[] = [];
    mgr.on('progress', (e) => chunks.push(e.chunk));
    fake.finish({ stdoutChunks: ['hello ', 'world\n'], exitCode: 0 });
    await mgr.kickoff({ absPath: mdPath, instruction: 'go', model: 'claude' });
    expect(chunks.join('')).toBe('hello world\n');
  });

  it('spawns with stdin ignored so CLI tools do not wait for piped input', async () => {
    const fake = new FakeChild();
    let stdio: unknown;
    const mgr = new AgentKickoffManager(((_: string, __: ReadonlyArray<string>, options: SpawnOptions) => {
      stdio = options.stdio;
      return fake as never;
    }) as never);
    fake.finish({ stdoutChunks: ['done\n'], exitCode: 0 });
    await mgr.kickoff({ absPath: mdPath, instruction: 'go', model: 'codex' });
    expect(stdio).toEqual(['ignore', 'pipe', 'pipe']);
  });

  it('start() returns before the child exits and emits status events', async () => {
    const fake = new FakeChild();
    const statuses: string[] = [];
    const mgr = new AgentKickoffManager(((_: string, __: ReadonlyArray<string>) => fake as never) as never);
    mgr.on('status', (event) => statuses.push(event.status));

    const started = mgr.start({ absPath: mdPath, instruction: 'go', model: 'claude' });

    expect(started.ok).toBe(true);
    expect(mgr.getInFlightCount()).toBe(1);
    expect(statuses).toContain('started');
    fake.finish({ stdoutChunks: ['I updated the file.\n'], exitCode: 0 });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(statuses).toContain('done');
    expect(mgr.getInFlightCount()).toBe(0);
  });

  it('cancel() sends SIGTERM to an in-flight run', async () => {
    const fake = new FakeChild();
    const mgr = new AgentKickoffManager(((_: string, __: ReadonlyArray<string>) => fake as never) as never);
    let runId = '';
    mgr.on('start', (event: { runId: string }) => { runId = event.runId; });
    const pending = mgr.kickoff({ absPath: mdPath, instruction: 'go', model: 'claude' });
    // Wait a tick so kickoff registers the run and emits 'start'.
    await new Promise((r) => setImmediate(r));
    expect(runId).not.toBe('');
    expect(mgr.cancel(runId)).toBe(true);
    expect(fake.killed).toBe(true);
    expect(fake.killSignal).toBe('SIGTERM');
    fake.finish({ exitCode: 0, signal: 'SIGTERM' });
    await pending;
    expect(mgr.getInFlightCount()).toBe(0);
  });
});
