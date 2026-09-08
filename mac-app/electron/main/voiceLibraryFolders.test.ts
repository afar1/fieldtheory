// @vitest-environment node
import { constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listVoiceLibraryFolders } from './voiceLibraryFolders';

const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-library-folders-'));
  temporary.push(directory);
  return fs.realpath(directory);
}

describe('Voice Library folders', () => {
  it('stays within registered writable roots and returns only directories', async () => {
    const base = await workspace();
    const registered = path.join(base, 'Library');
    await fs.mkdir(path.join(registered, 'Notes'), { recursive: true });
    await fs.mkdir(path.join(base, 'Outside'));
    await fs.mkdir(path.join(base, 'Read-only'));
    await fs.writeFile(path.join(registered, 'note.md'), '# A note');
    const result = await listVoiceLibraryFolders([
      { path: registered, label: 'Library' },
      { path: path.join(base, 'Read-only'), label: 'Read-only', writable: false },
      { path: path.join(registered, 'note.md'), label: 'A file' },
      { path: 'relative-directory', label: 'Relative' },
    ]);
    expect(result).toEqual([
      { path: registered, label: 'Library' },
      { path: path.join(registered, 'Notes'), label: 'Notes' },
    ]);
  });

  it('skips hidden directories and symbolic links, including linked roots', async () => {
    const base = await workspace();
    const root = path.join(base, 'Library');
    await fs.mkdir(path.join(root, '.hidden', 'Nested'), { recursive: true });
    await fs.mkdir(path.join(root, 'Visible'), { recursive: true });
    await fs.mkdir(path.join(base, 'Outside'));
    await fs.symlink(path.join(base, 'Outside'), path.join(root, 'Escape'));
    await fs.symlink(path.join(root, 'Visible'), path.join(root, 'Alias'));
    await fs.symlink(root, path.join(base, 'Linked-root'));
    const result = await listVoiceLibraryFolders([
      { path: root, label: 'Library' },
      { path: path.join(base, 'Linked-root'), label: 'Link' },
      { path: path.join(root, '.hidden'), label: 'Hidden' },
    ]);
    expect(result.map(folder => folder.label)).toEqual(['Library', 'Visible']);
  });

  it('deduplicates canonical paths across duplicate and overlapping registrations', async () => {
    const base = await workspace();
    await fs.mkdir(path.join(base, 'Child'));
    const result = await listVoiceLibraryFolders([
      { path: `${base}/`, label: 'A Library' },
      { path: base, label: 'Duplicate' },
      { path: path.join(base, 'Child'), label: 'Nested root' },
    ]);
    expect(result).toEqual([{ path: base, label: 'A Library' }, { path: path.join(base, 'Child'), label: 'Child' }]);
  });

  it('has stable root and child ordering independent of registration and creation order', async () => {
    const base = await workspace();
    const alpha = path.join(base, 'Alpha');
    const zulu = path.join(base, 'Zulu');
    await fs.mkdir(zulu);
    await fs.mkdir(path.join(alpha, 'Z-last'), { recursive: true });
    await fs.mkdir(path.join(alpha, 'A-first', 'Nested'), { recursive: true });
    const roots = [{ path: zulu, label: 'Zulu' }, { path: alpha, label: 'Alpha' }];
    const result = await listVoiceLibraryFolders(roots);
    expect(result.map(folder => folder.label)).toEqual(['Alpha', 'A-first', 'A-first/Nested', 'Z-last', 'Zulu']);
    expect(await listVoiceLibraryFolders([...roots].reverse())).toEqual(result);
  });

  it('tolerates missing roots and unreadable directory listings', async () => {
    const base = await workspace();
    const unreadable = path.join(base, 'Unreadable');
    await fs.mkdir(path.join(unreadable, 'Hidden-by-permissions'), { recursive: true });
    await fs.mkdir(path.join(base, 'Visible'));
    const original = fs.opendir.bind(fs);
    vi.spyOn(fs, 'opendir').mockImplementation(async (...args) => {
      if (String(args[0]) === unreadable) throw Object.assign(new Error('Denied'), { code: 'EACCES' });
      return original(...args);
    });
    const result = await listVoiceLibraryFolders([{ path: path.join(base, 'Missing'), label: 'Missing' }, { path: base, label: 'Library' }]);
    expect(result.map(folder => folder.label)).toEqual(['Library', 'Unreadable', 'Visible']);
  });

  it('checks actual write access for roots and descendants even without writable metadata', async () => {
    const base = await workspace();
    const deniedRoot = path.join(base, 'Denied-root');
    const grantedRoot = path.join(base, 'Granted-root');
    const deniedChild = path.join(grantedRoot, 'Denied-child');
    await fs.mkdir(deniedRoot);
    await fs.mkdir(deniedChild, { recursive: true });
    await fs.mkdir(path.join(grantedRoot, 'Writable'));
    const original = fs.access.bind(fs);
    const access = vi.spyOn(fs, 'access').mockImplementation(async (target, mode) => {
      if (target === deniedRoot || target === deniedChild) throw Object.assign(new Error('Denied'), { code: 'EACCES' });
      return original(target, mode);
    });
    const result = await listVoiceLibraryFolders([{ path: deniedRoot, label: 'Denied' }, { path: grantedRoot, label: 'Granted' }]);
    expect(result.map(folder => folder.label)).toEqual(['Granted', 'Writable']);
    expect(access).toHaveBeenCalledWith(deniedRoot, constants.W_OK);
    expect(access).toHaveBeenCalledWith(deniedChild, constants.W_OK);
  });

  it('caps returned folders at 1000', async () => {
    const base = await workspace();
    await Promise.all(Array.from({ length: 1_005 }, (_, index) => fs.mkdir(path.join(base, String(index).padStart(4, '0')))));
    const result = await listVoiceLibraryFolders([{ path: base, label: 'Library' }]);
    expect(result).toHaveLength(1_000);
    expect(result.at(-1)?.label).toBe('0998');
  });

  it('bounds file-heavy directory enumeration and closes the iterator on early exit', async () => {
    const base = await workspace();
    let yielded = 0;
    let exited = false;
    const handle = {
      close: vi.fn(async () => {}),
      async *[Symbol.asyncIterator]() {
        try {
          for (let index = 0; index < 20_000; index++) {
            yielded++;
            yield { name: `file-${index}`, isDirectory: () => false, isSymbolicLink: () => false };
          }
        } finally { exited = true; }
      },
    };
    vi.spyOn(fs, 'opendir').mockResolvedValue(handle as unknown as Awaited<ReturnType<typeof fs.opendir>>);
    expect(await listVoiceLibraryFolders([{ path: base, label: 'Library' }])).toEqual([{ path: base, label: 'Library' }]);
    expect(yielded).toBe(10_000);
    expect(exited).toBe(true);
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it('cancels before starting filesystem work', async () => {
    const lstat = vi.spyOn(fs, 'lstat');
    await expect(listVoiceLibraryFolders([{ path: '/unused', label: 'Unused' }], AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
    expect(lstat).not.toHaveBeenCalled();
  });

  it('stops between asynchronous filesystem operations when the account changes', async () => {
    const base = await workspace();
    const controller = new AbortController();
    vi.spyOn(fs, 'access').mockImplementation(async () => { controller.abort(); });
    const opendir = vi.spyOn(fs, 'opendir');
    await expect(listVoiceLibraryFolders([{ path: base, label: 'Library' }], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(opendir).not.toHaveBeenCalled();
  });
});
