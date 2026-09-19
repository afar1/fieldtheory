// @vitest-environment node
import os from 'node:os';
import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ request: vi.fn(), decide: vi.fn(), connect: vi.fn() }));
vi.mock('./voiceCodexRunner', () => ({
  withVoiceCodexClient: (...args: unknown[]) => mocked.connect(...args),
  runVoiceInternalTurn: mocked.decide,
}));
import { routeVoiceRequest, refreshVoiceRouteWorkspace } from './voiceCodexRouter';
const cwd = fs.realpathSync(os.tmpdir());
beforeEach(() => {
  vi.resetAllMocks();
  mocked.connect.mockImplementation((_path: string, callback: (client: unknown) => unknown) => callback({ request: mocked.request }));
  mocked.request.mockImplementation(async (method: string, args: Record<string, unknown>) => {
    if (method === 'thread/read') return { thread: { id: args.threadId, cwd, name: 'Personal - Penguin' } };
    if (method === 'thread/list') return { data: [{ id: 'task', cwd, name: 'Personal - Penguin' }] };
    if (method === 'thread/turns/list') return { data: [{ items: [{ type: 'userMessage', content: [{ type: 'text', text: 'Watercolor preference' }] }] }] };
    return { data: [] };
  });
});

describe('persistent inbox routing decisions', () => {
  it('refreshes a saved route only after checking actual task identity and project scope', async () => {
    const missing = '/missing-voice-inbox-regression';
    const route = { decision: 'continue' as const, threadId: 'known', workspacePath: missing };
    const recovery = { inboxPath: cwd, threadId: 'known', projectlessVoiceTasks: [{ threadId: 'known', workspacePath: missing }] };
    mocked.request.mockResolvedValue({ thread: { id: 'known', cwd: missing, projectId: null } });
    expect(await refreshVoiceRouteWorkspace(route, recovery)).toEqual({ ...route, workspacePath: cwd });
    expect(mocked.request).toHaveBeenCalledWith('thread/read', { threadId: 'known', includeTurns: false });
    expect(mocked.decide).not.toHaveBeenCalled();
    mocked.request.mockResolvedValue({ thread: { id: 'known', cwd: missing, projectId: 'project' } });
    await expect(refreshVoiceRouteWorkspace(route, recovery)).rejects.toMatchObject({ code: 'task_unavailable' });
    mocked.request.mockResolvedValue({ thread: { id: 'other', cwd: missing } });
    await expect(refreshVoiceRouteWorkspace(route, recovery)).rejects.toMatchObject({ code: 'task_unavailable' });
    mocked.request.mockResolvedValue({ thread: { id: 'known', cwd: '/different-missing-path' } });
    await expect(refreshVoiceRouteWorkspace(route, recovery)).rejects.toMatchObject({ code: 'task_unavailable' });
  });

  it.each(['new', 'ask'] as const)('repairs allocated %s tasks using retained original cwd after a second rename', async decision => {
    const original = '/missing-inbox-before-allocation';
    const intermediate = '/missing-inbox-before-second-rename';
    mocked.request.mockResolvedValue({ thread: { id: 'allocated', cwd: original, projectId: null } });
    const route = { decision, workspacePath: intermediate };
    expect(await refreshVoiceRouteWorkspace(route, { threadId: 'allocated', inboxPath: cwd,
      projectlessVoiceTasks: [{ threadId: 'allocated', workspacePath: original }] })).toEqual({ ...route, workspacePath: cwd });
    await expect(refreshVoiceRouteWorkspace(route, { threadId: 'allocated', inboxPath: cwd,
      projectlessVoiceTasks: [{ threadId: 'another', workspacePath: original }] })).rejects.toMatchObject({ code: 'task_unavailable' });
  });

  it('moves a saved projectless creation or clarification without creating another task', async () => {
    for (const decision of ['new', 'ask'] as const) {
      expect(await refreshVoiceRouteWorkspace({ decision, workspacePath: '/missing-voice-inbox-regression' }, { inboxPath: cwd }))
        .toMatchObject({ decision, workspacePath: cwd });
    }
    expect(mocked.request).not.toHaveBeenCalled();
    expect(mocked.decide).not.toHaveBeenCalled();
    await expect(refreshVoiceRouteWorkspace({ decision: 'new', projectId: 'project', workspacePath: '/missing-project-regression' }, { inboxPath: cwd }))
      .rejects.toMatchObject({ code: 'project_unavailable' });
  });

  it('follows repeated inbox renames using confirmed continuation paths', async () => {
    const first = '/missing-inbox-original'; const second = '/missing-inbox-after-first-rename';
    mocked.request.mockImplementation(async (method: string) => method === 'thread/list'
      ? { data: [{ id: 'known', cwd: second, projectId: null }] } : { data: [] });
    mocked.decide.mockResolvedValueOnce({ queries: [], threadIds: ['known'] })
      .mockResolvedValueOnce({ decision: 'continue', threadId: 'known' });
    const route = await routeVoiceRequest({ text: 'Continue the same task.', inboxPath: cwd,
      projectlessVoiceTasks: [{ threadId: 'known', workspacePath: first }, { threadId: 'known', workspacePath: second }] });
    expect(route).toMatchObject({ decision: 'continue', threadId: 'known', workspacePath: cwd });
  });
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
  it.each(['active_writer', 'inbox_receipt_uncertain'])('routes privately with retained history when the inbox cannot accept a turn: %s', async code => {
    mocked.decide.mockResolvedValueOnce({ queries: [], threadIds: ['task'] })
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code }))
      .mockResolvedValueOnce({ decision: 'continue', threadId: 'task' });
    const route = await routeVoiceRequest({ text: 'Make it blue.', inboxPath: cwd,
      inbox: { threadId: 'inbox', receiptKey: 'intake', onThread: () => {} } });
    expect(route.threadId).toBe('task');
    const privateInput = mocked.decide.mock.calls[2][1];
    expect(privateInput.inbox).toBeUndefined();
    expect(privateInput.outputSchema).toBeDefined();
    expect(privateInput.input).toContain('Watercolor preference');
    expect(privateInput.input).toContain('Make it blue.');
    expect(mocked.request.mock.calls.some(([method]) => method === 'thread/queue/add')).toBe(false);
  });

  it('does not hide other inbox failures behind the private routing fallback', async () => {
    mocked.decide.mockResolvedValueOnce({ queries: [], threadIds: [] })
      .mockRejectedValueOnce(Object.assign(new Error('Sign in required'), { code: 'sign_in_required' }));
    await expect(routeVoiceRequest({ text: 'Continue.', inboxPath: cwd,
      inbox: { threadId: 'inbox', receiptKey: 'intake', onThread: () => {} } })).rejects.toMatchObject({ code: 'sign_in_required' });
    expect(mocked.decide).toHaveBeenCalledTimes(2);
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


it('passes custom instructions to the inbox decision instead of the default routing policy', async () => {
  mocked.decide.mockResolvedValueOnce({ queries: [], threadIds: [] })
    .mockResolvedValueOnce({ text: 'Save as context.' })
    .mockResolvedValueOnce({ decision: 'context' });
  const custom = '  Save every recording as context.\nDo not ask questions.  ';
  await routeVoiceRequest({ text: 'A thought', inboxPath: cwd, inboxInstructions: custom,
    inbox: { threadId: 'inbox', receiptKey: 'custom-intake', onThread: () => {} } });
  const instructions = mocked.decide.mock.calls[1][1].instructions;
  expect(instructions.startsWith(custom + '\nRouting evidence')).toBe(true);
  expect(instructions).not.toContain('If essential routing intent is ambiguous');
});


it('recovers a timed-out persistent inbox on a fresh client with retained routing evidence', async () => {
  mocked.decide.mockResolvedValueOnce({ queries: [], threadIds: ['task'] })
    .mockRejectedValueOnce(Object.assign(new Error('inbox stalled'), { code: 'classification_timeout' }))
    .mockResolvedValueOnce({ decision: 'continue', threadId: 'task' });
  const route = await routeVoiceRequest({ text: 'Make it blue.', inboxPath: cwd,
    inbox: { threadId: 'inbox', receiptKey: 'intake', onThread: () => {} } });
  expect(route.threadId).toBe('task');
  expect(mocked.connect).toHaveBeenCalledTimes(2);
  expect(mocked.decide.mock.calls[1][1].timeoutMs).toBe(15_000);
  const recovery = mocked.decide.mock.calls[2][1];
  expect(recovery.inbox).toBeUndefined();
  expect(recovery.input).toContain('Watercolor preference');
  expect(recovery.outputSchema).toBeDefined();
});

it('does not fall back after the request is cancelled during an inbox timeout', async () => {
  const controller = new AbortController();
  mocked.decide.mockResolvedValueOnce({ queries: [], threadIds: [] })
    .mockImplementationOnce(async () => { controller.abort(); throw Object.assign(new Error('timed out'), { code: 'classification_timeout' }); });
  await expect(routeVoiceRequest({ text: 'Make it blue.', inboxPath: cwd, signal: controller.signal,
    inbox: { threadId: 'inbox', receiptKey: 'intake', onThread: () => {} } })).rejects.toMatchObject({ code: 'classification_timeout' });
  expect(mocked.connect).toHaveBeenCalledTimes(1);
});
