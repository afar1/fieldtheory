// Pure scan core (no DB, no events, no electron/chokidar) — shared by the
// manager's in-process path and the off-main-thread utility-process worker
// (taggedDocsWorker.ts). Imports only crypto/fs/path so the worker can load it
// without pulling in better-sqlite3, chokidar, or electron.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const MARKDOWN_EXTENSIONS = new Set(['.md']);
// Hard cap on how much of a markdown file we'll read during a scan. Real tagged
// docs are tiny; this bounds worst-case accidental hydration of a cloud
// placeholder even if the dataless heuristic ever misjudges a file.
export const SCAN_MAX_READ_BYTES = 1024 * 1024;
// Path fragments that indicate a cloud-synced tree, where reading a not-yet-
// downloaded ("dataless") file triggers a slow network hydration.
export const CLOUD_ROOT_MARKERS = ['/Library/CloudStorage/', '/Library/Mobile Documents/', '/Google Drive', '/Dropbox'];

export function isUnderCloudRoot(filePath: string): boolean {
  return CLOUD_ROOT_MARKERS.some((marker) => filePath.includes(marker));
}

// st_flags / UF_DATALESS isn't reachable from Node's fs, but `blocks` is: fewer
// 512-byte blocks allocated locally than the logical size means the file isn't
// fully on disk, so reading it would hydrate it over the network. Verified on
// iCloud and Google Drive. Only meaningful under a cloud root.
export function isLikelyDataless(stat: fs.Stats): boolean {
  return stat.size > 0 && stat.blocks * 512 < stat.size;
}
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
export const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export type ParsedYamlValue =
  | string
  | number
  | boolean
  | null
  | ParsedYamlValue[]
  | { [key: string]: ParsedYamlValue };

export type ParsedFrontmatter = Record<string, ParsedYamlValue>;

export interface ParsedTaggedDoc {
  ulid: string;
  title: string;
  taggedBy: string | null;
  taggedAt: number | null;
  frontmatterUpdatedAt: number;
  fileHash: string;
  taggedForCurrentEmail: boolean;
}

export function isMarkdownPath(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || null;
}

export function isCommonIgnoredDir(name: string): boolean {
  return name === '.git' ||
    name === 'node_modules' ||
    name === '.Trash' ||
    name === '.DS_Store';
}

export function stripInlineComment(value: string): string {
  let quote: string | null = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if ((char === '"' || char === "'") && value[i - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (char === '#' && !quote && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value;
}

export function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  let depth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if ((char === '"' || char === "'") && input[i - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char;
      current += char;
      continue;
    }
    if (!quote) {
      if (char === '[' || char === '{') depth += 1;
      if (char === ']' || char === '}') depth -= 1;
      if (char === separator && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += char;
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }
  return parts;
}

export function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseInlineValue(rawValue: string): ParsedYamlValue {
  const value = stripInlineComment(rawValue).trim();
  if (value === '' || value === '~' || value.toLowerCase() === 'null') return null;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;

  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner, ',').map(parseInlineValue);
  }

  if (value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1).trim();
    const object: Record<string, ParsedYamlValue> = {};
    if (!inner) return object;

    for (const entry of splitTopLevel(inner, ',')) {
      const colonIndex = entry.indexOf(':');
      if (colonIndex <= 0) {
        throw new Error(`Invalid inline object entry: ${entry}`);
      }
      const key = entry.slice(0, colonIndex).trim();
      object[key] = parseInlineValue(entry.slice(colonIndex + 1));
    }
    return object;
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return unquote(value);
}

export function getIndent(line: string): number {
  const match = line.match(/^ */);
  return match ? match[0].length : 0;
}

export function findTopLevelColon(line: string): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if ((char === '"' || char === "'") && line[i - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (char === ':' && !quote) {
      return i;
    }
  }
  return -1;
}

export function parseYamlBlock(lines: string[], startIndex: number): { value: ParsedYamlValue; nextIndex: number } {
  const firstLine = lines[startIndex];
  const baseIndent = getIndent(firstLine);
  const firstTrimmed = firstLine.trim();

  if (firstTrimmed.startsWith('- ')) {
    const items: ParsedYamlValue[] = [];
    let index = startIndex;

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();
      if (!trimmed) {
        index += 1;
        continue;
      }
      const indent = getIndent(line);
      if (indent < baseIndent || (indent === 0 && !trimmed.startsWith('- '))) break;
      if (indent !== baseIndent || !trimmed.startsWith('- ')) {
        throw new Error(`Invalid array item indentation: ${line}`);
      }

      const itemText = trimmed.slice(2).trim();
      const colonIndex = findTopLevelColon(itemText);
      if (colonIndex > 0 && !itemText.startsWith('{')) {
        const object: Record<string, ParsedYamlValue> = {};
        const key = itemText.slice(0, colonIndex).trim();
        object[key] = parseInlineValue(itemText.slice(colonIndex + 1));
        index += 1;

        while (index < lines.length) {
          const nextLine = lines[index];
          const nextTrimmed = nextLine.trim();
          if (!nextTrimmed) {
            index += 1;
            continue;
          }
          const nextIndent = getIndent(nextLine);
          if (nextIndent <= baseIndent) break;
          const nextColon = findTopLevelColon(nextTrimmed);
          if (nextColon <= 0) {
            throw new Error(`Invalid object entry: ${nextLine}`);
          }
          object[nextTrimmed.slice(0, nextColon).trim()] = parseInlineValue(nextTrimmed.slice(nextColon + 1));
          index += 1;
        }
        items.push(object);
        continue;
      }

      items.push(parseInlineValue(itemText));
      index += 1;
    }

    return { value: items, nextIndex: index };
  }

  const object: Record<string, ParsedYamlValue> = {};
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    const indent = getIndent(line);
    if (indent < baseIndent || indent === 0) break;
    const colonIndex = findTopLevelColon(trimmed);
    if (colonIndex <= 0) {
      throw new Error(`Invalid object entry: ${line}`);
    }
    object[trimmed.slice(0, colonIndex).trim()] = parseInlineValue(trimmed.slice(colonIndex + 1));
    index += 1;
  }

  return { value: object, nextIndex: index };
}

export function parseFrontmatter(content: string): { data: ParsedFrontmatter; body: string } | null {
  if (!content.startsWith('---')) {
    return null;
  }

  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return null;
  }

  const endIndex = normalized.indexOf('\n---', 4);
  if (endIndex === -1) {
    // Treat a file that opens with `---` but never closes it as having no usable
    // frontmatter rather than throwing — non-frontmatter markdown (e.g. a doc that
    // starts with a `---` rule or a code fence) is expected input during a scan,
    // not an error worth surfacing or paying a throw for per file.
    return null;
  }

  const delimiterEnd = normalized.indexOf('\n', endIndex + 1);
  const frontmatter = normalized.slice(4, endIndex);
  const body = delimiterEnd === -1 ? '' : normalized.slice(delimiterEnd + 1);
  const lines = frontmatter.split('\n');
  const data: ParsedFrontmatter = {};

  try {
    let index = 0;
    while (index < lines.length) {
      const rawLine = lines[index];
      const line = stripInlineComment(rawLine).trimEnd();
      const trimmed = line.trim();
      if (!trimmed) {
        index += 1;
        continue;
      }
      if (getIndent(rawLine) !== 0) {
        throw new Error(`Unexpected indented top-level line: ${rawLine}`);
      }

      const colonIndex = findTopLevelColon(trimmed);
      if (colonIndex <= 0) {
        throw new Error(`Invalid frontmatter line: ${rawLine}`);
      }

      const key = trimmed.slice(0, colonIndex).trim();
      const rawValue = trimmed.slice(colonIndex + 1);
      if (rawValue.trim().length > 0) {
        data[key] = parseInlineValue(rawValue);
        index += 1;
        continue;
      }

      index += 1;
      while (index < lines.length && lines[index].trim().length === 0) {
        index += 1;
      }
      if (index >= lines.length || getIndent(lines[index]) === 0) {
        data[key] = null;
        continue;
      }
      const parsed = parseYamlBlock(lines, index);
      data[key] = parsed.value;
      index = parsed.nextIndex;
    }
  } catch {
    // Malformed YAML in the frontmatter block — skip the file gracefully instead
    // of throwing; the scan reads thousands of files and must not fail per file.
    return null;
  }

  return { data, body };
}

function collectEmails(value: ParsedYamlValue | undefined, emails: Set<string>): void {
  if (value === undefined || value === null) return;

  if (typeof value === 'string') {
    for (const match of value.matchAll(EMAIL_PATTERN)) {
      const normalized = normalizeEmail(match[0]);
      if (normalized) emails.add(normalized);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectEmails(item, emails);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const nested of Object.values(value)) {
      collectEmails(nested, emails);
    }
  }
}

function stringValue(value: ParsedYamlValue | undefined): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function taggedByValue(value: ParsedYamlValue | undefined): string | null {
  const direct = stringValue(value);
  if (direct) return direct;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const email = stringValue(value.email);
    if (email) return email;
    const name = stringValue(value.name) ?? stringValue(value.display_name);
    if (name) return name;
  }
  return null;
}

function parseDateMs(value: ParsedYamlValue | undefined): number | null {
  const raw = stringValue(value);
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function headingTitle(body: string): string | null {
  for (const line of body.split('\n')) {
    const match = line.match(/^#\s+(.+)$/);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

function titleFromPath(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

// ---------------------------------------------------------------------------
// Pure scan core (no DB, no events) — shared by the manager's in-process path
// and the off-main-thread utility-process worker (taggedDocsWorker.ts).
// ---------------------------------------------------------------------------

export interface ScanLedgerEntry { mtimeMs: number; size: number; }
export interface ScanFileResult { path: string; mtimeMs: number; size: number; parsed: ParsedTaggedDoc | null; ledgerOnly: boolean; }
export interface ScanOutput { results: ScanFileResult[]; seenPaths: string[]; scanned: number; read: number; matched: number; }

export async function* walkMarkdownFiles(root: string): AsyncGenerator<string> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (isCommonIgnoredDir(entry.name)) continue;
      yield* walkMarkdownFiles(entryPath);
      continue;
    }
    if (entry.isFile() && isMarkdownPath(entryPath)) yield entryPath;
  }
}

export function parseTaggedDocFields(filePath: string, content: string, mtimeMs: number, email: string | null): ParsedTaggedDoc | null {
  // parseFrontmatter returns null (never throws) for non-/malformed frontmatter.
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) return null;

  const ulid = stringValue(frontmatter.data.id) ?? stringValue(frontmatter.data.ulid);
  if (!ulid || !ULID_PATTERN.test(ulid)) return null;

  const title = stringValue(frontmatter.data.title) ?? headingTitle(frontmatter.body) ?? titleFromPath(filePath);
  const taggedAt = parseDateMs(frontmatter.data.created_at) ?? parseDateMs(frontmatter.data.tagged_at);
  const frontmatterUpdatedAt =
    parseDateMs(frontmatter.data.updated_at) ??
    parseDateMs(frontmatter.data.frontmatter_updated_at) ??
    taggedAt ??
    mtimeMs;
  const taggedEmails = new Set<string>();
  collectEmails(frontmatter.data.to, taggedEmails);
  collectEmails(frontmatter.data.cc, taggedEmails);

  return {
    ulid: ulid.toUpperCase(),
    title,
    taggedBy: taggedByValue(frontmatter.data.from) ?? taggedByValue(frontmatter.data.tagged_by),
    taggedAt,
    frontmatterUpdatedAt,
    fileHash: crypto.createHash('sha256').update(content).digest('hex'),
    taggedForCurrentEmail: email !== null && taggedEmails.has(email),
  };
}

// Walk the roots, skipping (via the ledger) any file whose mtime+size is
// unchanged, and read+parse only changed/new files (never hydrating a dataless
// cloud placeholder or reading past the size cap). Pure: returns results for the
// caller to apply to the DB. Safe to run in a worker.
export async function scanRoots(opts: {
  roots: string[];
  email: string | null;
  ledger: Map<string, ScanLedgerEntry>;
  maxReadBytes?: number;
}): Promise<ScanOutput> {
  const maxReadBytes = opts.maxReadBytes ?? SCAN_MAX_READ_BYTES;
  const results: ScanFileResult[] = [];
  const seenPaths: string[] = [];
  let scanned = 0;
  let read = 0;
  let matched = 0;

  for (const root of opts.roots) {
    for await (const filePath of walkMarkdownFiles(root)) {
      scanned += 1;
      seenPaths.push(filePath);

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(filePath);
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }

      const mtimeMs = Math.floor(stat.mtimeMs);
      const size = stat.size;
      const known = opts.ledger.get(filePath);
      if (known && known.mtimeMs === mtimeMs && known.size === size) {
        continue; // unchanged — no read, no parse, no hash
      }

      if (size > maxReadBytes || (isUnderCloudRoot(filePath) && isLikelyDataless(stat))) {
        results.push({ path: filePath, mtimeMs, size, parsed: null, ledgerOnly: true });
        continue;
      }

      let content: string;
      try {
        content = await fs.promises.readFile(filePath, 'utf-8');
        read += 1;
      } catch {
        continue;
      }
      const parsed = parseTaggedDocFields(filePath, content, mtimeMs, opts.email);
      const tagged = parsed?.taggedForCurrentEmail ? parsed : null;
      if (tagged) matched += 1;
      results.push({ path: filePath, mtimeMs, size, parsed: tagged, ledgerOnly: false });
    }
  }

  return { results, seenPaths, scanned, read, matched };
}
