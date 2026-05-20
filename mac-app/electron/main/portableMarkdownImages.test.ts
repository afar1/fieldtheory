import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyImageForMarkdownDocument, makeMarkdownImagesPortable } from './portableMarkdownImages';

describe('portable markdown images main helpers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-portable-images-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies an image beside the markdown document and returns a relative embed', () => {
    const documentPath = path.join(tmpDir, 'Team Notes.md');
    const imagePath = path.join(tmpDir, 'Source Image.png');
    fs.writeFileSync(imagePath, Buffer.from([1, 2, 3]));

    const result = copyImageForMarkdownDocument(documentPath, imagePath, 'Reference screenshot');

    expect(result?.markdown).toBe('![Reference screenshot](<./Team%20Notes.assets/Source%20Image.png>)');
    expect(result?.copiedPath).toBe(path.join(tmpDir, 'Team Notes.assets', 'Source Image.png'));
    expect(fs.existsSync(result!.copiedPath)).toBe(true);
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

    const result = makeMarkdownImagesPortable(documentPath, content);

    expect(result.rewritten).toBe(1);
    expect(result.copied).toBe(1);
    expect(result.content).toContain('![Image](<./Shared.assets/Screenshot%201.png>)');
    expect(result.content).toContain('![Remote](https://example.com/image.png)');
    expect(fs.existsSync(path.join(tmpDir, 'Shared.assets', 'Screenshot 1.png'))).toBe(true);
  });

  it('repairs absolute private figure paths as well as file URLs', () => {
    const documentPath = path.join(tmpDir, 'Absolute.md');
    const privateFigureDir = path.join(tmpDir, 'Library/Application Support/fieldtheory-mac/users/u/figures');
    fs.mkdirSync(privateFigureDir, { recursive: true });
    const privateFigurePath = path.join(privateFigureDir, 'Screenshot 2.png');
    fs.writeFileSync(privateFigurePath, Buffer.from([7, 8, 9]));

    const result = makeMarkdownImagesPortable(documentPath, `![Image](<${privateFigurePath}>)`);

    expect(result.rewritten).toBe(1);
    expect(result.content).toBe('![Image](<./Absolute.assets/Screenshot%202.png>)');
    expect(fs.existsSync(path.join(tmpDir, 'Absolute.assets', 'Screenshot 2.png'))).toBe(true);
  });
});
