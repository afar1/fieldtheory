import { describe, expect, it } from 'vitest';
import {
  buildEffectiveArtifactRuleContent,
  extractArtifactModelSignature,
  hasArtifactStructureInstruction,
  hasArtifactTitleInstruction,
  hasArtifactModelSignatureInstruction,
  parseMarkdownHeader,
} from './librarianManager';

describe('parseMarkdownHeader', () => {
  it('extracts H1 title', () => {
    const content = '# The Adversarial Collaborator\n\nSome body text.';
    expect(parseMarkdownHeader(content).title).toBe('The Adversarial Collaborator');
  });

  it('extracts H2 title', () => {
    const content = "## Lamarck's Revenge\n\nBody text here.";
    expect(parseMarkdownHeader(content).title).toBe("Lamarck's Revenge");
  });

  it('extracts H3 title', () => {
    const content = '### A Smaller Heading\n\nBody.';
    expect(parseMarkdownHeader(content).title).toBe('A Smaller Heading');
  });

  it('ignores H4+ headings', () => {
    const content = '#### Too Deep\n\nBody.';
    expect(parseMarkdownHeader(content).title).toBe('Untitled Reading');
  });

  it('returns Untitled Reading when no heading exists', () => {
    const content = 'In 1962, John Glenn orbited Earth three times.\n\nNo heading here.';
    expect(parseMarkdownHeader(content).title).toBe('Untitled Reading');
  });

  it('uses first heading only', () => {
    const content = '# First Title\n\n## Second Title\n\nBody.';
    expect(parseMarkdownHeader(content).title).toBe('First Title');
  });

  it('skips blank lines before heading', () => {
    const content = '\n\n# After Blanks\n\nBody.';
    expect(parseMarkdownHeader(content).title).toBe('After Blanks');
  });

  it('extracts reading time', () => {
    const content = '# Title\n\n*Reading time: ~4 minutes*';
    const result = parseMarkdownHeader(content);
    expect(result.title).toBe('Title');
    expect(result.readingTime).toBe('~4 minutes');
  });

  it('extracts context', () => {
    const content = '# Title\n\n*Context: Auth architecture refactoring*';
    const result = parseMarkdownHeader(content);
    expect(result.context).toBe('Auth architecture refactoring');
  });

  it('extracts model signature', () => {
    const content = '# Title\n\n*Model: GPT-5 Codex*';
    const result = parseMarkdownHeader(content);
    expect(result.modelSignature).toBe('GPT-5 Codex');
  });

  it('extracts signed-by signature alias', () => {
    const content = '# Title\n\n*Signed by: Claude Sonnet*';
    const result = parseMarkdownHeader(content);
    expect(result.modelSignature).toBe('Claude Sonnet');
  });

  it('finds metadata after a braille art block', () => {
    const art = Array.from({ length: 15 }, () => '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀').join('\n');
    const content = `# Title\n\n${art}\n\n*Model: GPT-5 Codex*\n*Context: Artifact signing*\n*Reading time: ~2 minutes*\n\nBody.`;
    const result = parseMarkdownHeader(content);
    expect(result.modelSignature).toBe('GPT-5 Codex');
    expect(result.context).toBe('Artifact signing');
    expect(result.readingTime).toBe('~2 minutes');
  });

  it('does not match hashtags without space', () => {
    const content = '#not-a-heading\n\nBody.';
    expect(parseMarkdownHeader(content).title).toBe('Untitled Reading');
  });
});

describe('artifact signature helpers', () => {
  it('extracts signature metadata from supported header lines', () => {
    expect(extractArtifactModelSignature('*Model: GPT-5 Codex*')).toBe('GPT-5 Codex');
    expect(extractArtifactModelSignature('*Signed by: Claude Sonnet*')).toBe('Claude Sonnet');
  });

  it('detects when rule content already includes signature instructions', () => {
    expect(hasArtifactModelSignatureInstruction('Required metadata: *Model: GPT-5 Codex*')).toBe(true);
    expect(hasArtifactModelSignatureInstruction('Write a short reflective story.')).toBe(false);
  });

  it('detects when rule content includes artifact title/structure instructions', () => {
    expect(hasArtifactTitleInstruction('Structure:\n1. Title (# heading)\n2. Signature metadata line: *Model: GPT-5 Codex*')).toBe(true);
    expect(hasArtifactStructureInstruction('Structure:\n1. Title (# heading)\n2. Signature metadata line: *Model: GPT-5 Codex*')).toBe(true);
    expect(hasArtifactStructureInstruction('Write a short reflective story.')).toBe(false);
  });

  it('appends artifact structure requirements when the rule only asks for prose', () => {
    const result = buildEffectiveArtifactRuleContent('Write a short reflective story.');
    expect(result).toContain('Title (# heading)');
    expect(result).toContain('Signature metadata line');
    expect(result).toContain('*Model: <the exact model or assistant name that wrote this artifact>*');
  });

  it('preserves explicit title instructions while still appending signature metadata when needed', () => {
    const result = buildEffectiveArtifactRuleContent('Start with a markdown H1 title, then write the story body.');
    expect(result).toContain('Required artifact format:');
    expect(result).toContain('Signature metadata line');
    expect(result).toContain('*Model: <the exact model or assistant name that wrote this artifact>*');
  });
});
