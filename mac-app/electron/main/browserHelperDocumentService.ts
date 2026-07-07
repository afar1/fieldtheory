import fs from 'fs';
import path from 'path';
import { type DocumentSaveResult, type DocumentVersion, readDocumentVersion, writeTextFileWithConflictGuard } from './documentSaveGuard';
import {
  getLibraryTextDocumentKind,
  isPathInside,
  libraryTextDocumentFileNameFromUserInput,
  markdownFileNameFromUserInput,
  normalizeUserDocumentNameInput,
  normalizeUserDocumentRelPathInput,
  stripMarkdownFileExtension,
  type LibraryTextDocumentKind,
} from './pathSafety';
import { isHiddenWikiFileName, isHiddenWikiFolderName } from './librarianManager';

export type BrowserHelperTreeNode = {
  kind: 'file' | 'dir';
  name: string;
  relPath: string;
  documentKind?: LibraryTextDocumentKind;
  children?: BrowserHelperTreeNode[];
};

export type BrowserHelperRoot = {
  id: string;
  name: string;
  path: string;
  tree: BrowserHelperTreeNode[];
};

export type BrowserHelperWikiNode = {
  kind: 'file' | 'dir';
  name: string;
  relPath: string;
  absPath?: string;
  title?: string;
  lastUpdated?: number;
  documentKind?: LibraryTextDocumentKind;
  children?: BrowserHelperWikiNode[];
};

export type BrowserHelperLibraryRoot = {
  path: string;
  label: string;
  builtin: boolean;
  writable: boolean;
  tree: BrowserHelperWikiNode[];
};

export type BrowserHelperWikiPage = {
  rootPath: string;
  relPath: string;
  absPath: string;
  name: string;
  title: string;
  lastUpdated: number;
  documentKind: LibraryTextDocumentKind;
  content: string;
  documentVersion: DocumentVersion;
};

export type BrowserHelperWikiFolder = {
  name: string;
  files: BrowserHelperWikiPageMeta[];
};

export type BrowserHelperWikiPageMeta = Omit<BrowserHelperWikiPage, 'rootPath' | 'content' | 'documentVersion'>;

export type BrowserHelperExternalFile = {
  path: string;
  name: string;
  title: string;
  content: string;
  documentVersion: DocumentVersion;
  documentKind: LibraryTextDocumentKind;
};

export type BrowserHelperDocument = {
  rootId: string;
  relPath: string;
  rootPath: string;
  path: string;
  title: string;
  kind: LibraryTextDocumentKind;
  content: string;
  version: DocumentVersion;
};

export type BrowserHelperDocumentRef = {
  rootId: string;
  relPath: string;
};

type ResolvedDocument = BrowserHelperDocumentRef & {
  rootPath: string;
  filePath: string;
  kind: LibraryTextDocumentKind;
};

export class BrowserHelperDocumentService {
  private readonly roots: BrowserHelperRootConfig[];

  constructor(rootPaths: string[]) {
    this.roots = rootPaths.map((rootPath, index) => ({
      id: `root-${index + 1}`,
      path: path.resolve(rootPath),
    }));
  }

  getRoots(): BrowserHelperRoot[] {
    return this.roots
      .filter((root) => fs.existsSync(root.path))
      .map((root) => ({
        id: root.id,
        name: path.basename(root.path) || root.path,
        path: root.path,
        tree: this.readTree(root.path, root.path),
      }));
  }

  getLibraryRoots(): BrowserHelperLibraryRoot[] {
    return this.roots
      .filter((root) => fs.existsSync(root.path))
      .map((root, index) => ({
        path: root.path,
        label: path.basename(root.path) || root.path,
        builtin: index === 0,
        writable: true,
        tree: this.readNativeTree(root.path, root.path),
      }));
  }

  addLibraryRoot(dirPath: string): BrowserHelperLibraryRoot | null {
    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return null;
    const existing = this.resolveRootByPath(resolved);
    if (!existing) {
      this.roots.push({ id: `root-${this.roots.length + 1}`, path: resolved });
    }
    return this.getLibraryRoots().find((root) => root.path === resolved) ?? null;
  }

  removeLibraryRoot(dirPath: string): boolean {
    const resolved = path.resolve(dirPath);
    const index = this.roots.findIndex((root, rootIndex) => rootIndex > 0 && root.path === resolved);
    if (index === -1) return false;
    this.roots.splice(index, 1);
    return true;
  }

  getWikiTree(): BrowserHelperWikiFolder[] {
    const builtinRoot = this.roots[0];
    if (!builtinRoot || !fs.existsSync(builtinRoot.path)) return [];
    const tree = this.readNativeTree(builtinRoot.path, builtinRoot.path);
    const folders: BrowserHelperWikiFolder[] = [];
    for (const node of tree) {
      if (node.kind !== 'dir') continue;
      const files = this.flattenWikiFiles(node.children ?? []);
      if (files.length > 0) folders.push({ name: node.name, files });
    }
    return folders;
  }

  getWikiPage(relPath: string): BrowserHelperWikiPage | null {
    const builtinRoot = this.roots[0];
    if (!builtinRoot) return null;
    return this.getWikiPageForRoot(builtinRoot, relPath);
  }

  findWikiPageByDocumentVersion(version: DocumentVersion, previousRelPath?: string): BrowserHelperWikiPage | null {
    const builtinRoot = this.roots[0];
    if (!builtinRoot) return null;
    const pages = this.flattenWikiFiles(this.readNativeTree(builtinRoot.path, builtinRoot.path));
    const sortedPages = previousRelPath
      ? pages.sort((left, right) => {
        const previousFolder = path.posix.dirname(previousRelPath);
        const leftSameDir = path.posix.dirname(left.relPath) === previousFolder ? 0 : 1;
        const rightSameDir = path.posix.dirname(right.relPath) === previousFolder ? 0 : 1;
        return leftSameDir - rightSameDir;
      })
      : pages;
    for (const page of sortedPages) {
      if (page.relPath === previousRelPath) continue;
      const fullPage = this.getWikiPageForRoot(builtinRoot, page.relPath);
      if (!fullPage) continue;
      if (versionsMatch(fullPage.documentVersion, version)) return fullPage;
    }
    return null;
  }

  saveWikiPage(relPath: string, content: string, expectedVersion?: DocumentVersion | null): DocumentSaveResult {
    const builtinRoot = this.roots[0];
    if (!builtinRoot) return { ok: false, reason: 'not-found' };
    return this.saveDocument({ rootId: builtinRoot.id, relPath: this.withMarkdownExtension(relPath) }, content, expectedVersion);
  }

  createWikiFile(folderRelPath: string, fileName: string): BrowserHelperWikiPage | null {
    const builtinRoot = this.roots[0];
    if (!builtinRoot) return null;
    return this.createMarkdownFileInRoot(builtinRoot, folderRelPath, fileName);
  }

  createWikiFileWithDefaultTitle(folderRelPath: string, now = new Date()): BrowserHelperWikiPage | null {
    const first = this.createWikiFile(folderRelPath, defaultScratchpadName(now));
    return first ?? this.createWikiFile(folderRelPath, defaultScratchpadNameWithTime(now));
  }

  createWikiDir(dirRelPath: string): boolean {
    const builtinRoot = this.roots[0];
    if (!builtinRoot) return false;
    return this.createDirInRoot(builtinRoot, dirRelPath);
  }

  async deleteWikiPage(relPath: string): Promise<boolean> {
    const builtinRoot = this.roots[0];
    if (!builtinRoot) return false;
    const resolved = this.resolveDocument({ rootId: builtinRoot.id, relPath: this.withMarkdownExtension(relPath) });
    if (!resolved || resolved.kind !== 'markdown') return false;
    try {
      fs.unlinkSync(resolved.filePath);
      return true;
    } catch {
      return false;
    }
  }

  renameWikiPage(relPath: string, newName: string): string | null {
    const builtinRoot = this.roots[0];
    if (!builtinRoot) return null;
    const oldResolved = this.resolveDocument({ rootId: builtinRoot.id, relPath: this.withMarkdownExtension(relPath) });
    if (!oldResolved || oldResolved.kind !== 'markdown') return null;
    const newFileName = markdownFileNameFromTitle(newName, path.extname(oldResolved.filePath));
    if (!newFileName) return null;
    const folder = path.posix.dirname(this.toNativeRelPath(oldResolved.relPath, oldResolved.kind));
    const title = titleFromRelPath(newFileName);
    const newNativeRelPath = folder && folder !== '.' ? `${folder}/${title}` : title;
    const newFilePath = path.resolve(oldResolved.rootPath, `${newNativeRelPath}${path.extname(oldResolved.filePath)}`);
    if (!isPathInside(oldResolved.rootPath, newFilePath)) return null;
    if (newFilePath === oldResolved.filePath) return newNativeRelPath;
    if (fs.existsSync(newFilePath)) return null;
    try {
      fs.renameSync(oldResolved.filePath, newFilePath);
      return newNativeRelPath;
    } catch {
      return null;
    }
  }

  createLibraryFile(rootPath: string, folderRelPath: string, fileName: string): BrowserHelperWikiPage | null {
    const root = this.resolveRootByPath(rootPath);
    if (!root) return null;
    return this.createMarkdownFileInRoot(root, folderRelPath, fileName);
  }

  createLibraryDir(rootPath: string, dirRelPath: string): boolean {
    const root = this.resolveRootByPath(rootPath);
    if (!root) return false;
    return this.createDirInRoot(root, dirRelPath);
  }

  async deleteLibraryDir(rootPath: string, dirRelPath: string): Promise<boolean> {
    const root = this.resolveRootByPath(rootPath);
    if (!root) return false;
    const dirPath = path.resolve(root.path, dirRelPath);
    if (!isPathInside(root.path, dirPath) || !fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return false;
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  moveLibraryItem(rootPath: string, kind: 'file' | 'dir', sourceRelPath: string, targetDirRelPath: string, targetRootPath = rootPath): string | null {
    const sourceRoot = this.resolveRootByPath(rootPath);
    const targetRoot = this.resolveRootByPath(targetRootPath);
    if (!sourceRoot || !targetRoot) return null;
    const sourcePath = path.resolve(sourceRoot.path, kind === 'file' ? this.withMarkdownExtension(sourceRelPath) : sourceRelPath);
    if (!isPathInside(sourceRoot.path, sourcePath) || !fs.existsSync(sourcePath)) return null;
    if (kind === 'file' && !fs.statSync(sourcePath).isFile()) return null;
    if (kind === 'dir' && !fs.statSync(sourcePath).isDirectory()) return null;

    const targetDirPath = path.resolve(targetRoot.path, targetDirRelPath);
    if (!isPathInside(targetRoot.path, targetDirPath)) return null;
    fs.mkdirSync(targetDirPath, { recursive: true });
    const targetPath = path.resolve(targetDirPath, path.basename(sourcePath));
    if (!isPathInside(targetRoot.path, targetPath) || fs.existsSync(targetPath)) return null;

    try {
      fs.renameSync(sourcePath, targetPath);
      const relPath = path.relative(targetRoot.path, targetPath).split(path.sep).join('/');
      return kind === 'file' ? relPath.replace(/\.(md|markdown|mdx)$/i, '') : relPath;
    } catch {
      return null;
    }
  }

  openExternal(filePath: string): BrowserHelperExternalFile | null {
    const resolved = this.resolveExternalFile(filePath);
    if (!resolved) return null;
    return {
      path: resolved.filePath,
      name: path.basename(resolved.filePath),
      title: titleFromRelPath(path.basename(resolved.filePath)),
      content: fs.readFileSync(resolved.filePath, 'utf-8'),
      documentKind: resolved.kind,
      documentVersion: readDocumentVersion(resolved.filePath),
    };
  }

  findLibraryFileByDocumentVersion(version: DocumentVersion, previousAbsPath?: string): BrowserHelperExternalFile | null {
    const candidates: string[] = [];
    for (const root of this.roots.slice(1)) {
      if (!fs.existsSync(root.path)) continue;
      this.collectTextFiles(root.path, root.path, candidates);
    }
    const previousDir = previousAbsPath ? path.dirname(previousAbsPath) : null;
    const sortedCandidates = previousDir
      ? candidates.sort((left, right) => {
        const leftSameDir = path.dirname(left) === previousDir ? 0 : 1;
        const rightSameDir = path.dirname(right) === previousDir ? 0 : 1;
        return leftSameDir - rightSameDir;
      })
      : candidates;
    for (const candidate of sortedCandidates) {
      if (candidate === previousAbsPath) continue;
      try {
        if (versionsMatch(readDocumentVersion(candidate), version)) return this.openExternal(candidate);
      } catch {}
    }
    return null;
  }

  renameExternal(filePath: string, newName: string): BrowserHelperExternalFile | null {
    const resolved = this.resolveExternalFile(filePath);
    if (!resolved) return null;
    const trimmed = newName.trim();
    if (!trimmed) return null;
    const extension = path.extname(resolved.filePath) || '.md';
    const nextFileName = libraryTextFileNameFromTitle(trimmed, extension);
    if (!nextFileName) return null;
    const nextPath = path.resolve(path.dirname(resolved.filePath), nextFileName);
    if (!this.roots.some((root) => isPathInside(root.path, nextPath))) return null;
    if (nextPath !== resolved.filePath && fs.existsSync(nextPath)) return null;
    try {
      if (nextPath !== resolved.filePath) fs.renameSync(resolved.filePath, nextPath);
      return this.openExternal(nextPath);
    } catch {
      return null;
    }
  }

  async deleteExternal(filePath: string): Promise<boolean> {
    const resolved = this.resolveExternalFile(filePath);
    if (!resolved) return false;
    try {
      fs.unlinkSync(resolved.filePath);
      return true;
    } catch {
      return false;
    }
  }

  saveExternal(filePath: string, content: string, expectedVersion?: DocumentVersion | null): DocumentSaveResult {
    const resolved = this.resolveExternalFile(filePath);
    if (!resolved) return { ok: false, reason: 'not-found' };
    if (!expectedVersion) return { ok: false, reason: 'conflict', currentContent: fs.readFileSync(resolved.filePath, 'utf-8'), currentVersion: readDocumentVersion(resolved.filePath) };
    return writeTextFileWithConflictGuard(resolved.filePath, content, expectedVersion);
  }

  getDocument(ref: BrowserHelperDocumentRef): BrowserHelperDocument | null {
    const resolved = this.resolveDocument(ref);
    if (!resolved) return null;

    return {
      rootId: resolved.rootId,
      relPath: resolved.relPath,
      rootPath: resolved.rootPath,
      path: resolved.filePath,
      title: titleFromRelPath(resolved.relPath),
      kind: resolved.kind,
      content: fs.readFileSync(resolved.filePath, 'utf-8'),
      version: readDocumentVersion(resolved.filePath),
    };
  }

  saveDocument(ref: BrowserHelperDocumentRef, content: string, expectedVersion?: DocumentVersion | null): DocumentSaveResult {
    const resolved = this.resolveDocument(ref);
    if (!resolved) return { ok: false, reason: 'not-found' };
    if (!expectedVersion) return { ok: false, reason: 'conflict', currentContent: fs.readFileSync(resolved.filePath, 'utf-8'), currentVersion: readDocumentVersion(resolved.filePath) };
    return writeTextFileWithConflictGuard(resolved.filePath, content, expectedVersion);
  }

  private readTree(rootPath: string, currentPath: string): BrowserHelperTreeNode[] {
    const entries = safeReadDir(currentPath);
    const nodes: BrowserHelperTreeNode[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() ? isHiddenWikiFolderName(entry.name) : isHiddenWikiFileName(entry.name)) continue;
      const absPath = path.join(currentPath, entry.name);
      const relPath = path.relative(rootPath, absPath).split(path.sep).join('/');

      if (entry.isDirectory()) {
        const children = this.readTree(rootPath, absPath);
        nodes.push({ kind: 'dir', name: entry.name, relPath, children });
        continue;
      }

      if (!entry.isFile()) continue;
      const documentKind = getLibraryTextDocumentKind(absPath);
      if (!documentKind) continue;
      if (!this.isExistingPathInsideRoot(rootPath, absPath)) continue;

      nodes.push({ kind: 'file', name: entry.name, relPath, documentKind });
    }

    return nodes.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  }

  private collectTextFiles(rootPath: string, currentPath: string, output: string[]): void {
    for (const entry of safeReadDir(currentPath)) {
      if (entry.isDirectory() ? isHiddenWikiFolderName(entry.name) : isHiddenWikiFileName(entry.name)) continue;
      const absPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        this.collectTextFiles(rootPath, absPath, output);
        continue;
      }
      if (!entry.isFile() || !getLibraryTextDocumentKind(absPath)) continue;
      if (this.isExistingPathInsideRoot(rootPath, absPath)) output.push(absPath);
    }
  }

  private readNativeTree(rootPath: string, currentPath: string): BrowserHelperWikiNode[] {
    const entries = safeReadDir(currentPath);
    const nodes: BrowserHelperWikiNode[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() ? isHiddenWikiFolderName(entry.name) : isHiddenWikiFileName(entry.name)) continue;
      const absPath = path.join(currentPath, entry.name);
      const relPath = path.relative(rootPath, absPath).split(path.sep).join('/');

      if (entry.isDirectory()) {
        const children = this.readNativeTree(rootPath, absPath);
        nodes.push({ kind: 'dir', name: entry.name, relPath, children });
        continue;
      }

      if (!entry.isFile()) continue;
      const documentKind = getLibraryTextDocumentKind(absPath);
      if (!documentKind) continue;
      if (!this.isExistingPathInsideRoot(rootPath, absPath)) continue;

      const stat = fs.statSync(absPath);
      nodes.push({
        kind: 'file',
        name: entry.name,
        relPath: this.toNativeRelPath(relPath, documentKind),
        absPath,
        title: titleFromRelPath(relPath),
        lastUpdated: stat.mtimeMs,
        documentKind,
      });
    }

    return nodes.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  }

  private flattenWikiFiles(nodes: BrowserHelperWikiNode[]): BrowserHelperWikiPageMeta[] {
    const files: BrowserHelperWikiPageMeta[] = [];
    for (const node of nodes) {
      if (node.kind === 'dir') {
        files.push(...this.flattenWikiFiles(node.children ?? []));
        continue;
      }
      if (!node.absPath || !node.title || !node.lastUpdated || !node.documentKind) continue;
      files.push({
        relPath: node.relPath,
        absPath: node.absPath,
        name: node.name,
        title: node.title,
        lastUpdated: node.lastUpdated,
        documentKind: node.documentKind,
      });
    }
    return files;
  }

  private resolveDocument(ref: BrowserHelperDocumentRef): ResolvedDocument | null {
    const root = this.roots.find((candidate) => candidate.id === ref.rootId);
    if (!root) return null;

    const normalizedRelPath = normalizeBrowserHelperRelPath(ref.relPath);
    if (!normalizedRelPath) return null;

    const filePath = path.resolve(root.path, normalizedRelPath);
    if (!isPathInside(root.path, filePath)) return null;
    const kind = getLibraryTextDocumentKind(filePath);
    if (!kind) return null;
    if (!this.isExistingPathInsideRoot(root.path, filePath)) return null;

    return {
      rootId: root.id,
      relPath: normalizedRelPath,
      rootPath: root.path,
      filePath,
      kind,
    };
  }

  private resolveExternalFile(filePath: string): ResolvedDocument | null {
    if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) return null;
    const normalizedPath = path.resolve(filePath);
    const root = this.roots.find((candidate) => isPathInside(candidate.path, normalizedPath));
    if (!root) return null;
    const relPath = path.relative(root.path, normalizedPath).split(path.sep).join('/');
    return this.resolveDocument({ rootId: root.id, relPath });
  }

  private resolveRootByPath(rootPath: string): BrowserHelperRootConfig | null {
    if (typeof rootPath !== 'string' || !rootPath || rootPath.includes('\0')) return null;
    const normalizedPath = path.resolve(rootPath);
    return this.roots.find((candidate) => candidate.path === normalizedPath) ?? null;
  }

  private createMarkdownFileInRoot(root: BrowserHelperRootConfig, folderRelPath: string, fileName: string): BrowserHelperWikiPage | null {
    const normalizedFolder = normalizeLibraryRelPath(folderRelPath);
    if (normalizedFolder === null || isArtifactsRelPath(normalizedFolder)) return null;
    const markdownFileName = markdownFileNameFromTitle(fileName);
    if (!markdownFileName) return null;
    const title = titleFromRelPath(markdownFileName);
    const nativeRelPath = normalizedFolder ? `${normalizedFolder}/${title}` : title;
    const filePath = path.resolve(root.path, normalizedFolder, markdownFileName);
    if (!isPathInside(root.path, filePath)) return null;
    if (fs.existsSync(filePath)) return null;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '', 'utf-8');
      return this.getWikiPageForRoot(root, nativeRelPath);
    } catch {
      return null;
    }
  }

  private createDirInRoot(root: BrowserHelperRootConfig, dirRelPath: string): boolean {
    const normalizedDir = normalizeLibraryRelPath(dirRelPath);
    if (!normalizedDir || isArtifactsRelPath(normalizedDir)) return false;
    const dirPath = path.resolve(root.path, normalizedDir);
    if (!isPathInside(root.path, dirPath)) return false;
    if (fs.existsSync(dirPath)) return false;
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  private getWikiPageForRoot(root: BrowserHelperRootConfig, nativeRelPath: string): BrowserHelperWikiPage | null {
    const resolved = this.resolveDocument({ rootId: root.id, relPath: this.withMarkdownExtension(nativeRelPath) });
    if (!resolved || resolved.kind !== 'markdown') return null;
    const stat = fs.statSync(resolved.filePath);
    return {
      rootPath: resolved.rootPath,
      relPath: this.toNativeRelPath(resolved.relPath, resolved.kind),
      absPath: resolved.filePath,
      name: titleFromRelPath(resolved.relPath),
      title: titleFromRelPath(resolved.relPath),
      lastUpdated: stat.mtimeMs,
      documentKind: resolved.kind,
      content: fs.readFileSync(resolved.filePath, 'utf-8'),
      documentVersion: readDocumentVersion(resolved.filePath),
    };
  }

  private isExistingPathInsideRoot(rootPath: string, filePath: string): boolean {
    let realRoot: string;
    let realFile: string;
    try {
      realRoot = fs.realpathSync(rootPath);
      realFile = fs.realpathSync(filePath);
    } catch {
      return false;
    }
    return isPathInside(realRoot, realFile);
  }

  private withMarkdownExtension(relPath: string): string {
    if (/\.(md|markdown|mdx)$/i.test(relPath)) return relPath;
    return `${relPath}.md`;
  }

  private toNativeRelPath(relPath: string, kind: LibraryTextDocumentKind): string {
    return kind === 'markdown'
      ? relPath.replace(/\.(md|markdown|mdx)$/i, '')
      : relPath;
  }
}

type BrowserHelperRootConfig = {
  id: string;
  path: string;
};

function normalizeBrowserHelperRelPath(relPath: string): string | null {
  if (typeof relPath !== 'string') return null;
  const trimmed = relPath.trim();
  if (!trimmed || trimmed.includes('\0') || path.isAbsolute(trimmed)) return null;

  const parts = trimmed.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.some((part) => part === '.' || part === '..' || part.startsWith('.'))) return null;
  return parts.join('/');
}

function safeReadDir(dirPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function titleFromRelPath(relPath: string): string {
  const basename = path.basename(relPath);
  return basename.replace(/\.(md|markdown|mdx|html?|css)$/i, '') || basename;
}

function normalizeLibraryRelPath(relPath: string): string | null {
  if (typeof relPath !== 'string' || path.isAbsolute(relPath.trim())) return null;
  return normalizeUserDocumentRelPathInput(relPath, { rejectHiddenSegments: true });
}

function isArtifactsRelPath(relPath: string): boolean {
  return relPath === 'artifacts' || relPath.startsWith('artifacts/');
}

function markdownFileNameFromTitle(title: string, extension = '.md'): string | null {
  const normalized = normalizeUserDocumentNameInput(title, { rejectLeadingUnderscore: true });
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return markdownFileNameFromUserInput(normalized, { rejectLeadingUnderscore: true });
  }
  return markdownFileNameFromUserInput(`${normalized}${extension || '.md'}`, { rejectLeadingUnderscore: true });
}

function libraryTextFileNameFromTitle(title: string, extension = '.md'): string | null {
  return libraryTextDocumentFileNameFromUserInput(title, extension || '.md', { rejectLeadingUnderscore: true });
}

function versionsMatch(left: DocumentVersion, right: DocumentVersion): boolean {
  return left.mtimeMs === right.mtimeMs
    && left.size === right.size
    && left.sha256 === right.sha256;
}

function defaultScratchpadName(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function defaultScratchpadNameWithTime(now: Date): string {
  const date = now.toISOString().slice(0, 10);
  const time = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('-');
  return `${date}-${time}`;
}
