import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  getLibraryTextDocumentKind,
  isLibraryTextDocumentPath,
  isPathInside,
  libraryTextDocumentFileNameFromUserInput,
  markdownFileNameFromUserInput,
  normalizeUserDocumentNameInput,
  normalizeUserDocumentRelPathInput,
} from './pathSafety';

describe('pathSafety', () => {
  it('allows nested paths and rejects parent traversal', () => {
    const root = path.join(path.sep, 'tmp', 'notes');

    expect(isPathInside(root, path.join(root, 'entry.md'))).toBe(true);
    expect(isPathInside(root, path.join(root, 'folder', 'entry.md'))).toBe(true);
    expect(isPathInside(root, path.dirname(root))).toBe(false);
    expect(isPathInside(root, path.join(path.dirname(root), 'notes-other', 'entry.md'))).toBe(false);
  });

  it('does not reject an in-folder filename just because it starts with two dots', () => {
    const root = path.join(path.sep, 'tmp', 'notes');

    expect(isPathInside(root, path.join(root, '..draft.md'))).toBe(true);
  });

  it('normalizes markdown document filenames without accepting paths or hidden files', () => {
    expect(markdownFileNameFromUserInput('Daily Note')).toBe('Daily Note.md');
    expect(markdownFileNameFromUserInput('Daily Note.markdown')).toBe('Daily Note.markdown');
    expect(markdownFileNameFromUserInput('../escape')).toBeNull();
    expect(markdownFileNameFromUserInput('nested/escape')).toBeNull();
    expect(markdownFileNameFromUserInput('.hidden')).toBeNull();
  });

  it('recognizes library text documents without treating every file as viewable', () => {
    expect(isLibraryTextDocumentPath('/x/summary.html')).toBe(true);
    expect(isLibraryTextDocumentPath('/x/summary.HTM')).toBe(true);
    expect(isLibraryTextDocumentPath('/x/styles.css')).toBe(true);
    expect(isLibraryTextDocumentPath('/x/readme.md')).toBe(true);
    expect(isLibraryTextDocumentPath('/x/image.png')).toBe(false);
    expect(getLibraryTextDocumentKind('/x/summary.html')).toBe('html');
    expect(getLibraryTextDocumentKind('/x/styles.css')).toBe('css');
    expect(getLibraryTextDocumentKind('/x/readme.mdx')).toBe('markdown');
  });

  it('preserves html and css extensions when normalizing library document filenames', () => {
    expect(libraryTextDocumentFileNameFromUserInput('Summary', '.html')).toBe('Summary.html');
    expect(libraryTextDocumentFileNameFromUserInput('Summary.html', '.md')).toBe('Summary.html');
    expect(libraryTextDocumentFileNameFromUserInput('styles.css', '.html')).toBe('styles.css');
    expect(libraryTextDocumentFileNameFromUserInput('../escape.html', '.html')).toBeNull();
  });

  it('can reject underscore-prefixed document names for surfaces that hide them', () => {
    expect(normalizeUserDocumentNameInput('_draft')).toBe('_draft');
    expect(normalizeUserDocumentNameInput('_draft', { rejectLeadingUnderscore: true })).toBeNull();
  });

  it('normalizes document relative paths without accepting traversal or hidden segments', () => {
    expect(normalizeUserDocumentRelPathInput('Client Notes/Meetings')).toBe('Client Notes/Meetings');
    expect(normalizeUserDocumentRelPathInput('../outside')).toBeNull();
    expect(normalizeUserDocumentRelPathInput('Client Notes/.hidden')).toBeNull();
    expect(normalizeUserDocumentRelPathInput('Client Notes/_drafts', { rejectHiddenSegments: true })).toBeNull();
  });
});
