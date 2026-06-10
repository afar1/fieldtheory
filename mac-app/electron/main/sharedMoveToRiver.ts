import path from 'path';
import { SHARED_FILES_UI_LABEL } from './sharedFiles';
import type { SharedSyncService } from './sharedSyncService';

type MovableWikiPage = {
  absPath: string;
  title: string;
  content: string;
};

export type RiverMoveLibrarian = {
  getWikiPage(relPath: string): MovableWikiPage | null;
  deleteWikiPage(relPath: string): Promise<boolean>;
  emit(eventName: 'library:changed'): void;
};

export function isMoveIntoRiver(kind: 'file' | 'dir', sourceRelPath: string, targetDirRelPath: string): boolean {
  const targetDirParts = targetDirRelPath.split(/[\\/]/).filter(Boolean);
  return kind === 'file'
    && targetDirParts[targetDirParts.length - 1] === SHARED_FILES_UI_LABEL
    && !sourceRelPath.split(/[\\/]/).includes(SHARED_FILES_UI_LABEL);
}

export async function moveLibraryFileIntoRiver(input: {
  librarianManager: RiverMoveLibrarian;
  sharedSyncService: Pick<SharedSyncService, 'shareFile' | 'emit'>;
  rootPath: string;
  sourceRelPath: string;
  targetRootPath?: string;
}): Promise<string | null> {
  const page = input.librarianManager.getWikiPage(input.sourceRelPath);
  if (!page) return null;

  const result = await input.sharedSyncService.shareFile({
    filePath: page.absPath,
    title: page.title,
    content: page.content,
  });
  if (!result.shared || !result.cachePath) return null;

  const deletedSource = await input.librarianManager.deleteWikiPage(input.sourceRelPath);
  if (!deletedSource) return null;

  input.librarianManager.emit('library:changed');
  input.sharedSyncService.emit('pinsChanged');
  return path.relative(input.targetRootPath || input.rootPath, result.cachePath).replace(/\\/g, '/').replace(/\.(md|markdown)$/i, '');
}
