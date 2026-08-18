import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { kindleArtifactDir, kindleDeliveryStatePath } from './fieldTheoryPaths';
import { isPathInside } from './pathSafety';
import { createFieldTheoryTestEnv } from './testSupport/fieldTheoryTestEnv';
import {
  loadKindleDeliveryState,
  markKindleDeliverySent,
  prepareKindleDelivery,
  resolveKindleLibraryDocument,
  type KindleConverter,
} from './kindleDeliveryService';

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

describe('Kindle delivery service', () => {
  it('resolves Library documents by relative path, title, and absolute Library path', () => {
    const fixture = createFieldTheoryTestEnv('fieldtheory-kindle-');
    try {
      const sourcePath = writeLibraryDoc(
        fixture.libraryDir,
        'briefs/Algorithm Design.md',
        '# Algorithm Design\n\nA useful chapter.',
      );
      const options = { env: fixture.env, homeDir: fixture.homeDir };

      expect(resolveKindleLibraryDocument('briefs/Algorithm Design', options)).toMatchObject({
        title: 'Algorithm Design',
        sourcePath,
        sourceRelPath: 'briefs/Algorithm Design.md',
      });
      expect(resolveKindleLibraryDocument('Algorithm Design', options)).toMatchObject({
        sourcePath,
      });
      expect(resolveKindleLibraryDocument(sourcePath, options)).toMatchObject({
        sourceRelPath: 'briefs/Algorithm Design.md',
      });
    } finally {
      fixture.cleanup();
    }
  });

  it('plans hidden artifacts outside the visible Library during dry runs', async () => {
    const fixture = createFieldTheoryTestEnv('fieldtheory-kindle-');
    try {
      writeLibraryDoc(fixture.libraryDir, 'briefs/Hidden Output.md', '# Different Metadata Title\n\nBody');
      const options = { env: fixture.env, homeDir: fixture.homeDir, dryRun: true };

      const result = await prepareKindleDelivery('briefs/Hidden Output', options);

      expect(result.status).toBe('dry_run');
      expect(result.artifactPath.startsWith(kindleArtifactDir(options))).toBe(true);
      expect(path.basename(result.artifactPath)).toBe('Hidden Output.epub');
      expect(path.basename(path.dirname(result.artifactPath))).toBe(result.document.contentHash.slice(0, 16));
      expect(isPathInside(fixture.libraryDir, result.artifactPath)).toBe(false);
      expect(fs.existsSync(result.artifactPath)).toBe(false);
      expect(fs.existsSync(kindleDeliveryStatePath(options))).toBe(false);
      expect(result.sendPreflight).toMatchObject({
        recipientEmail: 'andrew.mfarah_xoV5w8@kindle.com',
        senderEmail: 'andrew@density.io',
        attachmentPath: result.artifactPath,
      });
    } finally {
      fixture.cleanup();
    }
  });

  it('reuses referenced Library cover art when converting an EPUB', async () => {
    const fixture = createFieldTheoryTestEnv('fieldtheory-kindle-');
    try {
      const coverArtPath = path.join(fixture.libraryDir, '.assets', 'illustrated-cover-art.png');
      fs.mkdirSync(path.dirname(coverArtPath), { recursive: true });
      fs.writeFileSync(coverArtPath, 'cover art');
      writeLibraryDoc(
        fixture.libraryDir,
        'Chapters/Illustrated.md',
        '# Illustrated\n\n![Cover](../.assets/illustrated-cover-art.png)\n\nBody',
      );
      let receivedCoverArtPath: string | undefined;
      const converter: KindleConverter = (input) => {
        receivedCoverArtPath = input.coverArtPath;
        fs.mkdirSync(path.dirname(input.artifactPath), { recursive: true });
        fs.writeFileSync(input.artifactPath, 'fake epub');
        return { ok: true };
      };

      const result = await prepareKindleDelivery('Chapters/Illustrated', {
        env: fixture.env,
        homeDir: fixture.homeDir,
        converter,
      });

      expect(result.status).toBe('prepared');
      expect(receivedCoverArtPath).toBe(coverArtPath);
    } finally {
      fixture.cleanup();
    }
  });

  it('prepares hidden artifacts, records state, and prevents duplicate prepares by default', async () => {
    const fixture = createFieldTheoryTestEnv('fieldtheory-kindle-');
    try {
      writeLibraryDoc(fixture.libraryDir, 'briefs/Delivery State.md', '# Delivery State\n\nBody');
      const options = {
        env: fixture.env,
        homeDir: fixture.homeDir,
        converter: fakeConverter(),
        now: new Date('2026-07-07T12:00:00.000Z'),
      };

      const first = await prepareKindleDelivery('briefs/Delivery State', options);

      expect(first.status).toBe('prepared');
      expect(fs.existsSync(first.artifactPath)).toBe(true);
      expect(isPathInside(fixture.libraryDir, first.artifactPath)).toBe(false);
      expect(loadKindleDeliveryState(options).deliveries).toHaveLength(1);

      const second = await prepareKindleDelivery('briefs/Delivery State', options);

      expect(second.status).toBe('already_prepared');
      expect(second.existingRecord?.key).toBe(first.deliveryKey);
      expect(loadKindleDeliveryState(options).deliveries).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  });

  it('marks a prepared delivery as sent only after an external send hook reports success', async () => {
    const fixture = createFieldTheoryTestEnv('fieldtheory-kindle-');
    try {
      writeLibraryDoc(fixture.libraryDir, 'briefs/Sent Hook.md', '# Sent Hook\n\nBody');
      const options = {
        env: fixture.env,
        homeDir: fixture.homeDir,
        converter: fakeConverter(),
        now: new Date('2026-07-07T12:00:00.000Z'),
      };
      const prepared = await prepareKindleDelivery('briefs/Sent Hook', options);

      const sent = markKindleDeliverySent(prepared.deliveryKey, {
        env: fixture.env,
        homeDir: fixture.homeDir,
        messageId: 'gmail-message-1',
        sentAt: new Date('2026-07-07T12:01:00.000Z'),
      });

      expect(sent.status).toBe('sent');
      expect(sent.sentMessageId).toBe('gmail-message-1');

      const next = await prepareKindleDelivery('briefs/Sent Hook', options);
      expect(next.status).toBe('already_sent');
    } finally {
      fixture.cleanup();
    }
  });
});
