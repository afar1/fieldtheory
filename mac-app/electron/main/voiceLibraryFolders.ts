import { constants, promises as fs } from 'node:fs';
import path from 'node:path';

const MAX_FOLDERS = 1_000;
const MAX_SCANNED_ENTRIES = 10_000;
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

/** Lists writable destinations inside registered Library roots without building document trees. */
export async function listVoiceLibraryFolders(
  roots: Array<{ path: string; label: string; writable?: boolean }>,
  signal?: AbortSignal,
): Promise<Array<{ path: string; label: string }>> {
  const folders: Array<{ path: string; label: string }> = [];
  const seen = new Set<string>();
  let scannedEntries = 0;
  const checkCanceled = () => {
    if (signal?.aborted) throw new DOMException('Folder listing was canceled.', 'AbortError');
  };

  const childrenOf = async (directory: string): Promise<string[]> => {
    const children: string[] = [];
    if (scannedEntries >= MAX_SCANNED_ENTRIES) return children;
    let handle: Awaited<ReturnType<typeof fs.opendir>> | undefined;
    try {
      handle = await fs.opendir(directory);
      checkCanceled();
      for await (const entry of handle) {
        checkCanceled();
        scannedEntries++;
        if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.')) children.push(entry.name);
        if (scannedEntries >= MAX_SCANNED_ENTRIES) break;
      }
    } catch { checkCanceled(); }
    finally {
      // The async iterator also closes its handle on completion or early exit.
      await handle?.close().catch(() => {});
    }
    checkCanceled();
    return children.sort(compare);
  };

  const visit = async (directory: string, rootLabel: string, rootPath?: string): Promise<void> => {
    checkCanceled();
    if (folders.length >= MAX_FOLDERS || path.basename(directory).startsWith('.')) return;
    let canonical: string;
    try {
      const stats = await fs.lstat(directory);
      checkCanceled();
      if (!stats.isDirectory() || stats.isSymbolicLink()) return;
      canonical = await fs.realpath(directory);
      checkCanceled();
      if (rootPath) {
        const relative = path.relative(rootPath, canonical);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return;
      }
      if (seen.has(canonical)) return;
      await fs.access(canonical, constants.W_OK);
      checkCanceled();
    } catch { checkCanceled(); return; }
    seen.add(canonical);
    const root = rootPath ?? canonical;
    folders.push({ path: canonical, label: path.relative(root, canonical) || rootLabel || path.basename(canonical) });
    if (folders.length >= MAX_FOLDERS) return;
    const children = await childrenOf(canonical);
    for (const child of children) {
      await visit(path.join(canonical, child), rootLabel, root);
      if (folders.length >= MAX_FOLDERS) break;
    }
  };

  checkCanceled();
  const registered = roots.filter(root => root.writable !== false && path.isAbsolute(root.path))
    .sort((left, right) => compare(left.label, right.label) || compare(left.path, right.path));
  for (const root of registered) {
    await visit(root.path, root.label);
    if (folders.length >= MAX_FOLDERS) break;
  }
  checkCanceled();
  return folders;
}
