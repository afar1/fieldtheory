import os from 'os';
import { describe, expect, it, vi } from 'vitest';
import { BookmarkSyncRunner } from './bookmarkSyncRunner';
const command = { executable: '/runtime/Electron', args: ['/resources/bookmark-sync/cli.js'], env: { ELECTRON_RUN_AS_NODE: '1' } };
const signal = new AbortController().signal;
describe('BookmarkSyncRunner', () => {
  it('never syncs with a CLI lacking explicit quick capability', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: 'Usage: ft sync [--yes]' });
    const runner = new BookmarkSyncRunner(() => command, exec);
    expect((await runner.quick(signal)).status).toBe('unsupported'); expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][1]).toEqual([...command.args, 'sync', '--help']);
  });
  it('requires quick JSON and caches capability for the executable', async () => {
    const exec = vi.fn().mockResolvedValueOnce({ stdout: '--quick --json' }).mockResolvedValue({ stdout: '{"mode":"quick","status":"synced","added":2,"changed":1}' });
    const runner = new BookmarkSyncRunner(() => command, exec);
    expect(await runner.quick(signal)).toMatchObject({ status: 'synced', added: 2, changed: 1 }); await runner.quick(signal);
    expect(exec).toHaveBeenCalledTimes(3);
    expect(exec.mock.calls[1]).toEqual([command.executable, [...command.args, 'sync', '--quick', '--json'], expect.objectContaining({ timeout: 45_000, killSignal: 'SIGKILL', signal, maxBuffer: 512 * 1024 })]);
  });
  it('refuses non-quick output', async () => {
    const exec = vi.fn().mockResolvedValueOnce({ stdout: '--quick' }).mockResolvedValue({ stdout: '{"status":"synced"}' });
    expect((await new BookmarkSyncRunner(() => command, exec).quick(signal)).status).toBe('unsupported');
  });
  it('handles deadline failures and structured rate limits', async () => {
    const exec = vi.fn().mockResolvedValueOnce({ stdout: '--quick' }).mockRejectedValueOnce({ killed: true }).mockResolvedValueOnce({ stdout: '{"mode":"quick","status":"rate_limited","retryAfterSec":900}' });
    const runner = new BookmarkSyncRunner(() => command, exec);
    expect((await runner.quick(signal)).status).toBe('timeout'); expect(await runner.quick(signal)).toMatchObject({ status: 'rate_limited', retryAfterSec: 900 });
  });
  it('bounds media records, bytes, duration, and cancellation', async () => {
    const exec = vi.fn().mockResolvedValueOnce({ stdout: '--quick' }).mockResolvedValueOnce({ stdout: '{"mode":"quick","status":"synced"}' }).mockResolvedValueOnce({ stdout: '{"status":"complete","remaining":true}' });
    const runner = new BookmarkSyncRunner(() => command, exec); await runner.quick(signal);
    expect(await runner.maintenance(signal)).toMatchObject({ remaining: true, changed: false });
    expect(exec.mock.calls[2]).toEqual([command.executable, [...command.args, 'fetch-media', '--limit', '8', '--max-bytes', '5242880', '--json'], expect.objectContaining({ timeout: 25_000, signal, killSignal: 'SIGKILL' })]);
  });
  it('runs index only when explicitly requested and bounds it independently of media', async () => {
    const exec = vi.fn().mockResolvedValueOnce({ stdout: '--quick' })
      .mockResolvedValueOnce({ stdout: '{"mode":"quick","status":"synced"}' })
      .mockResolvedValueOnce({ stdout: '{"mode":"index","status":"complete"}' })
      .mockResolvedValueOnce({ stdout: '{"status":"complete","remaining":false,"downloaded":0}' });
    const runner = new BookmarkSyncRunner(() => command, exec);
    await runner.quick(signal);
    expect(await runner.maintenance(signal, { index: true })).toMatchObject({ changed: false, remaining: false });
    expect(exec.mock.calls[2]).toEqual([command.executable, [...command.args, 'index', '--json'], expect.objectContaining({ timeout: 20_000, signal })]);
    expect(exec.mock.calls[3][1]).toContain('fetch-media');
  });
  it('lowers only maintenance child priority without changing the app process', async () => {
    const priority = vi.spyOn(os, 'setPriority').mockImplementation(() => {});
    try {
      const processResult = (stdout: string) => Object.assign(Promise.resolve({ stdout }), { child: { pid: 12345 } });
      const exec = vi.fn().mockImplementationOnce(() => processResult('--quick'))
        .mockImplementationOnce(() => processResult('{"mode":"quick","status":"synced"}'))
        .mockImplementationOnce(() => processResult('{"status":"complete"}'));
      const runner = new BookmarkSyncRunner(() => command, exec);
      await runner.quick(signal);
      expect(priority).not.toHaveBeenCalled();
      await runner.maintenance(signal);
      expect(priority).toHaveBeenCalledExactlyOnceWith(12345, os.constants.priority.PRIORITY_LOW);
    } finally { priority.mockRestore(); }
  });
});
