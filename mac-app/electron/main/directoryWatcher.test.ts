import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { once } from 'events';
import { watch, FSWatcher } from './directoryWatcher';

const roots: string[] = [];
const watchers: FSWatcher[] = [];
afterEach(async () => {
  await Promise.all(watchers.splice(0).map(watcher => watcher.close()));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function setup(options: Parameters<typeof watch>[1] = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-directory-watch-'));
  roots.push(root);
  const watcher = watch(root, { ignoreInitial: true, ...options });
  watchers.push(watcher);
  const events: string[] = [];
  for (const event of ['add', 'change', 'unlink', 'addDir', 'unlinkDir']) {
    watcher.on(event, candidate => events.push(`${event}:${path.relative(root, candidate)}`));
  }
  return { root, watcher, events };
}

describe('native directory watching', () => {
  it('keeps nested documents live through creation, edits, atomic replacement, rename and deletion', async () => {
    const { root, watcher, events } = setup({ awaitWriteFinish: { stabilityThreshold: 40, pollInterval: 20 } });
    await once(watcher, 'ready');
    const folder = path.join(root, 'nested');
    fs.mkdirSync(folder);
    await expect.poll(() => events).toContain('addDir:nested');
    const file = path.join(folder, 'note.md');
    fs.writeFileSync(file, 'first');
    await expect.poll(() => events).toContain('add:nested/note.md');
    events.length = 0;
    fs.appendFileSync(file, ' edited');
    await expect.poll(() => events).toContain('change:nested/note.md');
    events.length = 0;
    const temporary = path.join(folder, 'replacement.tmp');
    fs.writeFileSync(temporary, 'replacement');
    fs.renameSync(temporary, file);
    await expect.poll(() => events).toContain('change:nested/note.md');
    fs.renameSync(file, path.join(folder, 'renamed.md'));
    await expect.poll(() => events).toContain('unlink:nested/note.md');
    await expect.poll(() => events).toContain('add:nested/renamed.md');
    fs.rmSync(folder, { recursive: true });
    await expect.poll(() => events).toContain('unlink:nested/renamed.md');
    await expect.poll(() => events).toContain('unlinkDir:nested');
  }, 15000);

  it('respects depth and excluded directory trees, and emits nothing after close', async () => {
    const { root, watcher, events } = setup({ depth: 0, ignored: candidate => candidate.split(path.sep).includes('ignored') });
    fs.mkdirSync(path.join(root, 'ignored'));
    fs.writeFileSync(path.join(root, 'existing.md'), 'existing');
    await once(watcher, 'ready');
    expect(events).toEqual([]);
    fs.mkdirSync(path.join(root, 'nested'));
    fs.writeFileSync(path.join(root, 'nested', 'deep.md'), 'deep');
    fs.writeFileSync(path.join(root, 'ignored', 'hidden.md'), 'hidden');
    fs.writeFileSync(path.join(root, 'visible.md'), 'visible');
    await expect.poll(() => events).toContain('add:visible.md');
    expect(events.some(event => event.includes('deep.md') || event.includes('ignored'))).toBe(false);
    await watcher.close();
    events.length = 0;
    fs.writeFileSync(path.join(root, 'later.md'), 'later');
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(events).toEqual([]);
    expect(watcher.getWatched()).toEqual({});
  });
});
