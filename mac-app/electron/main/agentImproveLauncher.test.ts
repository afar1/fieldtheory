import { describe, expect, it } from 'vitest';
import {
  buildAgentImprovePrompt,
  buildAgentImproveShellCommand,
  buildTerminalAppleScript,
  quoteShellArg,
} from './agentImproveLauncher';

describe('agentImproveLauncher', () => {
  it('builds a prompt with instruction, file path, and markdown content', () => {
    const prompt = buildAgentImprovePrompt({
      tool: 'codex',
      instruction: 'Tighten this up.',
      content: '# Draft\n\nhello',
      contextKind: 'markdown-file',
      filePath: '/tmp/note.md',
      title: 'note.md',
    });

    expect(prompt).toContain('Tighten this up.');
    expect(prompt).toContain('- Type: Markdown file');
    expect(prompt).toContain('- File: /tmp/note.md');
    expect(prompt).toContain('# Draft\n\nhello');
  });

  it('quotes shell arguments containing spaces and apostrophes', () => {
    expect(quoteShellArg("/tmp/Andre's Notes/file.md")).toBe("'/tmp/Andre'\\''s Notes/file.md'");
  });

  it('builds the selected agent command in the file directory', () => {
    expect(buildAgentImproveShellCommand({
      tool: 'claude',
      instruction: 'Improve it.',
      content: 'hello',
      contextKind: 'selection',
      filePath: '/tmp/notes/file.md',
    }, '/tmp/prompt.md')).toBe("cd '/tmp/notes' && claude \"$(cat '/tmp/prompt.md')\"");
  });

  it('escapes the terminal command inside AppleScript', () => {
    const script = buildTerminalAppleScript('codex "hello"');
    expect(script).toContain('tell application "Terminal"');
    expect(script).toContain('do script "codex \\"hello\\""');
  });
});
