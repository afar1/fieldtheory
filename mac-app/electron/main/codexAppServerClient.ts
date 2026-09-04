import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_AMBIENT_INSTRUCTIONS,
  DEFAULT_AMBIENT_SETTINGS,
  normalizeAmbientSettings,
  type AmbientSettings,
} from '../shared/ambientSettings';

type SpawnFn = (
  command: string,
  args: ReadonlyArray<string>,
  options: SpawnOptions,
) => ChildProcess;

type JsonObject = Record<string, unknown>;

interface PendingRequest {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface CodexAppServerClientOptions {
  workspacePath: string;
  command?: string;
  spawnFn?: SpawnFn;
  requestTimeoutMs?: number;
  retryCount?: number;
}

export interface AmbientTask {
  threadId: string;
  title: string;
}

export interface AmbientTranscriptDelivery {
  threadId: string;
  meetingId: string;
  firstSequence: number;
  lastSequence: number;
  contextFilePath: string;
  clientUserMessageId?: string;
}

const DEFAULT_CODEX_BINARY = '/Applications/ChatGPT.app/Contents/Resources/codex';
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const PROCESS_EXIT_TIMEOUT_MS = 5_000;

export const AMBIENT_DEVELOPER_INSTRUCTIONS = DEFAULT_AMBIENT_INSTRUCTIONS;

export function ambientTaskTitle(meetingTitle: string): string {
  const trimmed = meetingTitle.trim();
  if (!trimmed) throw new Error('Meeting title is required');
  return `Ambient - ${trimmed}`;
}

export function ambientClientUserMessageId(
  meetingId: string,
  firstSequence: number,
  lastSequence = firstSequence,
  batchDiscriminator = '',
): string {
  if (!meetingId.trim()) throw new Error('Meeting id is required');
  if (!Number.isSafeInteger(firstSequence) || firstSequence < 0
    || !Number.isSafeInteger(lastSequence) || lastSequence < firstSequence) {
    throw new Error('Transcript sequence range is invalid');
  }
  const digest = createHash('sha256')
    .update(batchDiscriminator
      ? `${meetingId}\0${firstSequence}\0${lastSequence}\0${batchDiscriminator}`
      : `${meetingId}\0${firstSequence}\0${lastSequence}`)
    .digest('hex')
    .slice(0, 32);
  return `field-theory-ambient-${digest}`;
}

class CodexTransportError extends Error {}

/**
 * Minimal Codex app-server client for Ambient. It uses a stdio connection for
 * protocol calls, while Codex Desktop owns and runs the persisted task.
 */
export class CodexAppServerClient extends EventEmitter {
  private readonly workspacePath: string;
  private readonly command: string;
  private readonly spawnFn: SpawnFn;
  private readonly requestTimeoutMs: number;
  private readonly retryCount: number;

  private child: ChildProcess | null = null;
  private connectPromise: Promise<void> | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();
  private stdoutBuffer = '';
  private deliveryChain: Promise<void> = Promise.resolve();

  constructor(options: CodexAppServerClientOptions) {
    super();
    if (!path.isAbsolute(options.workspacePath)) {
      throw new Error('Codex workspace path must be absolute');
    }
    this.workspacePath = path.normalize(options.workspacePath);
    this.command = options.command ?? DEFAULT_CODEX_BINARY;
    this.spawnFn = options.spawnFn ?? (spawn as SpawnFn);
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.retryCount = options.retryCount ?? 1;
  }

  async createAmbientTask(
    meetingTitle: string,
    onThreadStarted?: (threadId: string) => void | Promise<void>,
    rawSettings: AmbientSettings = DEFAULT_AMBIENT_SETTINGS,
  ): Promise<AmbientTask> {
    const title = ambientTaskTitle(meetingTitle);
    const settings = normalizeAmbientSettings(rawSettings);
    await this.ensureConnected();
    const startParams: JsonObject = {
      cwd: this.workspacePath,
      runtimeWorkspaceRoots: [os.homedir()],
      developerInstructions: settings.instructions,
      ephemeral: false,
      historyMode: 'legacy',
      threadSource: 'field-theory-meeting',
    };
    const result = asObject(await this.request('thread/start', startParams));
    const threadId = readThreadId(result);

    try {
      // The hook lets the caller durably save the id before the separate naming
      // request. A retry can then resume this task instead of creating another.
      await onThreadStarted?.(threadId);
      await this.injectAmbientInstructions(threadId, settings.instructions);
      await this.setTaskName(threadId, title);
    } finally {
      await this.releaseThread(threadId);
    }
    return { threadId, title };
  }

  async prepareAmbientTask(
    threadId: string,
    meetingTitle: string,
  ): Promise<AmbientTask> {
    const title = ambientTaskTitle(meetingTitle);
    if (!threadId.trim()) throw new Error('Codex thread id is required');
    try {
      // Naming does not load the task or take its writer lease. This lets a
      // recovered meeting keep using a task that is already open in Desktop.
      await this.setTaskName(threadId, title);
    } finally {
      await this.stopConnection(new CodexTransportError('Codex task preparation completed'));
    }
    return { threadId, title };
  }

  async deliverAmbientSettings(
    threadId: string,
    settingsFilePath: string,
  ): Promise<void> {
    if (!threadId.trim()) throw new Error('Codex thread id is required');
    if (settingsFilePath !== '.ambient-context/ambient-instructions.txt') {
      throw new Error('Ambient settings file path is invalid');
    }
    await this.request('thread/queue/add', {
      threadId,
      clientUserMessageId: `field-theory-ambient-settings-${randomUUID()}`,
      input: [{
        type: 'text',
        text: `Ambient settings changed: read ${settingsFilePath} and use its exact contents as the active Ambient contract for this and later staffer cycles.`,
        text_elements: [],
      }],
    });
  }

  deliverTranscript(delivery: AmbientTranscriptDelivery): Promise<void> {
    const run = async () => this.deliverTranscriptWithRetry(delivery);
    const queued = this.deliveryChain.then(run, run);
    this.deliveryChain = queued.then(() => undefined, () => undefined);
    return queued;
  }

  close(): void {
    const child = this.child;
    this.failConnection(child, new CodexTransportError('Codex app-server client closed'));
    if (child) {
      try { child.kill('SIGTERM'); } catch { /* already stopped */ }
    }
  }

  private async deliverTranscriptWithRetry(delivery: AmbientTranscriptDelivery): Promise<void> {
    validateDelivery(delivery);
    const clientUserMessageId = delivery.clientUserMessageId
      ?? ambientClientUserMessageId(delivery.meetingId, delivery.firstSequence, delivery.lastSequence);

    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.request('thread/queue/add', {
          threadId: delivery.threadId,
          clientUserMessageId,
          input: [{
            type: 'text',
            text: ambientContextFilePrompt(delivery.contextFilePath),
            text_elements: [],
          }],
        });
        return;
      } catch (error) {
        if (!(error instanceof CodexTransportError) || attempt >= this.retryCount) throw error;
        this.restartConnection();
      }
    }
  }

  private async setTaskName(threadId: string, title: string): Promise<void> {
    await this.request('thread/name/set', { threadId, name: title });
  }

  private async injectAmbientInstructions(
    threadId: string,
    instructions: string,
  ): Promise<void> {
    await this.request('thread/inject_items', {
      threadId,
      items: [{
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: instructions }],
      }],
    });
  }

  private async releaseThread(threadId: string): Promise<void> {
    try {
      await this.request('thread/unsubscribe', { threadId });
    } finally {
      // Unsubscribe stops notifications, but the process still retains the
      // writer lease. Exiting it lets Codex Desktop adopt the task.
      await this.stopConnection(new CodexTransportError('Codex task ownership released'));
    }
  }

  private stopConnection(error: CodexTransportError): Promise<void> {
    const child = this.child;
    if (!child) return Promise.resolve();
    this.failConnection(child, error);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new CodexTransportError('Timed out releasing Codex task ownership'));
      }, PROCESS_EXIT_TIMEOUT_MS);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        child.kill('SIGTERM');
      } catch (killError) {
        clearTimeout(timer);
        reject(new CodexTransportError(`Failed to release Codex task ownership: ${errorMessage(killError)}`));
      }
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }
    if (this.child) return;
    if (!this.connectPromise) {
      const connecting = this.connect();
      const tracked = connecting.finally(() => {
        if (this.connectPromise === tracked) this.connectPromise = null;
      });
      this.connectPromise = tracked;
    }
    await this.connectPromise;
  }

  private async connect(): Promise<void> {
    let child: ChildProcess;
    try {
      child = this.spawnFn(this.command, ['app-server', '--listen', 'stdio://'], {
        cwd: this.workspacePath,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new CodexTransportError(`Failed to start Codex app-server: ${errorMessage(error)}`);
    }

    this.child = child;
    this.stdoutBuffer = '';
    child.stdout?.on('data', (chunk: Buffer | string) => this.handleStdout(child, chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer | string) => this.emit('stderr', chunk.toString()));
    child.on('error', (error) => {
      this.failConnection(child, new CodexTransportError(`Codex app-server error: ${error.message}`));
      try { child.kill('SIGTERM'); } catch { /* already stopped */ }
    });
    child.on('close', (code, signal) => {
      this.failConnection(child, new CodexTransportError(
        signal ? `Codex app-server stopped with ${signal}` : `Codex app-server exited with code ${code ?? 'unknown'}`,
      ));
    });

    try {
      await this.requestOnConnectedProcess('initialize', {
        clientInfo: {
          name: 'field-theory-ambient',
          title: 'Field Theory Ambient',
          version: '0.1.0',
        },
        capabilities: { experimentalApi: true },
      });
      this.writeMessage({ method: 'initialized', params: {} });
    } catch (error) {
      this.failConnection(child, error instanceof Error ? error : new Error(String(error)));
      try { child.kill('SIGTERM'); } catch { /* already stopped */ }
      throw error;
    }
  }

  private request(method: string, params: JsonObject): Promise<unknown> {
    return this.ensureConnected().then(() => this.requestOnConnectedProcess(method, params));
  }

  private requestOnConnectedProcess(method: string, params: JsonObject): Promise<unknown> {
    if (!this.child) return Promise.reject(new CodexTransportError('Codex app-server is not connected'));
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new CodexTransportError(`Timed out waiting for Codex app-server ${method}`);
        this.restartConnection(error);
        reject(error);
      }, this.requestTimeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.writeMessage({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private writeMessage(message: JsonObject): void {
    const child = this.child;
    if (!child?.stdin) throw new CodexTransportError('Codex app-server stdin is unavailable');
    child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) this.failConnection(child, new CodexTransportError(`Failed to write to Codex app-server: ${error.message}`));
    });
  }

  private handleStdout(child: ChildProcess, chunk: string): void {
    if (this.child !== child) return;
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let message: JsonObject;
      try {
        message = asObject(JSON.parse(line));
      } catch {
        this.emit('protocol-error', new Error('Codex app-server emitted non-JSON output'));
        continue;
      }
      this.handleMessage(message);
    }
  }

  private handleMessage(message: JsonObject): void {
    if (typeof message.id === 'number' && typeof message.method === 'string') {
      this.writeMessage({
        id: message.id,
        error: { code: -32601, message: `Field Theory does not implement ${message.method}` },
      });
      return;
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(`${pending.method}: ${JSON.stringify(message.error)}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (typeof message.method === 'string') this.emit('notification', message);
  }

  private restartConnection(error = new CodexTransportError('Codex app-server connection reset')): void {
    const child = this.child;
    this.failConnection(child, error);
    if (child) {
      try { child.kill('SIGTERM'); } catch { /* already stopped */ }
    }
  }

  private failConnection(child: ChildProcess | null, error: Error): void {
    if (child && this.child !== child) return;
    this.child = null;
    this.connectPromise = null;
    this.stdoutBuffer = '';
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function ambientContextFilePrompt(contextFilePath: string): string {
  return `Ambient staffer cycle: read the meeting data in ${contextFilePath}, update your candidate questions, and investigate one useful answer if warranted.`;
}

function validateDelivery(delivery: AmbientTranscriptDelivery): void {
  if (!delivery.threadId.trim()) throw new Error('Codex thread id is required');
  if (!delivery.meetingId.trim()) throw new Error('Meeting id is required');
  if (!Number.isSafeInteger(delivery.firstSequence) || delivery.firstSequence < 0
    || !Number.isSafeInteger(delivery.lastSequence)
    || delivery.lastSequence < delivery.firstSequence) {
    throw new Error('Transcript sequence range is invalid');
  }
  if (!isSafeRelativeContextPath(delivery.contextFilePath)) {
    throw new Error('Ambient context file path must be a safe relative path');
  }
}

function isSafeRelativeContextPath(filePath: string): boolean {
  if (!filePath.trim() || path.isAbsolute(filePath) || filePath.includes('\n') || filePath.includes('\r')) return false;
  const normalized = path.normalize(filePath);
  const parts = normalized.split(path.sep);
  return parts.length === 2
    && parts[0] === '.ambient-context'
    && /^[A-Za-z0-9._-]+\.json$/.test(parts[1]);
}

function readThreadId(result: JsonObject): string {
  const thread = asObject(result.thread);
  if (typeof thread.id !== 'string' || !thread.id) throw new Error('Codex thread/start returned no thread id');
  return thread.id;
}


function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' ? value as JsonObject : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
