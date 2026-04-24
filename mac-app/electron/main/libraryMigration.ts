import fs from 'fs';
import path from 'path';
import { canonicalLibraryDir, legacyLibraryDir } from './fieldTheoryPaths';

export type MigrationPathState =
  | 'missing'
  | 'directory'
  | 'file'
  | 'symlink-to-target'
  | 'symlink-other'
  | 'other';

export interface LibraryMigrationFile {
  relPath: string;
  sourcePath: string;
  targetPath: string;
}

export interface LibraryMigrationConflict extends LibraryMigrationFile {
  conflictCopyPath: string;
}

export interface LibraryMigrationSymlink {
  linkPath: string;
  targetPath: string;
}

export interface LibraryMigrationPlan {
  sourceDir: string;
  targetDir: string;
  backupDir: string;
  timestamp: string;
  sourceState: MigrationPathState;
  targetState: MigrationPathState;
  filesToCopy: LibraryMigrationFile[];
  identicalFiles: LibraryMigrationFile[];
  conflicts: LibraryMigrationConflict[];
  targetOnlyFiles: string[];
  missingFolders: string[];
  symlinksToCreate: LibraryMigrationSymlink[];
  blockingIssues: string[];
  canExecute: boolean;
}

export interface LibraryMigrationExecutionResult {
  success: boolean;
  copiedFiles: string[];
  skippedIdenticalFiles: string[];
  conflictCopies: Array<{ relPath: string; copiedTo: string }>;
  backupDir: string | null;
  symlinkCreated: boolean;
  errors: string[];
}

export interface LibraryMigrationPlanOptions {
  sourceDir?: string;
  targetDir?: string;
  timestamp?: string;
}

function migrationTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function toPortableRelPath(relPath: string): string {
  return relPath.split(path.sep).join('/');
}

function fromPortableRelPath(relPath: string): string[] {
  return relPath.split('/').filter(Boolean);
}

function realPathsMatch(left: string, right: string): boolean {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return false;
  }
}

function pathState(filePath: string, targetPath?: string): MigrationPathState {
  try {
    const stats = fs.lstatSync(filePath);
    if (stats.isSymbolicLink()) {
      return targetPath && realPathsMatch(filePath, targetPath) ? 'symlink-to-target' : 'symlink-other';
    }
    if (stats.isDirectory()) return 'directory';
    if (stats.isFile()) return 'file';
    return 'other';
  } catch {
    return 'missing';
  }
}

function uniquePath(basePath: string): string {
  if (!fs.existsSync(basePath)) return basePath;
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${basePath}-${index}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  return `${basePath}-${Date.now()}`;
}

function conflictCopyPath(targetPath: string, timestamp: string): string {
  const parsed = path.parse(targetPath);
  return uniquePath(path.join(parsed.dir, `${parsed.name}.conflict-${timestamp}${parsed.ext}`));
}

function filesEqual(left: string, right: string): boolean {
  try {
    return fs.readFileSync(left).equals(fs.readFileSync(right));
  } catch {
    return false;
  }
}

function walkFiles(rootDir: string): { files: string[]; folders: string[] } {
  const files: string[] = [];
  const folders: string[] = [];

  function walk(currentDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      const relPath = toPortableRelPath(path.relative(rootDir, absPath));
      if (entry.isDirectory()) {
        folders.push(relPath);
        walk(absPath);
      } else if (entry.isFile()) {
        files.push(relPath);
      }
    }
  }

  walk(rootDir);
  return { files: files.sort(), folders: folders.sort() };
}

function targetPathFor(targetDir: string, relPath: string): string {
  return path.join(targetDir, ...fromPortableRelPath(relPath));
}

export function buildLibraryMigrationPlan(options: LibraryMigrationPlanOptions = {}): LibraryMigrationPlan {
  const sourceDir = options.sourceDir ?? legacyLibraryDir();
  const targetDir = options.targetDir ?? canonicalLibraryDir();
  const timestamp = options.timestamp ?? migrationTimestamp();
  const backupDir = uniquePath(path.join(path.dirname(sourceDir), `${path.basename(sourceDir)}.backup-${timestamp}`));
  const sourceState = pathState(sourceDir, targetDir);
  const targetState = pathState(targetDir);
  const blockingIssues: string[] = [];
  const missingFolders: string[] = [];
  const filesToCopy: LibraryMigrationFile[] = [];
  const identicalFiles: LibraryMigrationFile[] = [];
  const conflicts: LibraryMigrationConflict[] = [];
  const targetOnlyFiles: string[] = [];
  const symlinksToCreate: LibraryMigrationSymlink[] = [];

  if (sourceState === 'symlink-to-target') {
    return {
      sourceDir,
      targetDir,
      backupDir,
      timestamp,
      sourceState,
      targetState,
      filesToCopy,
      identicalFiles,
      conflicts,
      targetOnlyFiles,
      missingFolders,
      symlinksToCreate,
      blockingIssues,
      canExecute: true,
    };
  }

  if (sourceState === 'file' || sourceState === 'other' || sourceState === 'symlink-other') {
    blockingIssues.push(`Legacy library path is not a normal directory: ${sourceDir}`);
  }

  if (targetState === 'file' || targetState === 'other' || targetState === 'symlink-other') {
    blockingIssues.push(`Canonical library path is not a normal directory: ${targetDir}`);
  }

  if (sourceState === 'missing') {
    missingFolders.push(sourceDir);
  }

  if (targetState === 'missing') {
    missingFolders.push(targetDir);
  }

  if (sourceState === 'missing' && targetState === 'missing') {
    blockingIssues.push('No legacy library or canonical library exists yet.');
  }

  const sourceTree = sourceState === 'directory' ? walkFiles(sourceDir) : { files: [], folders: [] };
  const targetTree = targetState === 'directory' ? walkFiles(targetDir) : { files: [], folders: [] };
  const targetFiles = new Set(targetTree.files);
  const sourceFiles = new Set(sourceTree.files);

  for (const folder of sourceTree.folders) {
    const targetFolder = targetPathFor(targetDir, folder);
    if (!fs.existsSync(targetFolder)) missingFolders.push(targetFolder);
  }

  for (const relPath of sourceTree.files) {
    const sourcePath = targetPathFor(sourceDir, relPath);
    const targetPath = targetPathFor(targetDir, relPath);
    const entry = { relPath, sourcePath, targetPath };
    if (!targetFiles.has(relPath)) {
      filesToCopy.push(entry);
    } else if (filesEqual(sourcePath, targetPath)) {
      identicalFiles.push(entry);
    } else {
      conflicts.push({ ...entry, conflictCopyPath: conflictCopyPath(targetPath, timestamp) });
    }
  }

  for (const relPath of targetTree.files) {
    if (!sourceFiles.has(relPath)) targetOnlyFiles.push(relPath);
  }

  if (sourceState === 'directory' || (sourceState === 'missing' && targetState === 'directory')) {
    symlinksToCreate.push({ linkPath: sourceDir, targetPath: targetDir });
  }

  return {
    sourceDir,
    targetDir,
    backupDir,
    timestamp,
    sourceState,
    targetState,
    filesToCopy,
    identicalFiles,
    conflicts,
    targetOnlyFiles,
    missingFolders: [...new Set(missingFolders)],
    symlinksToCreate,
    blockingIssues,
    canExecute: blockingIssues.length === 0,
  };
}

export function executeLibraryMigration(plan: LibraryMigrationPlan): LibraryMigrationExecutionResult {
  const result: LibraryMigrationExecutionResult = {
    success: false,
    copiedFiles: [],
    skippedIdenticalFiles: [],
    conflictCopies: [],
    backupDir: null,
    symlinkCreated: false,
    errors: [],
  };

  if (!plan.canExecute) {
    result.errors.push(...plan.blockingIssues);
    return result;
  }

  if (plan.sourceState === 'symlink-to-target') {
    result.success = true;
    return result;
  }

  try {
    fs.mkdirSync(plan.targetDir, { recursive: true });

    for (const file of plan.filesToCopy) {
      if (fs.existsSync(file.targetPath)) {
        if (filesEqual(file.sourcePath, file.targetPath)) {
          result.skippedIdenticalFiles.push(file.relPath);
          continue;
        }
        throw new Error(`Refusing to overwrite changed file: ${file.targetPath}`);
      }
      fs.mkdirSync(path.dirname(file.targetPath), { recursive: true });
      fs.copyFileSync(file.sourcePath, file.targetPath);
      result.copiedFiles.push(file.relPath);
    }

    for (const conflict of plan.conflicts) {
      if (filesEqual(conflict.sourcePath, conflict.targetPath)) {
        result.skippedIdenticalFiles.push(conflict.relPath);
        continue;
      }
      if (fs.existsSync(conflict.conflictCopyPath)) {
        throw new Error(`Refusing to overwrite conflict copy: ${conflict.conflictCopyPath}`);
      }
      fs.mkdirSync(path.dirname(conflict.conflictCopyPath), { recursive: true });
      fs.copyFileSync(conflict.sourcePath, conflict.conflictCopyPath);
      result.conflictCopies.push({ relPath: conflict.relPath, copiedTo: conflict.conflictCopyPath });
    }

    for (const symlink of plan.symlinksToCreate) {
      if (fs.existsSync(symlink.linkPath)) {
        const state = pathState(symlink.linkPath, symlink.targetPath);
        if (state === 'symlink-to-target') continue;
        if (state !== 'directory') {
          throw new Error(`Refusing to replace non-directory legacy path: ${symlink.linkPath}`);
        }
        if (fs.existsSync(plan.backupDir)) {
          throw new Error(`Backup path already exists: ${plan.backupDir}`);
        }
        fs.renameSync(symlink.linkPath, plan.backupDir);
        result.backupDir = plan.backupDir;
      }

      try {
        fs.mkdirSync(path.dirname(symlink.linkPath), { recursive: true });
        fs.symlinkSync(symlink.targetPath, symlink.linkPath, 'dir');
        result.symlinkCreated = true;
      } catch (error) {
        if (result.backupDir && fs.existsSync(result.backupDir) && !fs.existsSync(symlink.linkPath)) {
          fs.renameSync(result.backupDir, symlink.linkPath);
          result.backupDir = null;
        }
        throw error;
      }
    }

    result.success = true;
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}
