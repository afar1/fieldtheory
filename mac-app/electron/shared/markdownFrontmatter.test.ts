import { describe, expect, it } from 'vitest';
import {
  getMarkdownTodoState,
  parseMarkdownFrontmatter,
  parseMarkdownArchivedState,
  parseMarkdownTodoState,
  setMarkdownArchivedState,
  setMarkdownTodoState,
} from './markdownFrontmatter';

describe('markdownFrontmatter', () => {
  it('parses scalar frontmatter keys while preserving the body', () => {
    const parsed = parseMarkdownFrontmatter('---\ntags: [work]\nsource-type: "authored"\n---\n\n# Note\n');

    expect(parsed.meta.tags).toBe('[work]');
    expect(parsed.meta.source_type).toBe('authored');
    expect(parsed.body).toBe('# Note\n');
  });

  it('leaves empty frontmatter delimiters as raw markdown', () => {
    const parsed = parseMarkdownFrontmatter('---\n---\n\nBody only.');

    expect(parsed.raw).toBeNull();
    expect(parsed.meta).toEqual({});
    expect(parsed.body).toBe('---\n---\n\nBody only.');
  });

  it('reads open and done todo state aliases', () => {
    expect(parseMarkdownTodoState('---\ntodo: true\ntodo_state: open\n---\n# Task')).toBe('open');
    expect(parseMarkdownTodoState('---\ntask: done\n---\n# Task')).toBe('done');
    expect(parseMarkdownTodoState('---\ntask: true\ntask_state: done\n---\n# Task')).toBe('done');
    expect(parseMarkdownTodoState('---\ntodo: false\n---\n# Note')).toBeNull();
    expect(getMarkdownTodoState({ todo: 'yes' })).toBe('open');
  });

  it('sets and removes todo state while preserving unrelated frontmatter lines', () => {
    const content = '---\ntags: [work]\n---\n# Task\n';

    expect(setMarkdownTodoState(content, 'open')).toBe('---\ntags: [work]\n\ntodo: true\ntodo_state: open\n---\n\n# Task\n');
    expect(setMarkdownTodoState('---\ntags: [work]\ntodo: true\ntodo_state: done\n---\n# Task\n', null)).toBe('---\ntags: [work]\n---\n\n# Task\n');
  });

  it('does not add frontmatter when removing a missing todo state', () => {
    expect(setMarkdownTodoState('# Note\n', null)).toBe('# Note\n');
    expect(setMarkdownTodoState('---\n---\n\n# Note\n', null)).toBe('---\n---\n\n# Note\n');
  });

  it('reads, sets, and removes archived state', () => {
    expect(parseMarkdownArchivedState('---\narchived: true\n---\n# Note')).toBe(true);
    expect(parseMarkdownArchivedState('---\narchived: false\n---\n# Note')).toBe(false);

    expect(setMarkdownArchivedState('# Note\n', true)).toBe('---\narchived: true\n---\n\n# Note\n');
    expect(setMarkdownArchivedState('---\ntags: [work]\narchived: true\n---\n# Note\n', false)).toBe('---\ntags: [work]\n---\n\n# Note\n');
  });
});
