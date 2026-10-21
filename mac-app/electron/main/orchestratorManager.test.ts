import { afterEach, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OrchestratorManager, parsePlan } from './orchestratorManager';
import type { ProviderAdapter, ProviderCapability } from './orchestratorProviders';
import type { SupabaseClient } from '@supabase/supabase-js';
const cap: ProviderCapability = {
  default_model: 'discovered',
  id: 'codex',
  label: 'Codex',
  available: true,
  signed_in: true,
  models: [{ id: 'discovered', label: 'Discovered' }],
  model_discovery: 'live',
  thread_integration: 'codex-app-server',
  message: '',
};
const managers: OrchestratorManager[] = [];
const roots: string[] = [];
afterEach(() => {
  managers.forEach((m) => m.dispose());
  roots.forEach((p) => fs.rmSync(p, { recursive: true, force: true }));
  vi.useRealTimers();
});
test('rejects unauthenticated, invented-model, and unbounded delegations', () => {
  for (const d of [
    [{ provider: 'grok', task: 'Review' }],
    [{ provider: 'codex', model: 'invented', task: 'Review' }],
    Array(5).fill({ provider: 'codex', task: 'Review' }),
  ])
    expect(() => parsePlan(JSON.stringify({ delegations: d }), [cap])).toThrow();
  expect(parsePlan('{"answer":"Answer","delegations":[]}', [cap]).answer).toBe('Answer');
});
function setup(failPublish = false) {
  vi.useFakeTimers();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-orchestrator-test-'));
  roots.push(root);
  const events: Array<Record<string, unknown>> = [];
  let claims = 0;
  let completed = 0;
  let fail = failPublish;
  const table = () => {
    const result = { error: null, data: [] };
    const q: any = { abortSignal: () => Promise.resolve(result) };
    for (const key of ['upsert', 'update', 'select', 'eq', 'order', 'limit']) q[key] = () => q;
    return q;
  };
  const client = {
    from: table,
    rpc: (name: string, args: any) => ({
      abortSignal: async () => {
        if (name === 'ft_agent_claim')
          return {
            error: null,
            data:
              claims++ === 0
                ? {
                    command: {
                      id: 'command',
                      conversation_id: 'conversation',
                      text: 'Explain',
                      lease_token: 'lease',
                    },
                    conversation: { id: 'conversation', provider: 'codex', model: null },
                  }
                : null,
          };
        if (fail && args.p_events?.some((e: any) => e.kind === 'assistant')) {
          fail = false;
          return { error: { message: 'offline' } };
        }
        events.push(...(args.p_events ?? []));
        if (args.p_status) completed++;
        return { error: null, data: true };
      },
    }),
  } as unknown as SupabaseClient;
  let calls = 0;
  const adapter: ProviderAdapter = {
    discover: async () => cap,
    run: async (input) => {
      calls++;
      expect(input.model).toBe('discovered');
      await input.onSession(input.threadId ?? 'native-session');
      await input.onDispatch();
      if (calls === 1)
        return {
          status: 'completed',
          threadId: 'native-session',
          text: '{"delegations":[{"provider":"codex","task":"Review evidence"}]}',
        };
      if (calls === 2)
        return { status: 'completed', threadId: 'delegate-session', text: 'Delegate evidence' };
      expect(input.threadId).toBe('native-session');
      expect(input.text).toContain('Delegate evidence');
      return { status: 'completed', threadId: 'native-session', text: 'Final answer' };
    },
  };
  const manager = new OrchestratorManager(
    { getSession: () => ({ user: { id: 'owner' } }), getSupabaseClient: () => client },
    root,
    { codex: adapter },
  );
  managers.push(manager);
  manager.update({
    settings: { enabled: true, workspacePath: root },
    status: 'ready',
    codex: { available: true, signedIn: true },
  });
  return {
    events,
    restart: () => {
      manager.dispose();
      const resumed = new OrchestratorManager(
        { getSession: () => ({ user: { id: 'owner' } }), getSupabaseClient: () => client },
        root,
        { codex: adapter },
      );
      managers.push(resumed);
      resumed.update({
        settings: { enabled: true, workspacePath: root },
        status: 'ready',
        codex: { available: true, signedIn: true },
      });
    },
    get calls() {
      return calls;
    },
    get completed() {
      return completed;
    },
  };
}
test('returns delegate evidence to the selected session and publishes its answer', async () => {
  const state = setup();
  await vi.advanceTimersByTimeAsync(1);
  expect(state.calls).toBe(3);
  expect(state.completed).toBe(1);
  expect(state.events.some((e) => e.kind === 'delegation' && e.text === 'Delegate evidence')).toBe(true);
  expect(state.events.some((e) => e.kind === 'assistant' && e.text === 'Final answer')).toBe(true);
});
test('delivers a persisted result after restart without executing providers twice', async () => {
  const state = setup(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(state.calls).toBe(3);
  expect(state.completed).toBe(0);
  state.restart();
  await vi.advanceTimersByTimeAsync(1);
  expect(state.calls).toBe(3);
  expect(state.completed).toBe(1);
  expect(state.events.filter((e) => e.kind === 'assistant')).toHaveLength(1);
});
