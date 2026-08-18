import crypto from 'crypto';
import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { type FieldTheoryPathOptions, kindleDeliveryDir } from './fieldTheoryPaths';
import { markKindleDeliverySent, type KindlePrepareResult } from './kindleDeliveryService';
import { createLogger } from './logger';

const log = createLogger('KindleCodexBridge');

export type KindleCodexJobStatus = 'queued' | 'running' | 'verifying' | 'sent' | 'failed';
export type KindleCodexSendStatus = 'queued' | 'already_sent' | 'blocked' | 'error';
export type KindleCodexJobReadStatus = 'ok' | 'missing' | 'error';

export interface KindleCodexJob {
  version: 1;
  status: KindleCodexJobStatus;
  createdAt: string;
  updatedAt: string;
  sourcePath: string;
  sourceRelPath: string;
  deliveryKey: string;
  artifactPath: string;
  title: string;
  author: string;
  recipientEmail: string;
  senderEmail: string;
  requestedBy: 'field-theory-mac-app';
  pid?: number;
  startedAt?: string;
  finishedAt?: string;
  sentAt?: string;
  sentMessageId?: string;
  sentAttachmentPath?: string;
  error?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
}

export interface KindleCodexSendResult {
  status: KindleCodexSendStatus;
  deliveryKey?: string;
  artifactPath?: string;
  jobPath?: string;
  job?: KindleCodexJob;
  message?: string;
}

export interface KindleCodexJobReadResult {
  status: KindleCodexJobReadStatus;
  jobPath?: string;
  job?: KindleCodexJob;
  message?: string;
}

type SpawnFn = (
  command: string,
  args: ReadonlyArray<string>,
  options: SpawnOptions,
) => ChildProcess;

export interface KindleCodexBridgeOptions extends FieldTheoryPathOptions {
  codexCommand?: string;
  spawnFn?: SpawnFn;
  now?: Date;
}

const ACTIVE_JOB_STATUSES = new Set<KindleCodexJobStatus>(['queued', 'running', 'verifying']);
const PATH_AUGMENTATIONS = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.bun', 'bin'),
  path.join(os.homedir(), '.cargo', 'bin'),
  path.join(os.homedir(), '.npm-global', 'bin'),
];

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function isInsidePath(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function safeJobPath(jobPath: string, options: FieldTheoryPathOptions = {}): string {
  const resolved = path.resolve(jobPath);
  const root = kindleCodexJobDir(options);
  if (!isInsidePath(resolved, root)) {
    throw new Error(`Kindle job path must stay inside ${root}`);
  }
  return resolved;
}

function buildCodexEnv(options: KindleCodexBridgeOptions): NodeJS.ProcessEnv {
  const baseEnv = { ...process.env, ...(options.env ?? {}) };
  const inheritedPath = baseEnv.PATH ?? process.env.PATH ?? '';
  return {
    ...baseEnv,
    PATH: [...PATH_AUGMENTATIONS, inheritedPath].filter(Boolean).join(path.delimiter),
  };
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isKindleCodexJob(value: unknown): value is KindleCodexJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<KindleCodexJob>;
  return job.version === 1
    && typeof job.status === 'string'
    && ['queued', 'running', 'verifying', 'sent', 'failed'].includes(job.status)
    && typeof job.deliveryKey === 'string'
    && typeof job.artifactPath === 'string'
    && typeof job.sourcePath === 'string'
    && typeof job.sourceRelPath === 'string'
    && typeof job.title === 'string'
    && typeof job.author === 'string'
    && typeof job.recipientEmail === 'string'
    && typeof job.senderEmail === 'string';
}

function updateJob(jobPath: string, updates: Partial<KindleCodexJob>, options: KindleCodexBridgeOptions = {}): KindleCodexJob {
  const current = readKindleCodexJob(jobPath, options);
  if (!current) {
    throw new Error(`Kindle Codex job not found: ${jobPath}`);
  }
  const next: KindleCodexJob = {
    ...current,
    ...updates,
    updatedAt: nowIso(options.now),
  };
  writeKindleCodexJob(jobPath, next, options);
  return next;
}

function markFailed(jobPath: string, error: string, options: KindleCodexBridgeOptions, extra: Partial<KindleCodexJob> = {}): KindleCodexJob | null {
  try {
    return updateJob(jobPath, {
      ...extra,
      status: 'failed',
      error,
      finishedAt: nowIso(options.now),
    }, options);
  } catch (err) {
    log.warn('Could not mark Kindle Codex job failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

function syncSentDelivery(job: KindleCodexJob, options: FieldTheoryPathOptions = {}): void {
  if (job.status !== 'sent' || !job.sentMessageId) return;
  try {
    markKindleDeliverySent(job.deliveryKey, {
      ...options,
      messageId: job.sentMessageId,
      sentAt: job.sentAt ? new Date(job.sentAt) : undefined,
    });
  } catch (err) {
    log.warn('Could not sync Kindle sent state:', err instanceof Error ? err.message : String(err));
  }
}

function outputTail(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 1200 ? trimmed.slice(trimmed.length - 1200) : trimmed;
}

function attachCodexExitHandlers(child: ChildProcess, jobPath: string, options: KindleCodexBridgeOptions): void {
  let stdout = '';
  let stderr = '';

  const append = (kind: 'stdout' | 'stderr', chunk: Buffer): void => {
    const text = chunk.toString('utf8');
    if (kind === 'stdout') stdout = outputTail(`${stdout}${text}`);
    else stderr = outputTail(`${stderr}${text}`);
  };

  child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk));
  child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk));

  child.on('error', (err) => {
    markFailed(jobPath, `Codex failed to start: ${err.message}`, options);
  });

  child.on('exit', (code, signal) => {
    let current: KindleCodexJob | null = null;
    try {
      current = readKindleCodexJob(jobPath, options);
    } catch (err) {
      log.warn('Could not read Kindle Codex job after exit:', err instanceof Error ? err.message : String(err));
    }

    if (current?.status === 'sent') {
      syncSentDelivery(current, options);
      return;
    }
    if (current?.status === 'failed') return;

    const error = code === 0 && !signal
      ? 'Codex finished without verified Kindle send.'
      : signal
        ? `Codex exited before Kindle send verification (${signal}).`
        : `Codex exited before Kindle send verification (code ${code ?? 'unknown'}).`;
    const tail = [stderr, stdout].map(outputTail).filter(Boolean).join('\n\n');
    markFailed(jobPath, tail ? `${error}\n\n${tail}` : error, options, { exitCode: code, signal });
  });
}

export function kindleCodexJobDir(options: FieldTheoryPathOptions = {}): string {
  return path.join(kindleDeliveryDir(options), 'jobs');
}

export function kindleCodexJobPathForDeliveryKey(deliveryKey: string, options: FieldTheoryPathOptions = {}): string {
  const digest = crypto.createHash('sha256').update(deliveryKey).digest('hex').slice(0, 24);
  return path.join(kindleCodexJobDir(options), `${digest}.json`);
}

export function writeKindleCodexJob(jobPath: string, job: KindleCodexJob, options: FieldTheoryPathOptions = {}): void {
  writeJsonAtomic(safeJobPath(jobPath, options), job);
}

export function readKindleCodexJob(jobPath: string, options: FieldTheoryPathOptions = {}): KindleCodexJob | null {
  const resolved = safeJobPath(jobPath, options);
  if (!fs.existsSync(resolved)) return null;
  const parsed = readJson(resolved);
  if (!isKindleCodexJob(parsed)) {
    throw new Error(`Invalid Kindle Codex job: ${resolved}`);
  }
  syncSentDelivery(parsed, options);
  return parsed;
}

export function readKindleCodexJobResult(jobPath: string, options: FieldTheoryPathOptions = {}): KindleCodexJobReadResult {
  try {
    const resolved = safeJobPath(jobPath, options);
    const job = readKindleCodexJob(resolved, options);
    return job ? { status: 'ok', jobPath: resolved, job } : { status: 'missing', jobPath: resolved };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function createKindleCodexJob(prepared: KindlePrepareResult, options: KindleCodexBridgeOptions = {}): { jobPath: string; job: KindleCodexJob } {
  const preflight = prepared.sendPreflight;
  const createdAt = nowIso(options.now);
  const job: KindleCodexJob = {
    version: 1,
    status: 'queued',
    createdAt,
    updatedAt: createdAt,
    sourcePath: prepared.document.sourcePath,
    sourceRelPath: prepared.document.sourceRelPath,
    deliveryKey: prepared.deliveryKey,
    artifactPath: prepared.artifactPath,
    title: prepared.document.title,
    author: prepared.record?.author ?? prepared.existingRecord?.author ?? 'Andrew Farah',
    recipientEmail: preflight.recipientEmail,
    senderEmail: preflight.senderEmail,
    requestedBy: 'field-theory-mac-app',
  };
  return {
    jobPath: kindleCodexJobPathForDeliveryKey(prepared.deliveryKey, options),
    job,
  };
}

export function buildKindleCodexPrompt(jobPath: string, job: KindleCodexJob): string {
  return [
    'Use $kindle to send an already prepared Field Theory EPUB to Kindle.',
    '',
    'This is a Field Theory Mac app delivery job. Keep the source document canonical and do not edit it.',
    '',
    `Job file: ${jobPath}`,
    `Source markdown: ${job.sourcePath}`,
    `Prepared EPUB artifact: ${job.artifactPath}`,
    `Delivery key: ${job.deliveryKey}`,
    `Title: ${job.title}`,
    `Author: ${job.author}`,
    `Send from: ${job.senderEmail}`,
    `Send to: ${job.recipientEmail}`,
    '',
    'Required job-file updates:',
    '- Immediately write the job JSON back with status "running".',
    '- Before checking Gmail Sent, write status "verifying".',
    '- Only after Gmail Sent verification succeeds, write status "sent", sentAt as an ISO timestamp, and sentMessageId.',
    '- If blocked, write status "failed" and a short error explaining the blocker.',
    '- Preserve the existing JSON fields when updating the file.',
    '',
    'Delivery rules:',
    '- Send the existing prepared EPUB artifact above. Do not rewrite the chapter.',
    '- Validate the EPUB with unzip and inspect metadata before sending.',
    '- If a Kindle Drop copy is needed, copy the artifact; do not move or delete the prepared artifact.',
    '- Send one email with the EPUB attached using Gmail.',
    '- Do not mark the job sent until Gmail returns a sent message id or Sent mail confirms it.',
    '- Field Theory will sync the delivery state from the verified job, so do not edit state.json directly.',
  ].join('\n');
}

export function startKindleCodexSend(prepared: KindlePrepareResult, options: KindleCodexBridgeOptions = {}): KindleCodexSendResult {
  if (prepared.status === 'already_sent') {
    return {
      status: 'already_sent',
      deliveryKey: prepared.deliveryKey,
      artifactPath: prepared.artifactPath,
      message: 'Already sent to Kindle.',
    };
  }

  if (prepared.status === 'blocked' || prepared.status === 'dry_run') {
    return {
      status: 'blocked',
      deliveryKey: prepared.deliveryKey,
      artifactPath: prepared.artifactPath,
      message: prepared.message ?? 'Kindle EPUB was not prepared.',
    };
  }

  if (!fs.existsSync(prepared.artifactPath)) {
    return {
      status: 'blocked',
      deliveryKey: prepared.deliveryKey,
      artifactPath: prepared.artifactPath,
      message: 'Kindle EPUB artifact is missing.',
    };
  }

  const { jobPath, job } = createKindleCodexJob(prepared, options);
  const existing = fs.existsSync(jobPath) ? readKindleCodexJob(jobPath, options) : null;
  if (existing && ACTIVE_JOB_STATUSES.has(existing.status)) {
    return { status: 'queued', deliveryKey: existing.deliveryKey, artifactPath: existing.artifactPath, jobPath, job: existing };
  }
  if (existing?.status === 'sent') {
    return { status: 'already_sent', deliveryKey: existing.deliveryKey, artifactPath: existing.artifactPath, jobPath, job: existing };
  }

  writeKindleCodexJob(jobPath, job, options);

  const prompt = buildKindleCodexPrompt(jobPath, job);
  const command = options.codexCommand ?? 'codex';
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox',
    '--cd',
    path.dirname(job.sourcePath),
    prompt,
  ];
  const spawnFn = options.spawnFn ?? spawn;

  try {
    const child = spawnFn(command, args, {
      cwd: path.dirname(job.sourcePath),
      env: buildCodexEnv(options),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const running = updateJob(jobPath, {
      status: 'running',
      pid: typeof child.pid === 'number' ? child.pid : undefined,
      startedAt: nowIso(options.now),
    }, options);
    attachCodexExitHandlers(child, jobPath, options);
    return { status: 'queued', deliveryKey: job.deliveryKey, artifactPath: job.artifactPath, jobPath, job: running };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = markFailed(jobPath, `Codex unavailable: ${message}`, options);
    return {
      status: 'error',
      deliveryKey: job.deliveryKey,
      artifactPath: job.artifactPath,
      jobPath,
      job: failed ?? job,
      message: `Codex unavailable: ${message}`,
    };
  }
}
