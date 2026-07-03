import { describe, expect, it } from 'vitest';
import { getAgentImproveContext } from '../utils/agentImproveContext';

describe('getAgentImproveContext', () => {
  it('uses selected textarea text first', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'alpha beta gamma';
    textarea.dataset.ftAgentContext = 'markdown';
    textarea.dataset.ftAgentFilePath = '/tmp/note.md';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(6, 10);

    expect(getAgentImproveContext()).toEqual({
      kind: 'selection',
      content: 'beta',
      filePath: '/tmp/note.md',
      title: null,
      selectionStart: 6,
      selectionEnd: 10,
    });

    textarea.remove();
  });

  it('falls back to the whole markdown textarea when nothing is selected', () => {
    const textarea = document.createElement('textarea');
    textarea.value = '# Note\n\nBody';
    textarea.dataset.ftAgentContext = 'markdown';
    textarea.dataset.ftAgentFilePath = '/tmp/note.md';
    textarea.dataset.ftAgentTitle = 'Note';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    expect(getAgentImproveContext()).toEqual({
      kind: 'markdown-file',
      content: '# Note\n\nBody',
      filePath: '/tmp/note.md',
      title: 'Note',
    });

    textarea.remove();
  });

  it('returns null when there is no usable text', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    expect(getAgentImproveContext()).toBeNull();

    input.remove();
  });
});
