// =============================================================================
// AgentKickoffManager — invokes a locally-installed agent CLI (Claude Code or
// Codex) against a markdown file and appends a summary footer to that file
// when the run succeeds.
//
// The user picks a file in the Librarian, clicks the "Agent" button, types an
// instruction, picks a model, and hits go. This manager spawns the chosen CLI
// in non-interactive mode with the file path baked into the prompt, captures
// stdout, and writes a "## Agent run — <ts> (<model>)" footer with the final
// summary so the markdown carries a record of what was done.
// =============================================================================

import { EventEmitter } from 'events';
import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createLogger } from './logger';

const log = createLogger('AgentKickoff');

export type AgentKickoffModel = 'claude' | 'codex';

export interface AgentKickoffArgs {
  absPath: string;
  instruction: string;
  model: AgentKickoffModel;
}

export interface AgentKickoffResult {
  ok: boolean;
  runId: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  summary: string;
  appendedFooter: boolean;
  error?: string;
}

export interface AgentKickoffProgressEvent {
  runId: string;
  kind: 'stdout' | 'stderr';
  chunk: string;
}

type SpawnFn = (
  command: string,
  args: ReadonlyArray<string>,
  options: SpawnOptions,
) => ChildProcess;

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const ALLOWED_MARKDOWN_EXTS = new Set(['.md', '.markdown']);

// Common locations where `claude` / `codex` end up. Electron GUIs on macOS
// inherit a sparse PATH from launchd, so we prepend the usual CLI install
// dirs before spawning — without this, npm-global / homebrew binaries are
// invisible to spawn().
const PATH_AUGMENTATIONS = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.bun', 'bin'),
  path.join(os.homedir(), '.cargo', 'bin'),
  path.join(os.homedir(), '.claude', 'local'),
  path.join(os.homedir(), '.npm-global', 'bin'),
];

export class AgentKickoffManager extends EventEmitter {
  private runs: Map<string, ChildProcess> = new Map();

  constructor(private readonly spawnFn: SpawnFn = spawn) {
    super();
  }

  /** Validate args, spawn the chosen CLI, capture output, append a footer
   *  on success. Resolves once the child exits or errors out. */
  async kickoff(args: AgentKickoffArgs): Promise<AgentKickoffResult> {
    const runId = generateRunId();
    const startedAt = Date.now();

    const validation = validateArgs(args);
    if (validation) {
      return makeError(runId, validation, startedAt);
    }

    const instruction = args.instruction.trim();
    const prompt = buildPrompt(args.absPath, instruction);
    const cwd = path.dirname(args.absPath);
    const { command, commandArgs } = buildCommand(args.model, prompt);

    this.emit('start', { runId, model: args.model, absPath: args.absPath });

    return new Promise<AgentKickoffResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let truncated = false;

      let child: ChildProcess;
      try {
        child = this.spawnFn(command, commandArgs, {
          cwd,
          env: buildEnv(),
          shell: false,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`Failed to spawn ${command}:`, message);
        resolve(makeError(runId, friendlySpawnError(args.model, command, message), startedAt));
        return;
      }

      this.runs.set(runId, child);

      const timer = setTimeout(() => {
        log.warn(`Agent run ${runId} exceeded ${DEFAULT_TIMEOUT_MS}ms; killing`);
        try { child.kill('SIGTERM'); } catch { /* already gone */ }
      }, DEFAULT_TIMEOUT_MS);

      const appendChunk = (kind: 'stdout' | 'stderr', buf: Buffer) => {
        const text = buf.toString('utf-8');
        const current = kind === 'stdout' ? stdout : stderr;
        if (current.length + text.length > MAX_OUTPUT_BYTES) {
          truncated = true;
          return;
        }
        if (kind === 'stdout') stdout += text; else stderr += text;
        const event: AgentKickoffProgressEvent = { runId, kind, chunk: text };
        this.emit('progress', event);
      };

      child.stdout?.on('data', (buf: Buffer) => appendChunk('stdout', buf));
      child.stderr?.on('data', (buf: Buffer) => appendChunk('stderr', buf));

      child.on('error', (err) => {
        clearTimeout(timer);
        this.runs.delete(runId);
        const message = friendlySpawnError(args.model, command, err.message);
        const result = makeError(runId, message, startedAt, stdout, stderr);
        this.emit('end', result);
        resolve(result);
      });

      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        this.runs.delete(runId);
        const ok = code === 0;
        const summary = ok ? extractSummary(stdout) : '';
        const appendedFooter = ok && summary
          ? appendFooterToFile(args.absPath, args.model, instruction, summary)
          : false;
        const result: AgentKickoffResult = {
          ok,
          runId,
          stdout: truncated ? `${stdout}\n\n[output truncated]` : stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          summary,
          appendedFooter,
          error: ok
            ? undefined
            : signal
              ? `Agent terminated by signal ${signal}`
              : `Agent exited with code ${code ?? 'unknown'}`,
        };
        this.emit('end', result);
        resolve(result);
      });
    });
  }

  /** Best-effort cancel by sending SIGTERM to the run's child. Returns true
   *  if a matching run was found. */
  cancel(runId: string): boolean {
    const child = this.runs.get(runId);
    if (!child) return false;
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    return true;
  }

  /** Number of in-flight runs — used by tests. */
  getInFlightCount(): number {
    return this.runs.size;
  }
}

// ---- helpers (exported for unit tests) --------------------------------------

export function validateArgs(args: AgentKickoffArgs): string | null {
  if (!args.absPath || !path.isAbsolute(args.absPath)) {
    return 'A file path is required.';
  }
  if (!ALLOWED_MARKDOWN_EXTS.has(path.extname(args.absPath).toLowerCase())) {
    return 'Only markdown files (.md, .markdown) are supported.';
  }
  if (!fs.existsSync(args.absPath)) {
    return `File does not exist: ${args.absPath}`;
  }
  if (!args.instruction || !args.instruction.trim()) {
    return 'Instruction is empty.';
  }
  if (args.model !== 'claude' && args.model !== 'codex') {
    return `Unknown model: ${String(args.model)}`;
  }
  return null;
}

export function buildPrompt(absPath: string, instruction: string): string {
  return [
    `You are acting on a markdown file at: ${absPath}`,
    '',
    'Read the file, then perform the user instruction by editing the file directly.',
    '',
    'Constraints:',
    '- Do NOT add, modify, or reorder YAML frontmatter at the top of the file.',
    '- Do NOT append your own "## Agent run" section — Field Theory will append a summary footer based on what you print.',
    '- Keep edits minimal and focused on the instruction.',
    '',
    'When you are done, print a 1–2 sentence summary of what you changed. Be concrete and specific.',
    '',
    'User instruction:',
    instruction.trim(),
  ].join('\n');
}

export function buildCommand(
  model: AgentKickoffModel,
  prompt: string,
): { command: string; commandArgs: string[] } {
  if (model === 'claude') {
    return { command: 'claude', commandArgs: ['-p', prompt] };
  }
  return { command: 'codex', commandArgs: ['exec', prompt] };
}

export function extractSummary(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return '';
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  // Heuristic: the agent's final printed lines are the summary. Take the
  // trailing block up to a blank line, capped at 4 lines.
  const tail: string[] = [];
  for (let i = lines.length - 1; i >= 0 && tail.length < 4; i -= 1) {
    tail.unshift(lines[i]);
  }
  const joined = tail.join(' ');
  return joined.length > 600 ? `${joined.slice(0, 599)}…` : joined;
}

export function buildFooter(
  model: AgentKickoffModel,
  instruction: string,
  summary: string,
  now: Date = new Date(),
): string {
  const timestamp = formatTimestamp(now);
  return [
    '---',
    '',
    `## Agent run — ${timestamp} (${model})`,
    '',
    `**Instruction:** ${truncate(instruction.trim(), 400)}`,
    '',
    `**Summary:** ${truncate(summary.trim(), 800)}`,
    '',
  ].join('\n');
}

export function appendFooterToFile(
  absPath: string,
  model: AgentKickoffModel,
  instruction: string,
  summary: string,
  now: Date = new Date(),
): boolean {
  try {
    const content = fs.readFileSync(absPath, 'utf-8');
    const separator = content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
    const footer = buildFooter(model, instruction, summary, now);
    fs.writeFileSync(absPath, `${content}${separator}${footer}`, 'utf-8');
    return true;
  } catch (err) {
    log.error(`Failed to append agent footer to ${absPath}:`, err);
    return false;
  }
}

function buildEnv(): NodeJS.ProcessEnv {
  const baseEnv = { ...process.env };
  const existing = (baseEnv.PATH ?? '').split(path.delimiter).filter(Boolean);
  const merged = [...PATH_AUGMENTATIONS, ...existing];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const entry of merged) {
    if (!seen.has(entry)) {
      seen.add(entry);
      deduped.push(entry);
    }
  }
  baseEnv.PATH = deduped.join(path.delimiter);
  return baseEnv;
}

function friendlySpawnError(
  model: AgentKickoffModel,
  command: string,
  message: string,
): string {
  if (message.includes('ENOENT')) {
    const tool = model === 'claude' ? 'Claude Code' : 'Codex';
    return `${command} not found on PATH. Make sure ${tool} CLI is installed and on PATH.`;
  }
  return message;
}

function makeError(
  runId: string,
  message: string,
  startedAt: number,
  stdout = '',
  stderr = '',
): AgentKickoffResult {
  return {
    ok: false,
    runId,
    stdout,
    stderr,
    durationMs: Date.now() - startedAt,
    summary: '',
    appendedFooter: false,
    error: message,
  };
}

function generateRunId(): string {
  return `kickoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTimestamp(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}
