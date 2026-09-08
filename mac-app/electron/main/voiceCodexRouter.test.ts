// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readVoiceRouteCatalog, validateVoiceRoute } from './voiceCodexRouter';

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
