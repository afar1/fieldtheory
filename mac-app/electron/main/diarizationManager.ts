import { app } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const SIDECAR_NAME = 'FieldTheoryDiarizer';

export interface DiarizationSegment {
  speakerId: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface DiarizationResult {
  speakerCount: number;
  segments: DiarizationSegment[];
}

type SpawnFn = typeof spawn;
type PendingRequest = {
  resolve: (value: DiarizationResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export interface DiarizationManagerOptions {
  binaryPath?: string;
  appPath?: string;
  resourcesPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  isPackaged?: boolean;
  requestTimeoutMs?: number;
  startupTimeoutMs?: number;
  existsSync?: (filePath: string) => boolean;
  spawnFn?: SpawnFn;
}

export class DiarizationManager {
  private readonly options: DiarizationManagerOptions;
  private readonly spawnFn: SpawnFn;
  private child: ChildProcess | null = null;
  private ready = false;
  private starting: Promise<void> | null = null;
  private rejectStarting: ((error: Error) => void) | null = null;
  private pending: PendingRequest | null = null;
  private stdoutBuffer = '';
  private stderrTail = '';
  private commandChain: Promise<void> = Promise.resolve();

  constructor(options: DiarizationManagerOptions = {}) {
    this.options = options;
    this.spawnFn = options.spawnFn ?? spawn;
  }

  diarize(audioPath: string): Promise<DiarizationResult> {
    return this.enqueue(() => this.diarizeInternal(audioPath));
  }

  stop(): void {
    const stoppedError = new Error('Diarization sidecar stopped');
    this.rejectStarting?.(stoppedError);
    this.rejectStarting = null;
    this.rejectPending(stoppedError);
    const child = this.child;
    this.resetProcessState();
    child?.kill('SIGTERM');
  }

  getBinaryPathCandidates(): string[] {
    const appPath = this.options.appPath ?? app.getAppPath();
    const resourcesPath = this.options.resourcesPath ?? process.resourcesPath;
    const cwd = this.options.cwd ?? process.cwd();
    const isPackaged = this.options.isPackaged ?? app.isPackaged;
    const candidates = isPackaged
      ? [path.join(resourcesPath, SIDECAR_NAME)]
      : [
          path.join(appPath, 'electron', 'diarization', '.build', 'release', SIDECAR_NAME),
          path.join(appPath, 'electron', 'diarization', '.build', 'debug', SIDECAR_NAME),
          path.join(cwd, 'electron', 'diarization', '.build', 'release', SIDECAR_NAME),
          path.join(cwd, 'electron', 'diarization', '.build', 'debug', SIDECAR_NAME),
        ];

    return [this.options.binaryPath, this.options.env?.FIELD_THEORY_DIARIZER_PATH, ...candidates]
      .filter((candidate): candidate is string => Boolean(candidate))
      .map(candidate => path.resolve(candidate))
      .filter((candidate, index, all) => all.indexOf(candidate) === index);
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const queued = this.commandChain.then(run, run);
    this.commandChain = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private async diarizeInternal(audioPath: string): Promise<DiarizationResult> {
    if (!audioPath) {
      throw new Error('Diarization requires a non-empty audio path');
    }

    await this.start();

    if (!this.child || !this.ready || !this.child.stdin?.writable) {
      throw new Error('Diarization sidecar is not running');
    }

    return new Promise<DiarizationResult>((resolve, reject) => {
      const timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const timeout = setTimeout(() => {
        const error = new Error(`Diarization timed out after ${timeoutMs / 1000}s`);
        this.pending = null;
        const child = this.child;
        this.resetProcessState();
        child?.kill('SIGTERM');
        reject(error);
      }, timeoutMs);

      this.pending = { resolve, reject, timeout };
      const request = JSON.stringify({ type: 'diarize', audioPath }) + '\n';
      this.child?.stdin?.write(request, error => {
        if (!error) return;
        const writeError = new Error(`Failed to send audio to diarization sidecar: ${error.message}`);
        this.rejectPending(writeError);
      });
    });
  }

  private start(): Promise<void> {
    if (this.child && this.ready) return Promise.resolve();
    if (this.starting) return this.starting;

    const candidates = this.getBinaryPathCandidates();
    const existsSync = this.options.existsSync ?? fs.existsSync;
    const binaryPath = candidates.find(candidate => existsSync(candidate));
    if (!binaryPath) {
      return Promise.reject(new Error(
        `Diarization is unavailable because ${SIDECAR_NAME} was not found. Checked: ${candidates.join(', ')}`
      ));
    }

    this.stdoutBuffer = '';
    this.stderrTail = '';
    this.ready = false;

    const child = this.spawnFn(binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.options.env },
    });
    this.child = child;

    this.starting = new Promise<void>((resolve, reject) => {
      let settled = false;
      const startupTimeoutMs = this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
      const timeout = setTimeout(() => {
        fail(new Error(`Diarization sidecar startup timed out after ${startupTimeoutMs / 1000}s`));
      }, startupTimeoutMs);

      const succeed = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.rejectStarting = null;
        this.starting = null;
        this.ready = true;
        resolve();
      };

      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.rejectStarting = null;
        this.starting = null;
        const activeChild = this.child;
        this.resetProcessState();
        activeChild?.kill('SIGTERM');
        reject(error);
      };

      this.rejectStarting = fail;
      child.stdout?.on('data', data => {
        if (this.child === child) this.handleStdout(data, succeed, fail);
      });
      child.stderr?.on('data', data => {
        this.stderrTail = (this.stderrTail + data.toString()).slice(-4096);
      });
      child.once('error', error => {
        if (this.child !== child) return;
        const wrapped = new Error(`Failed to start diarization sidecar: ${error.message}`);
        if (!this.ready) fail(wrapped);
        else this.handleProcessFailure(wrapped);
      });
      child.once('close', code => {
        if (this.child !== child) return;
        const detail = this.stderrTail.trim();
        const suffix = detail ? `: ${detail}` : '';
        const closed = new Error(`Diarization sidecar exited with code ${code}${suffix}`);
        if (!this.ready) fail(closed);
        else this.handleProcessFailure(closed);
      });
    });

    return this.starting;
  }

  private handleStdout(
    data: Buffer,
    resolveStartup: () => void,
    rejectStartup: (error: Error) => void
  ): void {
    this.stdoutBuffer += data.toString();
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        const error = new Error(`Diarization sidecar produced invalid JSON: ${line.slice(0, 200)}`);
        if (!this.ready) rejectStartup(error);
        else this.handleProcessFailure(error);
        return;
      }

      if (!this.ready) {
        if (isRecord(message) && message.ready === true && message.protocolVersion === 1) {
          resolveStartup();
          continue;
        }
        rejectStartup(new Error('Diarization sidecar did not provide the expected ready response'));
        return;
      }

      if (!this.pending) {
        this.handleProcessFailure(new Error('Diarization sidecar produced an unexpected response'));
        return;
      }

      try {
        const result = parseDiarizationResponse(message);
        const pending = this.pending;
        this.pending = null;
        clearTimeout(pending.timeout);
        pending.resolve(result);
      } catch (error) {
        this.rejectPending(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private handleProcessFailure(error: Error): void {
    this.rejectPending(error);
    const child = this.child;
    this.resetProcessState();
    child?.kill('SIGTERM');
  }

  private rejectPending(error: Error): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timeout);
    pending.reject(error);
  }

  private resetProcessState(): void {
    this.child = null;
    this.ready = false;
    this.starting = null;
    this.rejectStarting = null;
    this.stdoutBuffer = '';
  }
}

function parseDiarizationResponse(message: unknown): DiarizationResult {
  if (!isRecord(message) || typeof message.ok !== 'boolean') {
    throw new Error('Diarization sidecar returned an invalid response');
  }
  if (!message.ok) {
    const detail = typeof message.error === 'string' && message.error.trim()
      ? message.error.trim()
      : 'unknown sidecar error';
    throw new Error(`Diarization failed: ${detail}`);
  }
  if (!Number.isInteger(message.speakerCount) || (message.speakerCount as number) < 0) {
    throw new Error('Diarization sidecar returned an invalid speaker count');
  }
  if (!Array.isArray(message.segments)) {
    throw new Error('Diarization sidecar returned invalid segments');
  }

  const segments = message.segments.map((segment, index) => parseSegment(segment, index));
  const actualSpeakerCount = new Set(segments.map(segment => segment.speakerId)).size;
  if (actualSpeakerCount !== message.speakerCount) {
    throw new Error('Diarization sidecar returned an inconsistent speaker count');
  }

  return { speakerCount: message.speakerCount as number, segments };
}

function parseSegment(value: unknown, index: number): DiarizationSegment {
  if (!isRecord(value)
    || typeof value.speakerId !== 'string'
    || !value.speakerId.trim()
    || !isFiniteNumber(value.startTimeSeconds)
    || !isFiniteNumber(value.endTimeSeconds)
    || !isFiniteNumber(value.qualityScore)
    || value.startTimeSeconds < 0
    || value.endTimeSeconds < value.startTimeSeconds) {
    throw new Error(`Diarization sidecar returned invalid segment ${index}`);
  }

  return {
    speakerId: value.speakerId,
    startMs: value.startTimeSeconds * 1000,
    endMs: value.endTimeSeconds * 1000,
    confidence: value.qualityScore,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
