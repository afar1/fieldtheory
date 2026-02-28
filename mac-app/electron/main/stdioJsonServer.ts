/**
 * Generic persistent subprocess that communicates via newline-delimited JSON
 * over stdin/stdout. Used by both Qwen and MLX Whisper transcription engines.
 *
 * Lifecycle:
 *   1. start() → spawn process, wait for {"ready": true} on stdout
 *   2. send(cmd) → write JSON to stdin, wait for JSON response on stdout
 *   3. stop() → SIGTERM, reset state
 *
 * Commands are serialized through a chain so only one request is in-flight
 * at a time (the server uses a single pending-resolver pattern).
 */

import { spawn, ChildProcess } from 'child_process';
import { createLogger } from './logger';

const log = createLogger('StdioJsonServer');

export type ServerResponse = { ok: boolean; text?: string; error?: string };

type SpawnFn = typeof spawn;

export interface StdioJsonServerConfig {
  name: string;
  command: string;
  args: string[];
  timeoutMs?: number;
  preStart?: () => Promise<void>;
  /** Override for testing — defaults to child_process.spawn. */
  spawnFn?: SpawnFn;
}

export class StdioJsonServer {
  private name: string;
  private command: string;
  private args: string[];
  private timeoutMs: number;
  private preStart?: () => Promise<void>;
  private spawnFn: SpawnFn;

  private process: ChildProcess | null = null;
  private ready: boolean = false;
  private readyPromise: Promise<void> | null = null;
  private pendingResolve: ((response: ServerResponse) => void) | null = null;
  private commandChain: Promise<void> = Promise.resolve();
  private lifecycleGeneration: number = 0;
  private _disabledReason: string | null = null;

  constructor(config: StdioJsonServerConfig) {
    this.name = config.name;
    this.command = config.command;
    this.args = config.args;
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.preStart = config.preStart;
    this.spawnFn = config.spawnFn ?? spawn;
  }

  get isReady(): boolean { return this.ready; }
  get isRunning(): boolean { return this.process !== null && this.ready; }
  get isStarting(): boolean { return this.readyPromise !== null && !this.ready; }
  get disabledReason(): string | null { return this._disabledReason; }

  disable(reason: string): void {
    this._disabledReason = reason;
    log.warn('Disabling %s for this session: %s', this.name, reason);
  }

  /**
   * Reconfigure the command and args for the next start.
   * Useful when the Python path or script path changes between calls.
   */
  configure(command: string, args: string[]): void {
    this.command = command;
    this.args = args;
  }

  /**
   * Spawn the server process, run any pre-start validation, and wait for
   * the {"ready": true} signal on stdout. Returns immediately if already running.
   */
  start(): Promise<void> {
    if (this._disabledReason) {
      return Promise.reject(new Error(this._disabledReason));
    }
    if (this.ready && this.process) {
      return Promise.resolve();
    }
    if (this.readyPromise) {
      return this.readyPromise;
    }

    const startupGeneration = ++this.lifecycleGeneration;

    this.readyPromise = new Promise<void>((resolve, reject) => {
      const invalidated = (): boolean => startupGeneration !== this.lifecycleGeneration;

      const launch = async () => {
        // Optional pre-start validation (e.g. Python version check).
        if (this.preStart) {
          try {
            await this.preStart();
          } catch (error) {
            if (invalidated()) { reject(new Error(`${this.name} startup cancelled`)); return; }
            this.resetState();
            reject(error as Error);
            return;
          }
        }

        if (invalidated()) { reject(new Error(`${this.name} startup cancelled`)); return; }

        const proc = this.spawnFn(this.command, this.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        if (invalidated()) {
          proc.kill('SIGTERM');
          reject(new Error(`${this.name} startup cancelled`));
          return;
        }

        this.process = proc;
        let buffer = '';

        // During startup, watch for the {"ready": true} JSON line.
        const onData = (data: Buffer) => {
          buffer += data.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.ready) {
                if (invalidated()) {
                  proc.kill('SIGTERM');
                  reject(new Error(`${this.name} startup cancelled`));
                  return;
                }
                this.ready = true;
                proc.stdout?.removeListener('data', onData);
                this.setupLineHandler(proc, buffer);
                buffer = '';
                log.info('%s server ready', this.name);
                resolve();
                return;
              }
            } catch {
              // Not JSON — ignore during startup.
            }
          }
        };

        proc.stdout?.on('data', onData);

        proc.stderr?.on('data', (data: Buffer) => {
          log.info('[%s stderr] %s', this.name, data.toString().trim());
        });

        proc.on('error', (error) => {
          if (invalidated()) { reject(new Error(`${this.name} startup cancelled`)); return; }
          this.resetState();
          reject(new Error(`Failed to start ${this.name} server: ${error.message}`));
        });

        proc.on('close', (code) => {
          if (invalidated()) { reject(new Error(`${this.name} startup cancelled`)); return; }
          const wasReady = this.ready;
          this.resetState();

          if (!wasReady) {
            reject(new Error(`${this.name} server exited during startup with code ${code}`));
          } else {
            log.warn('%s server exited (code %d), will restart on next request', this.name, code);
          }
        });
      };

      void launch();
    });

    return this.readyPromise;
  }

  /**
   * Kill the server process. Safe to call multiple times.
   */
  stop(): void {
    this.lifecycleGeneration += 1;
    if (this.pendingResolve) {
      this.pendingResolve({ ok: false, error: `${this.name} server stopped` });
      this.pendingResolve = null;
    }
    if (this.process) {
      this.process.kill('SIGTERM');
    }
    this.resetState();
  }

  /**
   * Send a JSON command to the server and wait for the response.
   * Commands are serialized — only one is in-flight at a time.
   */
  send(cmd: Record<string, unknown>): Promise<ServerResponse> {
    return this.enqueue(() => this.sendInternal(cmd));
  }

  // ---- internals ----

  private resetState(): void {
    this.process = null;
    this.ready = false;
    this.readyPromise = null;
  }

  private setupLineHandler(proc: ChildProcess, initialBuffer: string): void {
    let buffer = initialBuffer;
    proc.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (this.pendingResolve) {
            this.pendingResolve(msg);
            this.pendingResolve = null;
          }
        } catch {
          log.warn('[%s] Non-JSON stdout: %s', this.name, line);
        }
      }
    });
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const queued = this.commandChain.then(run, run);
    this.commandChain = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private sendInternal(cmd: Record<string, unknown>): Promise<ServerResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.ready) {
        reject(new Error(`${this.name} server not running`));
        return;
      }
      if (this.pendingResolve) {
        reject(new Error(`${this.name} server already has an in-flight command`));
        return;
      }

      const timeout = setTimeout(() => {
        this.pendingResolve = null;
        reject(new Error(`${this.name} server timed out (${this.timeoutMs / 1000}s)`));
      }, this.timeoutMs);

      this.pendingResolve = (response) => {
        clearTimeout(timeout);
        resolve(response);
      };

      const line = JSON.stringify(cmd) + '\n';
      this.process.stdin?.write(line, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingResolve = null;
          reject(new Error(`Failed to write to ${this.name} server: ${err.message}`));
        }
      });
    });
  }
}
