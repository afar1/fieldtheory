import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { PassThrough } from 'stream';
import type { ChildProcess, SpawnOptions } from 'child_process';
import { describe, expect, it, vi } from 'vitest';
import { createFieldTheoryTestEnv } from './testSupport/fieldTheoryTestEnv';
import { loadKindleDeliveryState, prepareKindleDelivery, type KindleConverter } from './kindleDeliveryService';
import {
  buildKindleCodexPrompt,
  readKindleCodexJob,
  readKindleCodexJobResult,
  startKindleCodexSend,
  writeKindleCodexJob,
} from './kindleCodexBridge';

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 4242;
  kill = vi.fn(() => true);
}

function writeLibraryDoc(rootPath: string, relPath: string, content: string): string {
  const filePath = path.join(rootPath, ...relPath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function fakeConverter(): KindleConverter {
  return ({ artifactPath }) => {
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, 'fake epub');
    return { ok: true };
  };
}

describe('Kindle Codex bridge', () => {
  it('creates a job and starts codex with the Kindle skill prompt', async () => {
    const fixture = createFieldTheoryTestEnv('fieldtheory-kindle-codex-');
    try {
      writeLibraryDoc(fixture.libraryDir, 'Chapters/Metrics.md', '# Metrics\n\nBody');
      const options = {
        env: fixture.env,
        homeDir: fixture.homeDir,
        converter: fakeConverter(),
        now: new Date('2026-07-07T12:00:00.000Z'),
      };
      const prepared = await prepareKindleDelivery('Chapters/Metrics', options);
      const child = new FakeChildProcess();
      const spawnFn = vi.fn((_command: string, _args: ReadonlyArray<string>, _options: SpawnOptions) => child as unknown as ChildProcess);

      const result = startKindleCodexSend(prepared, {
        env: fixture.env,
        homeDir: fixture.homeDir,
        spawnFn,
        now: new Date('2026-07-07T12:00:01.000Z'),
      });

      expect(result.status).toBe('queued');
      expect(result.jobPath).toBeTruthy();
      expect(result.job?.status).toBe('running');
      expect(spawnFn).toHaveBeenCalledTimes(1);
      const [command, args, spawnOptions] = spawnFn.mock.calls[0];
      const prompt = args[args.length - 1];
      expect(command).toBe('codex');
      expect(args).toEqual(expect.arrayContaining(['exec', '--dangerously-bypass-approvals-and-sandbox']));
      expect(prompt).toContain('Use $kindle');
      expect(prompt).toContain(prepared.artifactPath);
      expect(String(spawnOptions.env?.PATH)).toContain('/opt/homebrew/bin');

      const job = readKindleCodexJob(result.jobPath!, { env: fixture.env, homeDir: fixture.homeDir });
      expect(job).toMatchObject({
        status: 'running',
        deliveryKey: prepared.deliveryKey,
        artifactPath: prepared.artifactPath,
        pid: 4242,
      });
    } finally {
      fixture.cleanup();
    }
  });

  it('syncs a verified sent job back into Kindle delivery state', async () => {
    const fixture = createFieldTheoryTestEnv('fieldtheory-kindle-codex-');
    try {
      writeLibraryDoc(fixture.libraryDir, 'briefs/Sent.md', '# Sent\n\nBody');
      const options = {
        env: fixture.env,
        homeDir: fixture.homeDir,
        converter: fakeConverter(),
        now: new Date('2026-07-07T12:00:00.000Z'),
      };
      const prepared = await prepareKindleDelivery('briefs/Sent', options);
      const child = new FakeChildProcess();
      const result = startKindleCodexSend(prepared, {
        env: fixture.env,
        homeDir: fixture.homeDir,
        spawnFn: () => child as unknown as ChildProcess,
        now: new Date('2026-07-07T12:00:01.000Z'),
      });
      const jobPath = result.jobPath!;
      const running = readKindleCodexJob(jobPath, { env: fixture.env, homeDir: fixture.homeDir });
      expect(running).toBeTruthy();

      writeKindleCodexJob(jobPath, {
        ...running!,
        status: 'sent',
        sentAt: '2026-07-07T12:01:00.000Z',
        sentMessageId: 'gmail-message-1',
      }, { env: fixture.env, homeDir: fixture.homeDir });

      const read = readKindleCodexJobResult(jobPath, { env: fixture.env, homeDir: fixture.homeDir });
      expect(read.status).toBe('ok');
      expect(loadKindleDeliveryState(options).deliveries[0]).toMatchObject({
        status: 'sent',
        sentMessageId: 'gmail-message-1',
      });
    } finally {
      fixture.cleanup();
    }
  });

  it('marks the job failed when codex exits without sent verification', async () => {
    const fixture = createFieldTheoryTestEnv('fieldtheory-kindle-codex-');
    try {
      writeLibraryDoc(fixture.libraryDir, 'briefs/Failed.md', '# Failed\n\nBody');
      const options = {
        env: fixture.env,
        homeDir: fixture.homeDir,
        converter: fakeConverter(),
        now: new Date('2026-07-07T12:00:00.000Z'),
      };
      const prepared = await prepareKindleDelivery('briefs/Failed', options);
      const child = new FakeChildProcess();
      const result = startKindleCodexSend(prepared, {
        env: fixture.env,
        homeDir: fixture.homeDir,
        spawnFn: () => child as unknown as ChildProcess,
        now: new Date('2026-07-07T12:00:01.000Z'),
      });

      child.emit('exit', 0, null);

      const job = readKindleCodexJob(result.jobPath!, { env: fixture.env, homeDir: fixture.homeDir });
      expect(job?.status).toBe('failed');
      expect(job?.error).toContain('without verified Kindle send');
    } finally {
      fixture.cleanup();
    }
  });

  it('builds a prompt that tells Codex not to mutate Field Theory state directly', () => {
    const prompt = buildKindleCodexPrompt('/tmp/job.json', {
      version: 1,
      status: 'queued',
      createdAt: '2026-07-07T12:00:00.000Z',
      updatedAt: '2026-07-07T12:00:00.000Z',
      sourcePath: '/tmp/source.md',
      sourceRelPath: 'briefs/source.md',
      deliveryKey: 'briefs/source.md:abc:epub',
      artifactPath: '/tmp/source.epub',
      title: 'Source',
      author: 'Andrew Farah',
      recipientEmail: 'andrew.mfarah_xoV5w8@kindle.com',
      senderEmail: 'andrew@density.io',
      requestedBy: 'field-theory-mac-app',
    });

    expect(prompt).toContain('Use $kindle');
    expect(prompt).toContain('Prepared EPUB artifact: /tmp/source.epub');
    expect(prompt).toContain('do not edit state.json directly');
  });
});
