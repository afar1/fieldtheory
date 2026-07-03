import path from 'path';
import { existingPathInsideRoots, isPathInside } from './pathSafety';

export type ActiveLibraryFileContextPolicyInput = {
  filePath?: string | null;
  rootPath?: string | null;
  type?: 'wiki' | 'external' | string | null;
};

export function isActiveLibraryFileContextAllowed(input: {
  context: ActiveLibraryFileContextPolicyInput;
  libraryRootPaths: string[];
  watchedDirPaths: string[];
}): boolean {
  const filePath = typeof input.context.filePath === 'string' ? input.context.filePath : '';
  if (!filePath) return false;

  const allowedRoots = uniqueResolvedPaths([
    ...input.libraryRootPaths,
    ...input.watchedDirPaths,
  ]);
  if (allowedRoots.length === 0) return false;
  if (!existingPathInsideRoots(filePath, allowedRoots)) return false;

  const rootPath = typeof input.context.rootPath === 'string' ? input.context.rootPath.trim() : '';
  if (!rootPath) return true;
  const resolvedRootPath = path.resolve(rootPath);
  return allowedRoots.some((allowedRoot) => (
    isPathInside(allowedRoot, resolvedRootPath) || isPathInside(resolvedRootPath, allowedRoot)
  ));
}

function uniqueResolvedPaths(paths: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const input of paths) {
    if (typeof input !== 'string' || !input.trim()) continue;
    const resolved = path.resolve(input);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    output.push(resolved);
  }
  return output;
}
