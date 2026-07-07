import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  type FieldTheoryPathOptions,
  kindleArtifactDir,
  kindleDeliveryStatePath,
  libraryDir,
} from './fieldTheoryPaths';
import { isMarkdownDocumentPath, isPathInside, stripMarkdownFileExtension } from './pathSafety';

export type KindleDeliveryFormat = 'epub' | 'pdf';
export type KindleDeliveryRecordStatus = 'prepared' | 'sent';
export type KindlePrepareStatus = 'dry_run' | 'prepared' | 'already_prepared' | 'already_sent' | 'blocked';
export type KindlePrepareBlockReason =
  | 'converter_unavailable'
  | 'conversion_failed'
  | 'artifact_missing';

export interface KindleResolvedDocument {
  title: string;
  rootPath: string;
  sourcePath: string;
  sourceRelPath: string;
  contentHash: string;
  updatedAtMs: number;
}

export interface KindleConversionInput {
  sourcePath: string;
  artifactPath: string;
  title: string;
  author: string;
  format: KindleDeliveryFormat;
}

export interface KindleConversionResult {
  ok: boolean;
  reason?: KindlePrepareBlockReason;
  message?: string;
}

export type KindleConverter = (input: KindleConversionInput) => Promise<KindleConversionResult> | KindleConversionResult;

export interface KindleDeliveryRecord {
  key: string;
  title: string;
  author: string;
  format: KindleDeliveryFormat;
  sourcePath: string;
  sourceRelPath: string;
  contentHash: string;
  artifactPath: string;
  status: KindleDeliveryRecordStatus;
  preparedAt: string;
  sentAt?: string;
  sentMessageId?: string;
}

export interface KindleDeliveryState {
  version: 1;
  updatedAt: string;
  deliveries: KindleDeliveryRecord[];
}

export interface KindleSendPreflight {
  recipientEmail: string;
  senderEmail: string;
  subject: string;
  attachmentPath: string;
}

export interface KindlePrepareResult {
  status: KindlePrepareStatus;
  document: KindleResolvedDocument;
  deliveryKey: string;
  artifactPath: string;
  statePath: string;
  sendPreflight: KindleSendPreflight;
  existingRecord?: KindleDeliveryRecord;
  record?: KindleDeliveryRecord;
  reason?: KindlePrepareBlockReason;
  message?: string;
}

export interface KindlePrepareOptions extends FieldTheoryPathOptions {
  libraryRoots?: string[];
  format?: KindleDeliveryFormat;
  author?: string;
  recipientEmail?: string;
  senderEmail?: string;
  dryRun?: boolean;
  force?: boolean;
  now?: Date;
  converter?: KindleConverter;
}

export interface MarkKindleDeliverySentOptions extends FieldTheoryPathOptions {
  messageId: string;
  sentAt?: Date;
}

const DEFAULT_AUTHOR = 'Andrew Farah';
const DEFAULT_RECIPIENT_EMAIL = 'andrew.mfarah_xoV5w8@kindle.com';
const DEFAULT_SENDER_EMAIL = 'andrew@density.io';

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function portableRelPath(rootPath: string, filePath: string): string {
  return path.relative(rootPath, filePath).split(path.sep).join('/');
}

function safeStem(value: string, fallback = 'document'): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return (cleaned || fallback).slice(0, 120);
}

function normalizeLookup(value: string): string {
  return stripMarkdownFileExtension(value)
    .replace(/\\/g, '/')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleFromMarkdown(content: string, filePath: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || stripMarkdownFileExtension(path.basename(filePath)).trim() || 'Untitled';
}

function defaultState(): KindleDeliveryState {
  return {
    version: 1,
    updatedAt: nowIso(),
    deliveries: [],
  };
}

export function loadKindleDeliveryState(options: FieldTheoryPathOptions = {}): KindleDeliveryState {
  const statePath = kindleDeliveryStatePath(options);
  if (!fs.existsSync(statePath)) return defaultState();

  const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<KindleDeliveryState>;
  return {
    version: 1,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
    deliveries: Array.isArray(parsed.deliveries) ? parsed.deliveries.filter(isDeliveryRecord) : [],
  };
}

function isDeliveryRecord(value: unknown): value is KindleDeliveryRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<KindleDeliveryRecord>;
  return typeof record.key === 'string'
    && typeof record.title === 'string'
    && typeof record.sourcePath === 'string'
    && typeof record.sourceRelPath === 'string'
    && typeof record.contentHash === 'string'
    && typeof record.artifactPath === 'string'
    && (record.status === 'prepared' || record.status === 'sent');
}

function saveKindleDeliveryState(state: KindleDeliveryState, options: FieldTheoryPathOptions = {}, now?: Date): void {
  const statePath = kindleDeliveryStatePath(options);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const nextState = { ...state, updatedAt: nowIso(now) };
  const tempPath = `${statePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(nextState, null, 2)}\n`);
  fs.renameSync(tempPath, statePath);
}

function libraryRoots(options: KindlePrepareOptions): string[] {
  return (options.libraryRoots?.length ? options.libraryRoots : [libraryDir(options)])
    .map((rootPath) => path.resolve(rootPath));
}

function readResolvedDocument(rootPath: string, sourcePath: string): KindleResolvedDocument {
  const content = fs.readFileSync(sourcePath, 'utf8');
  const stats = fs.statSync(sourcePath);
  return {
    title: titleFromMarkdown(content, sourcePath),
    rootPath,
    sourcePath,
    sourceRelPath: portableRelPath(rootPath, sourcePath),
    contentHash: contentHash(content),
    updatedAtMs: stats.mtimeMs,
  };
}

function candidateRelativeTargets(target: string): string[] {
  const normalized = target.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized || normalized.split('/').some((part) => part === '.' || part === '..')) return [];
  const candidates = [normalized];
  if (!/\.(md|markdown)$/i.test(normalized)) {
    candidates.push(`${normalized}.md`, `${normalized}.markdown`);
  }
  return candidates;
}

function walkMarkdownFiles(rootPath: string): string[] {
  if (!fs.existsSync(rootPath)) return [];
  const files: string[] = [];

  function walk(dirPath: string): void {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile() && isMarkdownDocumentPath(entryPath)) {
        files.push(entryPath);
      }
    }
  }

  walk(rootPath);
  return files.sort();
}

function resolveAbsoluteDocument(target: string, roots: string[]): KindleResolvedDocument | null {
  if (!path.isAbsolute(target)) return null;

  const sourcePath = path.resolve(target);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Kindle source document not found: ${target}`);
  }
  if (!isMarkdownDocumentPath(sourcePath)) {
    throw new Error(`Kindle delivery currently supports markdown Library documents only: ${target}`);
  }

  const rootPath = roots.find((root) => isPathInside(root, sourcePath));
  if (!rootPath) {
    throw new Error(`Kindle source document must be inside a Field Theory Library root: ${target}`);
  }

  return readResolvedDocument(rootPath, sourcePath);
}

export function resolveKindleLibraryDocument(target: string, options: KindlePrepareOptions = {}): KindleResolvedDocument {
  const roots = libraryRoots(options);
  const absolute = resolveAbsoluteDocument(target, roots);
  if (absolute) return absolute;

  for (const relTarget of candidateRelativeTargets(target)) {
    for (const rootPath of roots) {
      const sourcePath = path.resolve(rootPath, ...relTarget.split('/'));
      if (isPathInside(rootPath, sourcePath) && fs.existsSync(sourcePath) && isMarkdownDocumentPath(sourcePath)) {
        return readResolvedDocument(rootPath, sourcePath);
      }
    }
  }

  const lookup = normalizeLookup(target);
  const matches = roots.flatMap((rootPath) =>
    walkMarkdownFiles(rootPath).flatMap((sourcePath) => {
      const doc = readResolvedDocument(rootPath, sourcePath);
      const relWithoutExtension = stripMarkdownFileExtension(doc.sourceRelPath);
      const candidates = [
        doc.title,
        path.basename(relWithoutExtension),
        relWithoutExtension,
      ].map(normalizeLookup);
      return candidates.includes(lookup) ? [doc] : [];
    }),
  );

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Kindle source document is ambiguous: ${target}`);
  }
  throw new Error(`Kindle source document not found: ${target}`);
}

function deliveryKey(doc: KindleResolvedDocument, format: KindleDeliveryFormat): string {
  return `${doc.sourceRelPath}:${doc.contentHash}:${format}`;
}

function artifactPathForDocument(doc: KindleResolvedDocument, format: KindleDeliveryFormat, options: FieldTheoryPathOptions = {}): string {
  const sourceStem = safeStem(stripMarkdownFileExtension(doc.sourceRelPath).replace(/\//g, ' - '), 'library-document');
  return path.join(kindleArtifactDir(options), sourceStem, `${doc.contentHash.slice(0, 16)}.${format}`);
}

function sendPreflightFor(title: string, artifactPath: string, options: KindlePrepareOptions): KindleSendPreflight {
  return {
    recipientEmail: options.recipientEmail ?? DEFAULT_RECIPIENT_EMAIL,
    senderEmail: options.senderEmail ?? DEFAULT_SENDER_EMAIL,
    subject: `Send to Kindle - ${title}`,
    attachmentPath: artifactPath,
  };
}

function ebookConvertCandidates(): string[] {
  return [
    process.env.FT_EBOOK_CONVERT_PATH,
    'ebook-convert',
    '/opt/homebrew/bin/ebook-convert',
    '/usr/local/bin/ebook-convert',
    '/Applications/calibre.app/Contents/MacOS/ebook-convert',
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function convertWithEbookConvert(input: KindleConversionInput): KindleConversionResult {
  fs.mkdirSync(path.dirname(input.artifactPath), { recursive: true });
  const args = [
    input.sourcePath,
    input.artifactPath,
    '--title',
    input.title,
    '--authors',
    input.author,
  ];

  for (const candidate of ebookConvertCandidates()) {
    const result = spawnSync(candidate, args, { encoding: 'utf8' });

    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      continue;
    }
    if (result.error) {
      return {
        ok: false,
        reason: 'conversion_failed',
        message: result.error.message,
      };
    }
    if (result.status !== 0) {
      return {
        ok: false,
        reason: 'conversion_failed',
        message: result.stderr?.trim() || result.stdout?.trim() || 'ebook-convert failed.',
      };
    }
    if (!fs.existsSync(input.artifactPath)) {
      return {
        ok: false,
        reason: 'artifact_missing',
        message: 'ebook-convert completed without creating the Kindle artifact.',
      };
    }

    return { ok: true };
  }

  return {
    ok: false,
    reason: 'converter_unavailable',
    message: 'ebook-convert is not installed or not on PATH.',
  };
}

export async function prepareKindleDelivery(target: string, options: KindlePrepareOptions = {}): Promise<KindlePrepareResult> {
  const format = options.format ?? 'epub';
  if (format !== 'epub' && format !== 'pdf') {
    throw new Error(`Unsupported Kindle delivery format: ${format}`);
  }

  const document = resolveKindleLibraryDocument(target, options);
  const key = deliveryKey(document, format);
  const artifactPath = artifactPathForDocument(document, format, options);
  const statePath = kindleDeliveryStatePath(options);
  const sendPreflight = sendPreflightFor(document.title, artifactPath, options);
  const state = loadKindleDeliveryState(options);
  const existingRecord = state.deliveries.find((record) => record.key === key && (record.status === 'prepared' || record.status === 'sent'));

  if (existingRecord && !options.force && (existingRecord.status === 'sent' || fs.existsSync(existingRecord.artifactPath))) {
    return {
      status: existingRecord.status === 'sent' ? 'already_sent' : 'already_prepared',
      document,
      deliveryKey: key,
      artifactPath,
      statePath,
      sendPreflight,
      existingRecord,
    };
  }

  if (options.dryRun) {
    return {
      status: 'dry_run',
      document,
      deliveryKey: key,
      artifactPath,
      statePath,
      sendPreflight,
    };
  }

  const converter = options.converter ?? convertWithEbookConvert;
  const converted = await converter({
    sourcePath: document.sourcePath,
    artifactPath,
    title: document.title,
    author: options.author ?? DEFAULT_AUTHOR,
    format,
  });

  if (!converted.ok) {
    return {
      status: 'blocked',
      document,
      deliveryKey: key,
      artifactPath,
      statePath,
      sendPreflight,
      reason: converted.reason ?? 'conversion_failed',
      message: converted.message,
    };
  }

  const record: KindleDeliveryRecord = {
    key,
    title: document.title,
    author: options.author ?? DEFAULT_AUTHOR,
    format,
    sourcePath: document.sourcePath,
    sourceRelPath: document.sourceRelPath,
    contentHash: document.contentHash,
    artifactPath,
    status: 'prepared',
    preparedAt: nowIso(options.now),
  };

  state.deliveries = [
    ...state.deliveries.filter((delivery) => delivery.key !== key),
    record,
  ];
  saveKindleDeliveryState(state, options, options.now);

  return {
    status: 'prepared',
    document,
    deliveryKey: key,
    artifactPath,
    statePath,
    sendPreflight,
    record,
  };
}

export function markKindleDeliverySent(deliveryKey: string, options: MarkKindleDeliverySentOptions): KindleDeliveryRecord {
  const state = loadKindleDeliveryState(options);
  const delivery = state.deliveries.find((record) => record.key === deliveryKey);
  if (!delivery) {
    throw new Error(`Kindle delivery record not found: ${deliveryKey}`);
  }

  delivery.status = 'sent';
  delivery.sentAt = nowIso(options.sentAt);
  delivery.sentMessageId = options.messageId;
  saveKindleDeliveryState(state, options, options.sentAt);
  return delivery;
}
