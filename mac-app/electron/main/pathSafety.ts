import fs from 'fs';
import path from 'path';

export function isPathInside(parentPath: string, childPath: string): boolean {
  const relPath = path.relative(parentPath, childPath);
  return relPath === ''
    || (!!relPath && relPath !== '..' && !relPath.startsWith(`..${path.sep}`) && !path.isAbsolute(relPath));
}

export function realpathIfExists(filePath: string): string | null {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

export function existingPathInsideRoots(filePath: string, rootPaths: string[]): string | null {
  const realFilePath = realpathIfExists(filePath);
  if (!realFilePath) return null;

  for (const rootPath of rootPaths) {
    const realRootPath = realpathIfExists(rootPath);
    if (realRootPath && isPathInside(realRootPath, realFilePath)) {
      return realFilePath;
    }
  }

  return null;
}
