// @vitest-environment node
import os from 'node:os';
import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ request: vi.fn(), decide: vi.fn() }));
vi.mock('./voiceCodexRunner', () => ({
  withVoiceCodexClient: (_path: string, callback: (client: unknown) => unknown) => callback({ request: mocked.request }),
  runVoiceInternalTurn: mocked.decide,
}));
import { routeVoiceRequest } from './voiceCodexRouter';
const cwd = fs.realpathSync(os.tmpdir());
beforeEach(() => {
  vi.resetAllMocks();
  mocked.request.mockImplementation(async (method: string, args: Record<string, unknown>) => {
    if (method === 'thread/read') return { thread: { id: args.threadId, cwd, name: 'Personal - Penguin' } };
    if (method === 'thread/list') return { data: [{ id: 'task', cwd, name: 'Personal - Penguin' }] };
    if (method === 'thread/turns/list') return { data: [{ items: [{ type: 'userMessage', content: [{ type: 'text', text: 'Watercolor preference' }] }] }] };
    return { data: [] };
  });
});

describe('persistent inbox routing decisions', () => {
  it('supplies real history to the inbox and extracts its plain-English routing decision', async () => {
    mocked.decide.mockResolvedValueOnce({ queries: [], threadIds: ['task'] })
      .mockResolvedValueOnce({ text: 'Received. I will continue [Personal - Penguin](codex://threads/task).' })
      .mockResolvedValueOnce({ decision: 'continue', threadId: 'task' });
    const route = await routeVoiceRequest({ text: 'Make that penguin blue.', inboxPath: cwd,
      inbox: { threadId: 'inbox', receiptKey: 'intake', onThread: () => {} } });
    expect(route.threadId).toBe('task');
    const inboxInput = mocked.decide.mock.calls[1][1];
    expect(inboxInput.inbox.threadId).toBe('inbox');
    expect(inboxInput.input).toBe('Make that penguin blue.');
    expect(inboxInput.instructions).toContain('Watercolor preference');
    expect(inboxInput.outputSchema).toBeUndefined();
  });
  it('honors a hold-off revision even when it already has a durable task owner', async () => {
    mocked.decide.mockResolvedValueOnce({ queries: [], threadIds: [] }).mockResolvedValueOnce({ decision: 'context' });
    expect((await routeVoiceRequest({ text: 'Hold off, just context.', inboxPath: cwd, previousThreadId: 'older-owner' })).decision).toBe('context');
  });
  it('rejects reassignment of an existing transcript owner', async () => {
    mocked.decide.mockResolvedValueOnce({ queries: [], threadIds: [] }).mockResolvedValueOnce({ decision: 'continue', threadId: 'task' });
    await expect(routeVoiceRequest({ text: 'Add blue.', inboxPath: cwd, previousThreadId: 'older-owner' })).rejects.toThrow(/durable voice task owner/);
  });
});
