// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readVoiceRouteCatalog, validateVoiceRoute, readVoiceThreadEvidence, inspectVoiceRouteCandidates } from './voiceCodexRouter';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));
function folder() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-route-'));
  directories.push(directory);
  return fs.realpathSync(directory);
}

describe('Codex-owned Voice routing', () => {
  it('chooses an existing task or registered project rather than forcing Inbox as its workspace', () => {
    const inbox = folder(); const project = folder();
    const catalog = { projects: [{ id: 'project-1', name: 'Field Theory', workspacePath: project }],
      tasks: [{ id: 'task-1', name: 'Field Theory - Drawing', workspacePath: project, projectId: 'project-1' }] };
    expect(validateVoiceRoute({ decision: 'continue', threadId: 'task-1' }, catalog, inbox))
      .toMatchObject({ decision: 'continue', threadId: 'task-1', workspacePath: project });
    expect(validateVoiceRoute({ decision: 'new', projectId: 'project-1', threadId: null, title: 'Field Theory - Fix Voice' }, catalog, inbox))
      .toMatchObject({ decision: 'new', projectId: 'project-1', workspacePath: project });
    expect(validateVoiceRoute({ decision: 'new', projectId: null, threadId: null }, catalog, inbox).workspacePath).toBe(inbox);
  });

  it('keeps context unsent and rejects invented destinations and arbitrary filesystem paths', () => {
    const inbox = folder(); const catalog = { projects: [], tasks: [] };
    expect(validateVoiceRoute({ decision: 'context', workspacePath: '/etc' }, catalog, inbox))
      .toEqual({ decision: 'context', workspacePath: inbox });
    expect(() => validateVoiceRoute({ decision: 'continue', threadId: 'invented', workspacePath: '/etc' }, catalog, inbox)).toThrow(/unavailable task/);
    expect(() => validateVoiceRoute({ decision: 'new', projectId: '/etc', threadId: null }, catalog, inbox)).toThrow(/unavailable project/);
    expect(() => validateVoiceRoute({ decision: 'new', projectId: null, threadId: 'invented' }, catalog, inbox)).toThrow(/unconfirmed task/);
    expect(() => validateVoiceRoute({ decision: 'ask', projectId: null, threadId: null, question: null }, catalog, inbox)).toThrow(/routing question/);
  });

  it('reads bounded catalog pages and excludes ephemeral tasks and unavailable roots', async () => {
    const project = folder();
    const request = vi.fn(async (method: string, args: Record<string, unknown>) => {
      if (method === 'project/list') return { data: [{ id: 'project-1', name: 'Field Theory', roots: [{ path: project }] },
        { id: 'missing', name: 'Missing', roots: [{ path: '/does-not-exist-voice-test' }] }], nextCursor: null };
      return args.cursor ? { data: [{ id: 'older', name: 'Existing', cwd: project }], nextCursor: null }
        : { data: [{ id: 'hidden', ephemeral: true, cwd: project }, { id: 'ambient', threadSource: 'ambient_suggestions', cwd: project },
          { id: 'active', name: 'Current', cwd: project, status: { type: 'active' } }], nextCursor: 'page-2' };
    });
    const catalog = await readVoiceRouteCatalog({ request });
    expect(catalog.projects.map((candidate) => candidate.id)).toEqual(['project-1']);
    expect(catalog.tasks.map((candidate) => candidate.id)).toEqual(['active', 'older']);
    expect(catalog.tasks[0].active).toBe(true);
    expect(request.mock.calls.filter(([method]) => method === 'thread/list')).toHaveLength(2);
  });
});

describe('routing history evidence', () => {
  it('keeps recent conversation text within budget and excludes tool and image payloads', async () => {
    const request = vi.fn(async () => ({ nextCursor: 'older', data: [
      { items: [{ type: 'userMessage', content: [{ type: 'text', text: 'Newest question' }, { type: 'image', url: 'secret-image' }] },
        { type: 'commandExecution', aggregatedOutput: 'secret-output' }, { type: 'agentMessage', text: 'Newest answer' }] },
      ...Array.from({ length: 5 }, () => ({ items: [{ type: 'agentMessage', text: 'old'.repeat(4000) }] })),
    ] }));
    const evidence = await readVoiceThreadEvidence({ request }, 'task');
    expect(evidence.messages.slice(-2).map(message => message.text)).toEqual(['Newest question', 'Newest answer']);
    expect(evidence.messages.reduce((sum, message) => sum + message.text.length, 0)).toBeLessThanOrEqual(12000);
    expect(evidence.truncated).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain('secret');
  });

  it('finds older tasks and only reads verified bounded candidates', async () => {
    const cwd = folder();
    const request = vi.fn(async (method: string) => method === 'thread/search' ? { data: [
      { thread: { id: 'found', name: 'Old penguin', cwd }, snippet: 'Old watercolor request' }, { thread: { id: 'ephemeral', cwd, ephemeral: true }, snippet: '' },
      { thread: { id: 'inbox', cwd, threadSource: 'field-theory-voice-inbox' }, snippet: 'Inbox receipt' },
    ] } : { data: [{ items: [{ type: 'agentMessage', text: 'A penguin drawing' }] }] });
    const catalog = { projects: [], tasks: [] };
    const evidence = await inspectVoiceRouteCandidates({ request }, { queries: ['penguin'], threadIds: [] }, catalog);
    expect(evidence.map(item => item.threadId)).toEqual(['found']);
    expect(request).toHaveBeenCalledWith('thread/search', expect.objectContaining({ searchTerm: 'penguin', limit: 10 }));
    expect(evidence[0].matchedExcerpt).toBe('Old watercolor request');
    await expect(inspectVoiceRouteCandidates({ request }, { threadIds: ['invented'] }, catalog)).rejects.toThrow(/unavailable/);
  });
});
