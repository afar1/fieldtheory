import crypto from 'crypto';
import fs from 'fs';

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
    fs.writeFileSync(filePath, content, 'utf-8');
    return { ok: true, version: readDocumentVersion(filePath) };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
