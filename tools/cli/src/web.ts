import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { buildIndex, countBookmarks, getBookmarkById, listBookmarks } from './bookmarks-db.js';
import { workspaceRoot } from './paths.js';
import { loadTimelineState } from './timeline-state.js';
import { countTheoryItems, getTheoryItem, listTheoryItems, defaultTheoriesRoot, syncTheoryInbox } from './theories.js';
import { createBookmarkIssue, createTheoryIssue, debateBookmark, debateTheory } from './timeline-actions.js';
import { formatSyncResult, syncBookmarksGraphQL } from './graphql-bookmarks.js';
import { pathExists } from './fs.js';
import { refreshTheoryGitHubState, refreshTheoryGitHubStates } from './github-theory-state.js';

export interface TimelineWebServerOptions {
  cwd?: string;
  host?: string;
  port?: number;
}

type TimelineActionStatus = 'running' | 'done' | 'error';

interface TimelineActionRecord {
  id: string;
  label: string;
  status: TimelineActionStatus;
  command: string;
  logs: string[];
  startedAt: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
}

function cliRoot(cwd = process.cwd()): string {
  return workspaceRoot(cwd);
}

function assetDir(cwd = process.cwd()): string {
  return path.join(cliRoot(cwd), 'src', 'web-app');
}

function repoRoot(cwd = process.cwd()): string {
  return path.resolve(cliRoot(cwd), '..', '..');
}

function safeFileRoots(cwd = process.cwd()): string[] {
  return [
    repoRoot(cwd),
    cliRoot(cwd),
    defaultTheoriesRoot(),
  ].map((entry) => path.resolve(entry));
}

function isSafeFilePath(filePath: string, cwd = process.cwd()): boolean {
  const resolved = path.resolve(filePath);
  return safeFileRoots(cwd).some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
}

function sendJson(res: http.ServerResponse, statusCode: number, value: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value, null, 2));
}

function sendText(res: http.ServerResponse, statusCode: number, value: string, contentType = 'text/plain; charset=utf-8'): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', contentType);
  res.end(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadAsset(name: string, cwd = process.cwd()): Promise<string> {
  return readFile(path.join(assetDir(cwd), name), 'utf8');
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function appendLog(record: TimelineActionRecord, line: string): void {
  if (!line.trim()) return;
  record.logs.push(line);
  if (record.logs.length > 200) {
    record.logs = record.logs.slice(-200);
  }
}

function createActionStore() {
  const actions = new Map<string, TimelineActionRecord>();
  let counter = 0;

  const createAction = (
    label: string,
    command: string,
    runner: (record: TimelineActionRecord) => Promise<unknown>
  ): TimelineActionRecord => {
    const id = `act_${Date.now().toString(36)}_${++counter}`;
    const record: TimelineActionRecord = {
      id,
      label,
      status: 'running',
      command,
      logs: [],
      startedAt: new Date().toISOString(),
    };
    actions.set(id, record);

    void (async () => {
      try {
        const result = await runner(record);
        record.result = result;
        if (result && typeof result === 'object' && 'command' in (result as Record<string, unknown>)) {
          record.command = String((result as Record<string, unknown>).command ?? command);
        }
        record.status = 'done';
      } catch (error) {
        record.status = 'error';
        record.error = error instanceof Error ? error.message : String(error);
        appendLog(record, record.error);
      } finally {
        record.finishedAt = new Date().toISOString();
      }
    })();

    return record;
  };

  const getAction = (id: string): TimelineActionRecord | undefined => actions.get(id);

  return { createAction, getAction };
}

function parseSort(searchParams: URLSearchParams): 'asc' | 'desc' {
  return searchParams.get('sort') === 'asc' ? 'asc' : 'desc';
}

async function hydrateBookmarks(cwd: string, searchParams: URLSearchParams) {
  const limit = Number(searchParams.get('limit') || '30');
  const offset = Number(searchParams.get('offset') || '0');
  const sort = parseSort(searchParams);
  const filters = {
    query: searchParams.get('query') || undefined,
    author: searchParams.get('author') || undefined,
    after: searchParams.get('after') || undefined,
    before: searchParams.get('before') || undefined,
    category: searchParams.get('category') || undefined,
    domain: searchParams.get('domain') || undefined,
    sort,
    limit,
    offset,
  } as const;

  const [items, total] = await Promise.all([
    listBookmarks(filters, cwd),
    countBookmarks(filters, cwd),
  ]);
  const state = (await loadTimelineState(cwd)).bookmarks;
  const hydrated = items.map((item) => ({ ...item, state: state[item.id] ?? {} }));
  return {
    items: hydrated,
    total,
    offset,
    limit,
    sort,
    hasMore: offset + hydrated.length < total,
  };
}

async function hydrateTheories(cwd: string, searchParams: URLSearchParams) {
  const limit = Number(searchParams.get('limit') || '30');
  const offset = Number(searchParams.get('offset') || '0');
  const sort = parseSort(searchParams);
  const filters = {
    query: searchParams.get('query') || undefined,
    repo: searchParams.get('repo') || undefined,
    confidence: searchParams.get('confidence') || undefined,
    type: searchParams.get('type') || undefined,
    sort,
    limit,
    offset,
  } as const;

  const [items, total] = await Promise.all([
    listTheoryItems(filters),
    countTheoryItems(filters),
  ]);
  try {
    await refreshTheoryGitHubStates(items, { cwd });
  } catch {
    // Fall back to cached local state if GitHub sync is unavailable.
  }
  const state = (await loadTimelineState(cwd)).theories;
  const hydrated = items.map((item) => ({ ...item, state: state[item.id] ?? {} }));
  return {
    items: hydrated,
    total,
    offset,
    limit,
    sort,
    hasMore: offset + hydrated.length < total,
  };
}

export async function startTimelineWebServer(options: TimelineWebServerOptions = {}): Promise<http.Server> {
  const cwd = options.cwd ?? process.cwd();
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4310;
  const actionStore = createActionStore();

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? '/', `http://${host}:${port}`);
    try {
      if (req.method === 'GET' && requestUrl.pathname === '/') {
        const html = await loadAsset('index.html', cwd);
        sendText(res, 200, html, 'text/html; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/app.css') {
        sendText(res, 200, await loadAsset('app.css', cwd), 'text/css; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/app.js') {
        sendText(res, 200, await loadAsset('app.js', cwd), 'application/javascript; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/bookmarks') {
        sendJson(res, 200, await hydrateBookmarks(cwd, requestUrl.searchParams));
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname.startsWith('/api/bookmarks/')) {
        const id = decodeURIComponent(requestUrl.pathname.replace('/api/bookmarks/', ''));
        const item = await getBookmarkById(id, cwd);
        if (!item) {
          sendJson(res, 404, { error: `Unknown bookmark: ${id}` });
          return;
        }
        const state = (await loadTimelineState(cwd)).bookmarks[item.id] ?? {};
        sendJson(res, 200, { ...item, state });
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/theories') {
        sendJson(res, 200, await hydrateTheories(cwd, requestUrl.searchParams));
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname.startsWith('/api/theories/')) {
        const id = decodeURIComponent(requestUrl.pathname.replace('/api/theories/', ''));
        const item = await getTheoryItem(id);
        if (!item) {
          sendJson(res, 404, { error: `Unknown theory: ${id}` });
          return;
        }
        try {
          await refreshTheoryGitHubState(item, { cwd });
        } catch {
          // Keep serving cached local state if GitHub sync fails.
        }
        const state = (await loadTimelineState(cwd)).theories[item.id] ?? {};
        sendJson(res, 200, { ...item, state });
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/action') {
        const actionId = requestUrl.searchParams.get('id');
        if (!actionId) {
          sendJson(res, 400, { error: 'Missing action id' });
          return;
        }
        const action = actionStore.getAction(actionId);
        if (!action) {
          sendJson(res, 404, { error: `Unknown action: ${actionId}` });
          return;
        }
        sendJson(res, 200, action);
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/api/file') {
        const filePath = requestUrl.searchParams.get('path');
        if (!filePath || !isSafeFilePath(filePath, cwd) || !(await pathExists(filePath))) {
          sendJson(res, 404, { error: 'File not found.' });
          return;
        }
        sendJson(res, 200, {
          path: filePath,
          content: await readFile(filePath, 'utf8'),
        });
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/view') {
        const filePath = requestUrl.searchParams.get('path');
        if (!filePath || !isSafeFilePath(filePath, cwd) || !(await pathExists(filePath))) {
          sendText(res, 404, 'File not found.');
          return;
        }
        const content = await readFile(filePath, 'utf8');
        const title = path.basename(filePath);
        sendText(
          res,
          200,
          `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; font-family: "Iowan Old Style", Georgia, serif; background: #f6f1e7; color: #1f2630; }
      header { position: sticky; top: 0; background: rgba(246,241,231,0.94); backdrop-filter: blur(18px); border-bottom: 1px solid rgba(31,38,48,0.08); padding: 16px 18px; }
      a { color: #b24a31; text-decoration: none; }
      main { padding: 18px; }
      pre { white-space: pre-wrap; word-break: break-word; font: 14px/1.55 "SFMono-Regular", ui-monospace, monospace; background: rgba(255,255,255,0.65); padding: 18px; border-radius: 18px; border: 1px solid rgba(31,38,48,0.08); }
    </style>
  </head>
  <body>
    <header>
      <strong>${escapeHtml(title)}</strong><br />
      <a href="/">Back to timeline</a>
    </header>
    <main><pre>${escapeHtml(content)}</pre></main>
  </body>
</html>`,
          'text/html; charset=utf-8'
        );
        return;
      }

      if (req.method === 'POST' && requestUrl.pathname === '/api/actions') {
        const body = await readJsonBody(req) as Record<string, unknown>;
        const kind = String(body.kind ?? '');
        const action = String(body.action ?? '');
        const targetId = body.id ? String(body.id) : undefined;

        const record = (() => {
          if (kind === 'bookmarks' && action === 'sync') {
            return actionStore.createAction('Syncing bookmarks', 'ft bookmarks sync', async (next) => {
              const result = await syncBookmarksGraphQL(cwd, {
                incremental: true,
                maxPages: 500,
                delayMs: 600,
                maxMinutes: 30,
                onProgress: (status) => {
                  if (status.page % 5 === 0 || status.done) {
                    appendLog(
                      next,
                      `[sync] page ${status.page} · fetched ${status.totalFetched} · new ${status.newAdded}${status.done ? ` · ${status.stopReason}` : ''}`
                    );
                  }
                },
              });
              appendLog(next, formatSyncResult(result));
              let index: { dbPath: string; recordCount: number } | undefined;
              if (result.added > 0) {
                appendLog(next, 'Rebuilding search index...');
                index = await buildIndex(cwd);
                appendLog(next, `Index: ${index.dbPath} (${index.recordCount} records)`);
              }
              return {
                command: 'ft bookmarks sync',
                sync: result,
                index,
              };
            });
          }

          if (kind === 'bookmark' && targetId && action === 'issue') {
            return actionStore.createAction(`Creating issue for bookmark ${targetId}`, `ft bookmarks issue ${targetId}`, async (next) =>
              createBookmarkIssue(targetId, { cwd, onLog: (line) => appendLog(next, line) })
            );
          }

          if (kind === 'bookmark' && targetId && action === 'debate') {
            return actionStore.createAction(`Debating bookmark ${targetId}`, `ft bookmarks debate ${targetId}`, async (next) =>
              debateBookmark(targetId, { cwd, onLog: (line) => appendLog(next, line) })
            );
          }

          if (kind === 'theory' && targetId && action === 'issue') {
            return actionStore.createAction(`Creating issue for ${targetId}`, `ft theories issue ${targetId}`, async (next) =>
              createTheoryIssue(targetId, { cwd, onLog: (line) => appendLog(next, line) })
            );
          }

          if (kind === 'theory' && targetId && action === 'debate') {
            return actionStore.createAction(`Debating ${targetId}`, `ft theories debate ${targetId}`, async (next) =>
              debateTheory(targetId, { cwd, onLog: (line) => appendLog(next, line) })
            );
          }

          if (kind === 'theories' && action === 'sync') {
            return actionStore.createAction('Syncing FT findings', 'ft theories sync', async (next) => {
              appendLog(next, 'Pulling sent FT digests from AgentMail...');
              const result = await syncTheoryInbox(cwd);
              appendLog(next, `Findings: ${result.findingCount}`);
              appendLog(next, `New messages: ${result.newMessages}`);
              appendLog(next, `Added findings: ${result.addedFindings}`);
              appendLog(next, `Stop: ${result.stopReason}`);
              return {
                command: 'ft theories sync',
                sync: result,
              };
            });
          }

          return null;
        })();

        if (!record) {
          sendJson(res, 400, { error: `Unsupported action: ${kind}/${action}` });
          return;
        }

        sendJson(res, 202, record);
        return;
      }

      sendText(res, 404, 'Not found.');
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  return server;
}
