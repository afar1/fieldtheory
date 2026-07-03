import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type DocumentVersion = {
  mtimeMs: number;
  size: number;
  sha256: string;
};

export type DocumentSaveResult =
  | { ok: true; version: DocumentVersion }
  | { ok: false; reason: 'blocked' | 'conflict' | 'error' | 'not-found'; currentContent?: string; currentVersion?: DocumentVersion };

export function readDocumentVersion(filePath: string): DocumentVersion {
  const content = fs.readFileSync(filePath);
  const stats = fs.statSync(filePath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };
}

function documentVersionsMatch(left: DocumentVersion, right: DocumentVersion): boolean {
  return left.size === right.size && left.sha256 === right.sha256;
}

function fsyncDirectoryBestEffort(dirPath: string): void {
  let dirFd: number | null = null;
  try {
    dirFd = fs.openSync(dirPath, 'r');
    fs.fsyncSync(dirFd);
  } catch {
    // Directory fsync is best-effort across platforms and filesystems.
  } finally {
    if (dirFd !== null) {
      try {
        fs.closeSync(dirFd);
      } catch {}
    }
  }
}

export function writeTextFileAtomically(filePath: string, content: string): void {
  const dirPath = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const tempPath = path.join(dirPath, `.${fileName}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const mode = fs.existsSync(filePath) ? fs.statSync(filePath).mode & 0o777 : 0o600;
  let fd: number | null = null;

  try {
    fd = fs.openSync(tempPath, 'wx', mode);
    fs.writeFileSync(fd, content, 'utf-8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempPath, filePath);
    fsyncDirectoryBestEffort(dirPath);
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
    try {
      fs.unlinkSync(tempPath);
    } catch {}
    throw error;
  }
}

export function writeTextFileWithConflictGuard(
  filePath: string,
  content: string,
  expectedVersion?: DocumentVersion | null,
): DocumentSaveResult {
  let currentVersion: DocumentVersion | null = null;
  try {
    currentVersion = readDocumentVersion(filePath);
  } catch {
    return { ok: false, reason: 'not-found' };
  }

  if (expectedVersion && !documentVersionsMatch(currentVersion, expectedVersion)) {
    return {
      ok: false,
      reason: 'conflict',
      currentContent: fs.readFileSync(filePath, 'utf-8'),
      currentVersion,
    };
  }

  try {
    writeTextFileAtomically(filePath, content);
    return { ok: true, version: readDocumentVersion(filePath) };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export function documentSaveResultForUpdatedFile(filePath: string): DocumentSaveResult {
  try {
    return { ok: true, version: readDocumentVersion(filePath) };
  } catch {
    return { ok: false, reason: 'not-found' };
  }
}

export function documentSaveConflictIfVersionChanged(
  filePath: string,
  expectedVersion?: DocumentVersion | null,
): DocumentSaveResult | null {
  if (!expectedVersion) return null;
  try {
    const currentVersion = readDocumentVersion(filePath);
    if (documentVersionsMatch(currentVersion, expectedVersion)) return null;
    return {
      ok: false,
      reason: 'conflict',
      currentContent: fs.readFileSync(filePath, 'utf-8'),
      currentVersion,
    };
  } catch {
    return { ok: false, reason: 'not-found' };
  }
}

export function documentSaveResultForSharedConflict(
  currentContent: string,
  cachePath?: string,
): DocumentSaveResult {
  if (!cachePath) return { ok: false, reason: 'conflict', currentContent };
  try {
    return {
      ok: false,
      reason: 'conflict',
      currentContent,
      currentVersion: readDocumentVersion(cachePath),
    };
  } catch {
    return { ok: false, reason: 'conflict', currentContent };
  }
}
