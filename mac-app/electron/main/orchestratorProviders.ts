import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectVoiceCodexRuntime, runVoiceRequest, withVoiceCodexClient } from './voiceCodexRunner';
export interface ProviderCapability {
  default_model?: string;
  id: string;
  label: string;
  available: boolean;
  signed_in: boolean | null;
  models: Array<{
    id: string;
    label: string;
  }>;
  model_discovery: string;
  thread_integration: string;
  message: string;
}
export interface ProviderRun {
  text: string;
  workspace: string;
  model?: string | null;
  threadId?: string;
  dispatchKey: string;
  signal: AbortSignal;
  instructions: string;
  onSession: (threadId: string) => Promise<void>;
  onDispatch: () => Promise<void>;
}
export interface ProviderResult {
  status: 'completed' | 'needs_user' | 'failed';
  text: string;
  threadId?: string;
  turnId?: string;
  errorCode?: string;
}
export interface ProviderAdapter {
  discover(workspace: string): Promise<ProviderCapability>;
  run(input: ProviderRun): Promise<ProviderResult>;
}
const object = (x: unknown): Record<string, unknown> =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
function binary(name: string): string | undefined {
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(os.homedir(), '.local/bin'),
    ...(process.env.PATH ?? '').split(path.delimiter),
  ]
    .filter((p) => path.isAbsolute(p))
    .map((p) => path.join(p, name))
    .find((p) => {
      try {
        accessSync(p, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}
function command(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(file, args, { timeout: 15000, maxBuffer: 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    ),
  );
}
export class CodexProvider implements ProviderAdapter {
  async discover(workspace: string): Promise<ProviderCapability> {
    const runtime = await inspectVoiceCodexRuntime();
    const cap: ProviderCapability = {
      id: 'codex',
      label: 'Codex',
      available: runtime.status !== 'not_installed',
      signed_in: runtime.status === 'ready' ? true : runtime.status === 'sign_in_required' ? false : null,
      models: [],
      model_discovery: 'unavailable',
      thread_integration: 'codex-app-server',
      message: runtime.message,
    };
    if (cap.signed_in)
      try {
        cap.models = await withVoiceCodexClient(workspace, async (client) => {
          const models: ProviderCapability['models'] = [];
          let cursor: string | undefined;
          for (let page = 0; page < 10; page++) {
            const response = await client.request('model/list', {
              limit: 100,
              ...(cursor ? { cursor } : {}),
            });
            for (const raw of Array.isArray(response.data) ? response.data : []) {
              const item = object(raw);
              if (item.isDefault === true && typeof item.id === 'string') cap.default_model = item.id;
              if (typeof item.id === 'string' && item.hidden !== true)
                models.push({
                  id: item.id,
                  label: typeof item.displayName === 'string' ? item.displayName : item.id,
                });
            }
            cursor = typeof response.nextCursor === 'string' ? response.nextCursor : undefined;
            if (!cursor) break;
          }
          return models;
        });
        cap.model_discovery = 'live';
      } catch {
        cap.message = 'Signed in. Model discovery unavailable; provider default only.';
      }
    return cap;
  }
  async run(input: ProviderRun): Promise<ProviderResult> {
    const result = await runVoiceRequest(
      {
        text: input.text,
        workspacePath: input.workspace,
        model: input.model ?? undefined,
        threadId: input.threadId,
        dispatchKey: input.dispatchKey,
        title: 'Field Theory - Orchestrator',
        sandboxMode: 'read-only',
        additionalInstructions: input.instructions,
        classifyOutcome: false,
        signal: input.signal,
        onThreadStarted: input.onSession,
        onBeforeDispatch: input.onDispatch,
      },
      { turnTimeoutMs: 5 * 60000 },
    );
    return {
      status:
        result.status === 'completed' || result.status === 'context'
          ? 'completed'
          : result.status === 'needs_user'
            ? 'needs_user'
            : 'failed',
      text: result.finalResponse || result.question || result.summary,
      threadId: result.threadId,
      turnId: result.turnId,
      errorCode: result.errorCode,
    };
  }
}
export class ClaudeProvider implements ProviderAdapter {
  async discover(): Promise<ProviderCapability> {
    const file = binary('claude');
    const cap: ProviderCapability = {
      id: 'claude',
      label: 'Claude Code',
      available: !!file,
      signed_in: null,
      models: [],
      model_discovery: 'provider-default-only',
      thread_integration: 'claude-code-session',
      message: file ? 'Authentication not verified.' : 'Claude Code is not installed.',
    };
    if (file)
      try {
        const auth = object(JSON.parse(await command(file, ['auth', 'status'])));
        cap.signed_in = auth.loggedIn === true;
        cap.message = cap.signed_in
          ? 'Resumable Claude Code sessions. Consumer Claude app integration is unavailable.'
          : 'Sign in to Claude Code on this Mac.';
      } catch {
        cap.signed_in = false;
        cap.message = 'Claude Code authentication is unavailable.';
      }
    return cap;
  }
  async run(input: ProviderRun): Promise<ProviderResult> {
    const file = binary('claude');
    if (!file) return { status: 'failed', text: 'Claude Code is not installed.', errorCode: 'not_installed' };
    const sessionId = input.threadId ?? randomUUID();
    await input.onSession(sessionId);
    await input.onDispatch();
    return new Promise((resolve) => {
      // No shell, no permission bypass, no GUI and no stdin approval prompt.
      const args = [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'dontAsk',
        '--tools',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--disable-slash-commands',
        '--append-system-prompt',
        input.instructions,
        ...(input.threadId ? ['--resume', sessionId] : ['--session-id', sessionId]),
        ...(input.model ? ['--model', input.model] : []),
      ];
      const child = spawn(file, args, {
        cwd: input.workspace,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
      let buffer = '';
      let text = '';
      let failed = false;
      let settled = false;
      let bytes = 0;
      const finish = (status: ProviderResult['status'], errorCode?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.signal.removeEventListener('abort', abort);
        resolve({
          status,
          text:
            status === 'completed'
              ? text
              : 'Claude Code did not complete. Review its session before retrying.',
          threadId: sessionId,
          ...(status === 'completed' ? {} : { errorCode }),
        });
      };
      const abort = () => {
        child.kill('SIGTERM');
        finish('needs_user', 'interrupted');
        setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
        }, 2000).unref();
      };
      const timer = setTimeout(abort, 5 * 60000);
      input.signal.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) {
          abort();
          return;
        }
        buffer += chunk.toString('utf8');
        let line: number;
        while ((line = buffer.indexOf('\n')) >= 0) {
          const raw = buffer.slice(0, line);
          buffer = buffer.slice(line + 1);
          try {
            const event = object(JSON.parse(raw));
            if (event.type === 'result') {
              failed = event.is_error === true;
              text = typeof event.result === 'string' ? event.result : '';
            }
          } catch {
            /* Diagnostics are not conversation messages. */
          }
        }
      });
      child.stderr.on('data', () => {});
      child.on('error', () => finish('failed', 'startup_failed'));
      child.on('close', (code) =>
        finish(code === 0 && !failed && !!text ? 'completed' : 'failed', 'provider_failed'),
      );
      child.stdin.on('error', () => {});
      child.stdin.end(input.text);
      if (input.signal.aborted) abort();
    });
  }
}
export function unsupported(id: string, label: string, message: string): ProviderCapability {
  return {
    id,
    label,
    available: false,
    signed_in: null,
    models: [],
    model_discovery: 'unsupported',
    thread_integration: 'unsupported',
    message,
  };
}
export const defaultAdapters: Record<string, ProviderAdapter> = {
  codex: new CodexProvider(),
  claude: new ClaudeProvider(),
};
export async function discoverProviders(
  workspace: string,
  adapters = defaultAdapters,
): Promise<ProviderCapability[]> {
  const settled = await Promise.allSettled(
    Object.values(adapters).map((adapter) => adapter.discover(workspace)),
  );
  return [
    ...settled.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value
        : unsupported(
            Object.keys(adapters)[index],
            Object.keys(adapters)[index],
            'Capability discovery failed.',
          ),
    ),
    unsupported(
      'grok',
      'Grok Bot',
      'No authenticated Grok Bot session adapter is configured. Model API access would not imply native Bot threads.',
    ),
    unsupported(
      'muse',
      'Muse',
      'No authenticated Muse Code/MSP adapter is configured. Consumer Muse threads are not supported.',
    ),
  ];
}
