import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { consolidateMarkdownAssetsForLibraryRoot, copyImageDataUrlForMarkdownDocument, copyImageForMarkdownDocument, deleteUnusedCopiedMarkdownImages, makeMarkdownImagesPortable, makeMarkdownImagesSharePortable } from './portableMarkdownImages';

function sha256Name(bytes: Buffer, ext = '.png'): string {
  return `sha256-${crypto.createHash('sha256').update(bytes).digest('hex')}${ext}`;
}

describe('portable markdown images main helpers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-portable-images-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies an image into the library asset store and returns a relative embed', () => {
    const documentPath = path.join(tmpDir, 'Commands', 'Team Notes.md');
    const imagePath = path.join(tmpDir, 'Source Image.png');
    const bytes = Buffer.from([1, 2, 3]);
    fs.mkdirSync(path.dirname(documentPath), { recursive: true });
    fs.writeFileSync(imagePath, bytes);

    const result = copyImageForMarkdownDocument(documentPath, imagePath, 'Reference screenshot', { libraryRoots: [tmpDir] });

    const assetName = sha256Name(bytes);
    expect(result?.markdown).toBe(`![Reference screenshot](<../.assets/${assetName}>)`);
    expect(result?.copiedPath).toBe(path.join(tmpDir, '.assets', assetName));
    expect(fs.existsSync(result!.copiedPath)).toBe(true);
  });

  it('copies a drawing data URL into the library asset store', () => {
    const documentPath = path.join(tmpDir, 'Drawings.md');
    const bytes = Buffer.from([1, 2, 3, 4]);
    const result = copyImageDataUrlForMarkdownDocument(
      documentPath,
      `data:image/png;base64,${bytes.toString('base64')}`,
      'Drawing',
      { libraryRoots: [tmpDir] },
    );

    const assetName = sha256Name(bytes);
    expect(result?.markdown).toBe(`![Drawing](<./.assets/${assetName}>)`);
    expect(fs.existsSync(path.join(tmpDir, '.assets', assetName))).toBe(true);
  });

  it('reuses the content-hash asset for duplicate image content', () => {
    const documentPath = path.join(tmpDir, 'Note.md');
    const firstPath = path.join(tmpDir, 'First.png');
    const secondPath = path.join(tmpDir, 'Second.png');
    const bytes = Buffer.from([9, 8, 7]);
    fs.writeFileSync(firstPath, bytes);
    fs.writeFileSync(secondPath, bytes);

    const first = copyImageForMarkdownDocument(documentPath, firstPath, 'Image', { libraryRoots: [tmpDir] });
    const second = copyImageForMarkdownDocument(documentPath, secondPath, 'Image', { libraryRoots: [tmpDir] });

    expect(first?.copiedPath).toBe(second?.copiedPath);
    expect(fs.readdirSync(path.join(tmpDir, '.assets'))).toHaveLength(1);
  });

  it('repairs private Field Theory figure links and leaves other image links alone', () => {
    const documentPath = path.join(tmpDir, 'Shared.md');
    const privateFigureDir = path.join(tmpDir, 'Library/Application Support/fieldtheory-mac/users/u/figures');
    fs.mkdirSync(privateFigureDir, { recursive: true });
    const privateFigurePath = path.join(privateFigureDir, 'Screenshot 1.png');
    fs.writeFileSync(privateFigurePath, Buffer.from([4, 5, 6]));
    const content = [
      `![Image](<file://${privateFigurePath.split('/').map((part, index) => index === 0 ? '' : encodeURIComponent(part)).join('/')}>)`,
      '![Remote](https://example.com/image.png)',
    ].join('\n\n');

    const result = makeMarkdownImagesPortable(documentPath, content, { libraryRoots: [tmpDir] });
    const assetName = sha256Name(Buffer.from([4, 5, 6]));

    expect(result.rewritten).toBe(1);
    expect(result.copied).toBe(1);
    expect(result.content).toContain(`![Image](<./.assets/${assetName}>)`);
    expect(result.content).toContain('![Remote](https://example.com/image.png)');
    expect(fs.existsSync(path.join(tmpDir, '.assets', assetName))).toBe(true);
  });

  it('repairs absolute private figure paths as well as file URLs', () => {
    const documentPath = path.join(tmpDir, 'Absolute.md');
    const privateFigureDir = path.join(tmpDir, 'Library/Application Support/fieldtheory-mac/users/u/figures');
    fs.mkdirSync(privateFigureDir, { recursive: true });
    const privateFigurePath = path.join(privateFigureDir, 'Screenshot 2.png');
    fs.writeFileSync(privateFigurePath, Buffer.from([7, 8, 9]));

    const result = makeMarkdownImagesPortable(documentPath, `![Image](<${privateFigurePath}>)`, { libraryRoots: [tmpDir] });
    const assetName = sha256Name(Buffer.from([7, 8, 9]));

    expect(result.rewritten).toBe(1);
    expect(result.content).toBe(`![Image](<./.assets/${assetName}>)`);
    expect(fs.existsSync(path.join(tmpDir, '.assets', assetName))).toBe(true);
  });

  it('repairs unbracketed absolute private figure paths with spaces', () => {
    const documentPath = path.join(tmpDir, 'Absolute.md');
    const privateFigureDir = path.join(tmpDir, 'Library/Application Support/fieldtheory-mac/users/u/figures');
    fs.mkdirSync(privateFigureDir, { recursive: true });
    const privateFigurePath = path.join(privateFigureDir, 'Screenshot 3.png');
    fs.writeFileSync(privateFigurePath, Buffer.from([8, 9, 10]));

    const result = makeMarkdownImagesPortable(documentPath, `![Image](${privateFigurePath})`, { libraryRoots: [tmpDir] });
    const assetName = sha256Name(Buffer.from([8, 9, 10]));

    expect(result.rewritten).toBe(1);
    expect(result.content).toBe(`![Image](<./.assets/${assetName}>)`);
    expect(fs.existsSync(path.join(tmpDir, '.assets', assetName))).toBe(true);
  });

  it('deletes removed copied image assets when no remaining image references them', () => {
    const documentPath = path.join(tmpDir, 'Delete Me.md');
    const imagePath = path.join(tmpDir, 'Screenshot 3.png');
    fs.writeFileSync(imagePath, Buffer.from([1, 2, 3]));
    const copied = copyImageForMarkdownDocument(documentPath, imagePath, 'Image', { libraryRoots: [tmpDir] });

    const result = deleteUnusedCopiedMarkdownImages(documentPath, copied!.markdown, 'remaining text', { libraryRoots: [tmpDir] });

    expect(result).toEqual({ deleted: 1, skipped: 0, missing: 0 });
    expect(fs.existsSync(copied!.copiedPath)).toBe(false);
  });

  it('keeps copied image assets that are still referenced', () => {
    const documentPath = path.join(tmpDir, 'Still Used.md');
    const imagePath = path.join(tmpDir, 'Screenshot 4.png');
    fs.writeFileSync(imagePath, Buffer.from([4, 5, 6]));
    const copied = copyImageForMarkdownDocument(documentPath, imagePath, 'Image', { libraryRoots: [tmpDir] });

    const result = deleteUnusedCopiedMarkdownImages(documentPath, copied!.markdown, copied!.markdown, { libraryRoots: [tmpDir] });

    expect(result).toEqual({ deleted: 0, skipped: 1, missing: 0 });
    expect(fs.existsSync(copied!.copiedPath)).toBe(true);
  });

  it('does not delete an asset while another markdown file in the library references it', () => {
    const documentPath = path.join(tmpDir, 'One.md');
    const otherDocumentPath = path.join(tmpDir, 'Two.md');
    const imagePath = path.join(tmpDir, 'Shared.png');
    fs.writeFileSync(imagePath, Buffer.from([5, 5, 5]));
    const copied = copyImageForMarkdownDocument(documentPath, imagePath, 'Image', { libraryRoots: [tmpDir] });
    fs.writeFileSync(otherDocumentPath, copied!.markdown);

    const result = deleteUnusedCopiedMarkdownImages(documentPath, copied!.markdown, 'removed here', { libraryRoots: [tmpDir] });

    expect(result).toEqual({ deleted: 0, skipped: 1, missing: 0 });
    expect(fs.existsSync(copied!.copiedPath)).toBe(true);
  });

  it('does not delete image paths outside the document assets folder', () => {
    const documentPath = path.join(tmpDir, 'Safe.md');
    const otherDir = path.join(tmpDir, 'Other.assets');
    fs.mkdirSync(otherDir, { recursive: true });
    const otherImagePath = path.join(otherDir, 'Outside.png');
    fs.writeFileSync(otherImagePath, Buffer.from([7, 8, 9]));

    const result = deleteUnusedCopiedMarkdownImages(documentPath, '![Image](<./Other.assets/Outside.png>)', '', { libraryRoots: [tmpDir] });

    expect(result).toEqual({ deleted: 1, skipped: 0, missing: 0 });
    expect(fs.existsSync(otherImagePath)).toBe(false);
  });

  it('consolidates legacy document asset folders and removes empty old folders', () => {
    const documentPath = path.join(tmpDir, 'Doc.md');
    const legacyDir = path.join(tmpDir, 'Doc.assets');
    const imageBytes = Buffer.from([8, 8, 8]);
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'Old Image.png'), imageBytes);
    fs.writeFileSync(documentPath, 'before\n![Image](<./Doc.assets/Old%20Image.png>)\nafter');

    const result = consolidateMarkdownAssetsForLibraryRoot(tmpDir);
    const assetName = sha256Name(imageBytes);

    expect(result.filesRewritten).toBe(1);
    expect(fs.readFileSync(documentPath, 'utf-8')).toContain(`![Image](<./.assets/${assetName}>)`);
    expect(fs.existsSync(path.join(tmpDir, '.assets', assetName))).toBe(true);
    expect(fs.existsSync(legacyDir)).toBe(false);
  });

  it('embeds only referenced local assets for River transport and materializes them on receive', () => {
    const sourceDocumentPath = path.join(tmpDir, 'Commands', 'Source.md');
    const unusedImagePath = path.join(tmpDir, '.assets', 'sha256-unused.png');
    const imagePath = path.join(tmpDir, 'Source.png');
    const bytes = Buffer.from([3, 3, 3]);
    fs.mkdirSync(path.dirname(sourceDocumentPath), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.assets'), { recursive: true });
    fs.writeFileSync(imagePath, bytes);
    fs.writeFileSync(unusedImagePath, Buffer.from([4, 4, 4]));
    const copied = copyImageForMarkdownDocument(sourceDocumentPath, imagePath, 'Image', { libraryRoots: [tmpDir] });

    const outbound = makeMarkdownImagesSharePortable(sourceDocumentPath, `hello\n${copied!.markdown}`, { libraryRoots: [tmpDir] });

    expect(outbound.embedded).toBe(1);
    expect(outbound.content).toContain('data:image/png;base64,AwMD');
    expect(outbound.content).not.toContain('unused');

    const receiverRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-portable-images-receiver-'));
    try {
      const receiverDocumentPath = path.join(receiverRoot, 'River (shared)', 'Source AM.md');
      fs.mkdirSync(path.dirname(receiverDocumentPath), { recursive: true });
      const inbound = makeMarkdownImagesPortable(receiverDocumentPath, outbound.content, { libraryRoots: [receiverRoot] });
      const assetName = sha256Name(bytes);

      expect(inbound.rewritten).toBe(1);
      expect(inbound.content).toContain(`![Image](<../.assets/${assetName}>)`);
      expect(fs.existsSync(path.join(receiverRoot, '.assets', assetName))).toBe(true);
    } finally {
      fs.rmSync(receiverRoot, { recursive: true, force: true });
    }
  });
});
