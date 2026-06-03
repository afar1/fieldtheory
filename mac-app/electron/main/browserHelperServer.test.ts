import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserHelperDocumentService } from './browserHelperDocumentService';
import { BrowserHelperServer } from './browserHelperServer';

const tempDirs: string[] = [];
const servers: BrowserHelperServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.stop();
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-browser-helper-server-'));
  tempDirs.push(dir);
  return dir;
}

type TestResponse = {
  status: number;
  body: any;
  rawBody: string;
  headers: http.IncomingHttpHeaders;
};

async function request(url: string, options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = options.body === undefined ? null : JSON.stringify(options.body);
    const req = http.request({
      method: options.method ?? 'GET',
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        ...(options.headers ?? {}),
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString() } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve({
          status: res.statusCode ?? 0,
          body: parseJsonBody(raw),
          rawBody: raw,
          headers: res.headers,
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('BrowserHelperServer', () => {
  async function startServer() {
    const root = makeTempDir();
    const staticDir = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    fs.mkdirSync(path.join(staticDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(staticDir, 'browser-library.html'), '<!doctype html><script src="/assets/app.js"></script>');
    fs.writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'window.loaded = true;');
    fs.writeFileSync(path.join(staticDir, 'field-theory-icon-black.png'), 'icon');
    fs.writeFileSync(path.join(staticDir, 'fieldtheory-icon.png'), 'dark icon');
    fs.writeFileSync(path.join(staticDir, 'fieldtheory-logo-black.png'), 'logo');
    const currentReports: unknown[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      staticDir,
      reportCurrentDocument: (context) => currentReports.push(context),
      token: 'test-token',
    });
    servers.push(server);
    const address = await server.start();
    return { root, address, currentReports };
  }

  it('requires the browser helper token', async () => {
    const { address } = await startServer();

    const response = await request(`http://${address.host}:${address.port}/health`);

    expect(response.status).toBe(401);
  });

  it('rejects unexpected origins', async () => {
    const { address } = await startServer();

    const response = await request(`http://${address.host}:${address.port}/health?token=test-token`, {
      headers: { Origin: 'https://example.com' },
    });

    expect(response.status).toBe(403);
  });

  it('allows localhost preflight without exposing data', async () => {
    const { address } = await startServer();

    const response = await request(`http://${address.host}:${address.port}/doc`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    });

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it('bridges native theme state and change events', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    let isDark = false;
    let server: BrowserHelperServer;
    server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getTheme: () => isDark,
        setTheme: (nextIsDark) => {
          isDark = nextIsDark;
          server.emitNativeEvent({ type: 'theme:changed', isDark });
        },
      },
    });
    servers.push(server);
    const address = await server.start();
    const eventPromise = readFirstEvent(`http://${address.host}:${address.port}/native/events?token=test-token`, 'theme:changed');

    const initial = await request(`http://${address.host}:${address.port}/native/theme?token=test-token`);
    const updated = await request(`http://${address.host}:${address.port}/native/theme`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { isDark: true },
    });

    expect(initial.body.isDark).toBe(false);
    expect(updated.body.isDark).toBe(true);
    await expect(eventPromise).resolves.toContain('"isDark":true');
  });

  it('serves the native auth session for browser-hosted shared Library surfaces', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const session = {
      user: {
        id: 'user-1',
        email: 'river@example.com',
      },
      access_token: 'token-1',
    };
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getAuthSession: () => session,
        getAuthCallsign: () => 'river',
      },
    });
    servers.push(server);
    const address = await server.start();

    const response = await request(`http://${address.host}:${address.port}/native/auth/session?token=test-token`);
    const callsignResponse = await request(`http://${address.host}:${address.port}/native/auth/callsign?token=test-token`);

    expect(response.status).toBe(200);
    expect(response.body.session).toEqual(session);
    expect(callsignResponse.status).toBe(200);
    expect(callsignResponse.body.callsign).toBe('river');
  });

  it('bridges native metrics and quota state', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getMetrics: () => ({ words_transcribed: 1234, words_improved: 56 }),
        fetchMetricsFromSupabase: async () => true,
        getQuotas: () => ({ tier: 'pro', priorityMic: { allowed: true } }),
      },
    });
    servers.push(server);
    const address = await server.start();

    const metrics = await request(`http://${address.host}:${address.port}/native/metrics?token=test-token`);
    const refreshed = await request(`http://${address.host}:${address.port}/native/metrics/fetch-from-supabase?token=test-token`, {
      method: 'POST',
    });
    const quotas = await request(`http://${address.host}:${address.port}/native/quota/quotas?token=test-token`);

    expect(metrics.body).toEqual({ ok: true, metrics: { words_transcribed: 1234, words_improved: 56 } });
    expect(refreshed.body).toEqual({ ok: true, success: true });
    expect(quotas.body).toEqual({ ok: true, quotas: { tier: 'pro', priorityMic: { allowed: true } } });
  });

  it('bridges native updater state, actions, and events', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    let checks = 0;
    let server: BrowserHelperServer;
    server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getAppVersion: () => '25.6.1',
        isUpdaterEnabled: () => true,
        getUpdaterStatus: () => ({ status: 'available', version: '25.6.2' }),
        checkForUpdates: () => {
          checks += 1;
          server.emitNativeEvent({ type: 'updater:updateAvailable', info: { version: '25.6.2' } });
          return { ok: true };
        },
      },
    });
    servers.push(server);
    const address = await server.start();
    const eventPromise = readFirstEvent(`http://${address.host}:${address.port}/native/events?token=test-token`, 'updater:updateAvailable');

    const version = await request(`http://${address.host}:${address.port}/native/app/version?token=test-token`);
    const enabled = await request(`http://${address.host}:${address.port}/native/updater/enabled?token=test-token`);
    const status = await request(`http://${address.host}:${address.port}/native/updater/status?token=test-token`);
    const check = await request(`http://${address.host}:${address.port}/native/updater/check`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });

    expect(version.body.version).toBe('25.6.1');
    expect(enabled.body.enabled).toBe(true);
    expect(status.body.status).toEqual({ status: 'available', version: '25.6.2' });
    expect(check.body.result).toEqual({ ok: true });
    expect(checks).toBe(1);
    await expect(eventPromise).resolves.toContain('"version":"25.6.2"');
  });

  it('does not expose terminal, share, or sync endpoints', async () => {
    const { address } = await startServer();

    const terminal = await request(`http://${address.host}:${address.port}/terminal?token=test-token`);
    const share = await request(`http://${address.host}:${address.port}/share?token=test-token`);
    const sync = await request(`http://${address.host}:${address.port}/sync?token=test-token`);

    expect(terminal.status).toBe(404);
    expect(share.status).toBe(404);
    expect(sync.status).toBe(404);
  });

  it('serves the browser UI and assets from the narrow static surface', async () => {
    const { address } = await startServer();

    const html = await request(`http://${address.host}:${address.port}/?token=test-token`);
    const asset = await request(`http://${address.host}:${address.port}/assets/app.js?token=test-token`);
    const icon = await request(`http://${address.host}:${address.port}/field-theory-icon-black.png?token=test-token`);
    const darkIcon = await request(`http://${address.host}:${address.port}/fieldtheory-icon.png?token=test-token`);
    const logo = await request(`http://${address.host}:${address.port}/fieldtheory-logo-black.png?token=test-token`);
    const traversal = await request(`http://${address.host}:${address.port}/assets/../browserHelperServer.ts?token=test-token`);

    expect(html.status).toBe(200);
    expect(html.rawBody).toContain('app.js');
    expect(asset.status).toBe(200);
    expect(asset.rawBody).toContain('window.loaded');
    expect(icon.status).toBe(200);
    expect(icon.rawBody).toContain('icon');
    expect(darkIcon.status).toBe(200);
    expect(darkIcon.rawBody).toContain('dark icon');
    expect(logo.status).toBe(200);
    expect(logo.rawBody).toContain('logo');
    expect(traversal.status).toBe(404);
  });

  it('allows built browser assets to load with the helper auth cookie set by html', async () => {
    const { address } = await startServer();

    const html = await request(`http://${address.host}:${address.port}/?token=test-token`);
    const cookie = Array.isArray(html.headers['set-cookie'])
      ? html.headers['set-cookie'][0]
      : html.headers['set-cookie'];
    const asset = await request(`http://${address.host}:${address.port}/assets/app.js`, {
      headers: cookie ? { Cookie: cookie.split(';')[0] } : {},
    });

    expect(cookie).toContain('ft_browser_token=test-token');
    expect(asset.status).toBe(200);
    expect(asset.rawBody).toContain('window.loaded');
  });

  it('reports current document and selection through the narrow current route', async () => {
    const { address, currentReports } = await startServer();

    const response = await request(`http://${address.host}:${address.port}/current`, {
      method: 'POST',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
      },
      body: {
        rootId: 'root-1',
        relPath: 'Plan.md',
        selectionStart: 2,
        selectionEnd: 6,
        selectionText: 'Plan',
      },
    });

    expect(response.status).toBe(200);
    expect(currentReports).toEqual([
      expect.objectContaining({
        type: 'wiki',
        relPath: 'Plan.md',
        title: 'Plan',
        selectionStart: 2,
        selectionEnd: 6,
        selectionText: 'Plan',
      }),
    ]);
  });

  it('reports native current document context for browser-hosted wiki pages', async () => {
    const { address, currentReports } = await startServer();

    const response = await request(`http://${address.host}:${address.port}/native/current`, {
      method: 'POST',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
      },
      body: {
        type: 'wiki',
        relPath: 'Plan',
        selectionStart: 2,
        selectionEnd: 6,
        selectionText: 'Plan',
      },
    });

    expect(response.status).toBe(200);
    expect(currentReports).toEqual([
      expect.objectContaining({
        type: 'wiki',
        relPath: 'Plan',
        title: 'Plan',
        selectionStart: 2,
        selectionEnd: 6,
        selectionText: 'Plan',
      }),
    ]);
  });

  it('reports the browser client id with native current document context', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const currentReports: Array<{ context: unknown; clientId?: string | null }> = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      reportCurrentDocument: (context, clientId) => currentReports.push({ context, clientId }),
    });
    servers.push(server);
    const address = await server.start();

    const response = await request(`http://${address.host}:${address.port}/native/current`, {
      method: 'POST',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
        'X-FieldTheory-Browser-Client': 'client-one',
      },
      body: {
        type: 'wiki',
        relPath: 'Plan',
      },
    });

    expect(response.status).toBe(200);
    expect(currentReports).toEqual([
      {
        clientId: 'client-one',
        context: expect.objectContaining({
          type: 'wiki',
          relPath: 'Plan',
          title: 'Plan',
        }),
      },
    ]);
  });

  it('preserves root-relative identity for browser-hosted external Library files', async () => {
    const root = makeTempDir();
    const extraRoot = makeTempDir();
    fs.mkdirSync(path.join(extraRoot, 'Nested'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    fs.writeFileSync(path.join(extraRoot, 'Nested', 'External.md'), '# External\n');
    const currentReports: unknown[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root, extraRoot]),
      token: 'test-token',
      reportCurrentDocument: (context) => currentReports.push(context),
    });
    servers.push(server);
    const address = await server.start();

    const response = await request(`http://${address.host}:${address.port}/native/current`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: {
        type: 'external',
        rootPath: extraRoot,
        relPath: 'Nested/External',
        filePath: path.join(extraRoot, 'Nested', 'External.md'),
        title: 'External',
      },
    });

    expect(response.status).toBe(200);
    expect(currentReports).toEqual([
      expect.objectContaining({
        type: 'external',
        rootPath: extraRoot,
        relPath: 'Nested/External',
        filePath: path.join(extraRoot, 'Nested', 'External.md'),
        title: 'External',
      }),
    ]);
  });

  it('reports active context for browser-hosted artifact readings through the native Librarian bridge', async () => {
    const root = makeTempDir();
    const artifactDir = makeTempDir();
    const artifactPath = path.join(artifactDir, 'Artifact.md');
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    fs.writeFileSync(artifactPath, '# Artifact\n');
    const currentReports: unknown[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getReading: (filePath) => filePath === artifactPath
          ? {
            path: artifactPath,
            title: 'Artifact',
            content: '# Artifact\n',
            context: null,
            readingTime: null,
            modelSignature: null,
            createdAt: 1,
            mtime: 2,
            documentVersion: { mtimeMs: 2, size: 11, sha256: 'artifact-version' },
          }
          : null,
      },
      reportCurrentDocument: (context) => currentReports.push(context),
    });
    servers.push(server);
    const address = await server.start();

    const response = await request(`http://${address.host}:${address.port}/native/current`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: {
        type: 'external',
        rootPath: '',
        relPath: artifactPath,
        filePath: artifactPath,
        title: 'Artifact',
      },
    });

    expect(response.status).toBe(200);
    expect(currentReports).toEqual([
      expect.objectContaining({
        type: 'external',
        rootPath: artifactDir,
        relPath: 'Artifact.md',
        filePath: artifactPath,
        title: 'Artifact',
      }),
    ]);
  });

  it('clears native current document context for the requesting browser client', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const clearedClientIds: Array<string | null | undefined> = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      clearCurrentDocument: (clientId) => clearedClientIds.push(clientId),
    });
    servers.push(server);
    const address = await server.start();

    const response = await request(`http://${address.host}:${address.port}/native/current`, {
      method: 'DELETE',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
        'X-FieldTheory-Browser-Client': 'client-one',
      },
    });

    expect(response.status).toBe(200);
    expect(clearedClientIds).toEqual(['client-one']);
  });

  it('serves native current document context from the native bridge', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const context = {
      type: 'wiki',
      rootPath: root,
      relPath: 'Plan',
      filePath: path.join(root, 'Plan.md'),
      title: 'Plan',
    };
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getActiveLibraryFileContext: () => context,
      },
    });
    servers.push(server);
    const address = await server.start();

    const response = await request(`http://${address.host}:${address.port}/native/current?token=test-token`);

    expect(response.status).toBe(200);
    expect(response.body.context).toEqual(context);
  });

  it('serves active native current document selection from the native bridge', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const context = {
      type: 'wiki',
      rootPath: root,
      relPath: 'Plan',
      filePath: path.join(root, 'Plan.md'),
      title: 'Plan',
      selectionStart: 2,
      selectionEnd: 6,
      selectionText: 'Plan',
    };
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getActiveLibraryFileContext: () => context,
      },
    });
    servers.push(server);
    const address = await server.start();

    const response = await request(`http://${address.host}:${address.port}/native/current?token=test-token`);

    expect(response.status).toBe(200);
    expect(response.body.context).toEqual(context);
  });


  it('serves tree and document reads for allowed paths only', async () => {
    const { address } = await startServer();

    const treeResponse = await request(`http://${address.host}:${address.port}/tree?token=test-token`);
    const docResponse = await request(`http://${address.host}:${address.port}/doc?token=test-token&rootId=root-1&relPath=Plan.md`);
    const outsideResponse = await request(`http://${address.host}:${address.port}/doc?token=test-token&rootId=root-1&relPath=../Secret.md`);

    expect(treeResponse.status).toBe(200);
    expect(treeResponse.body).toEqual(expect.objectContaining({ ok: true }));
    expect(docResponse.status).toBe(200);
    expect(docResponse.body.document.content).toBe('# Plan\n');
    expect(outsideResponse.status).toBe(403);
  });

  it('serves native-shaped library and wiki routes for the browser host adapter', async () => {
    const { address } = await startServer();

    const rootsResponse = await request(`http://${address.host}:${address.port}/native/library/roots?token=test-token`);
    const treeResponse = await request(`http://${address.host}:${address.port}/native/wiki/tree?token=test-token`);
    const pageResponse = await request(`http://${address.host}:${address.port}/native/wiki/page?token=test-token&relPath=Plan`);

    expect(rootsResponse.status).toBe(200);
    expect(rootsResponse.body.roots[0]).toEqual(expect.objectContaining({
      builtin: true,
      writable: true,
    }));
    expect(treeResponse.status).toBe(200);
    expect(treeResponse.body.tree).toEqual([]);
    expect(pageResponse.status).toBe(200);
    expect(pageResponse.body.page).toEqual(expect.objectContaining({
      relPath: 'Plan',
      title: 'Plan',
      content: '# Plan\n',
    }));
  });

  it('serves bookmark hidden folders from the native bridge and persists updates through it', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    let hiddenFolders = ['bookmarks-shortcut'];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getHiddenFolders: () => hiddenFolders,
        setFolderHidden: (folderId, hidden) => {
          hiddenFolders = hidden
            ? [...new Set([...hiddenFolders, folderId])]
            : hiddenFolders.filter((candidate) => candidate !== folderId);
          return hiddenFolders;
        },
      },
    });
    servers.push(server);
    const address = await server.start();

    const listResponse = await request(`http://${address.host}:${address.port}/native/library/hidden-folders?token=test-token`);
    const updateResponse = await request(`http://${address.host}:${address.port}/native/library/hidden-folders`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { folderId: 'bookmarks-from-x', hidden: true },
    });

    expect(listResponse.body.hiddenFolders).toEqual(['bookmarks-shortcut']);
    expect(updateResponse.body.hiddenFolders).toEqual(['bookmarks-shortcut', 'bookmarks-from-x']);
  });

  it('serves native recent entries and records visits using native shape', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const entries: Array<{ kind: 'wiki' | 'external'; path: string; title: string; lastOpenedAt: number }> = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        listRecent: () => entries.slice(),
        visitRecent: (entry) => {
          entries.unshift(entry);
          return entries.slice();
        },
      },
    });
    servers.push(server);
    const address = await server.start();

    const visitResponse = await request(`http://${address.host}:${address.port}/native/recent/visit`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { kind: 'wiki', path: 'Plan', title: 'Plan' },
    });
    const listResponse = await request(`http://${address.host}:${address.port}/native/recent/list?token=test-token`);

    expect(visitResponse.body.entries[0]).toEqual(expect.objectContaining({
      kind: 'wiki',
      path: 'Plan',
      title: 'Plan',
    }));
    expect(visitResponse.body.entries[0].lastOpenedAt).toEqual(expect.any(Number));
    expect(listResponse.body.entries).toEqual(visitResponse.body.entries);
  });

  it('streams native browser helper events to authenticated clients', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
    });
    servers.push(server);
    const address = await server.start();

    const eventPromise = readFirstEvent(`http://${address.host}:${address.port}/native/events?token=test-token`, 'wiki:changed');
    setTimeout(() => server.emitNativeEvent({ type: 'wiki:changed' }), 10);

    await expect(eventPromise).resolves.toContain('event: wiki:changed');
  });

  it('fans out native events to multiple browser clients without starting another server', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
    });
    servers.push(server);
    const address = await server.start();
    const firstEvent = readFirstEvent(`http://${address.host}:${address.port}/native/events?token=test-token`, 'wiki:openPage');
    const secondEvent = readFirstEvent(`http://${address.host}:${address.port}/native/events?token=test-token`, 'wiki:openPage');

    setTimeout(() => server.emitNativeEvent({ type: 'wiki:openPage', relPath: 'Plan' }), 10);

    await expect(firstEvent).resolves.toContain('"relPath":"Plan"');
    await expect(secondEvent).resolves.toContain('"relPath":"Plan"');
    expect(server.address().port).toBe(address.port);
  });

  it('streams native scratchpad open events to browser clients', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
    });
    servers.push(server);
    const address = await server.start();
    const eventPromise = readFirstEvent(`http://${address.host}:${address.port}/native/events?token=test-token`, 'wiki:openScratchpad');

    setTimeout(() => server.emitNativeEvent({ type: 'wiki:openScratchpad', relPath: 'scratchpad/Today' }), 10);

    await expect(eventPromise).resolves.toContain('"relPath":"scratchpad/Today"');
  });

  it('guards same-document saves from stale browser clients', async () => {
    const { address, root } = await startServer();
    const firstRead = await request(`http://${address.host}:${address.port}/native/wiki/page?token=test-token&relPath=Plan`);
    const secondRead = await request(`http://${address.host}:${address.port}/native/wiki/page?token=test-token&relPath=Plan`);

    const nativeWrite = await request(`http://${address.host}:${address.port}/native/wiki/page`, {
      method: 'PUT',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: {
        relPath: 'Plan',
        content: '# Native app write\n',
        expectedVersion: firstRead.body.page.documentVersion,
      },
    });
    const staleBrowserWrite = await request(`http://${address.host}:${address.port}/native/wiki/page`, {
      method: 'PUT',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: {
        relPath: 'Plan',
        content: '# Stale browser write\n',
        expectedVersion: secondRead.body.page.documentVersion,
      },
    });

    expect(nativeWrite.status).toBe(200);
    expect(staleBrowserWrite.status).toBe(409);
    expect(staleBrowserWrite.body.result.reason).toBe('conflict');
    expect(fs.readFileSync(path.join(root, 'Plan.md'), 'utf-8')).toBe('# Native app write\n');
  });

  it('creates default scratchpad pages through the browser wiki bridge', async () => {
    const { address, root } = await startServer();

    const response = await request(`http://${address.host}:${address.port}/native/wiki/scratchpad-default`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });

    expect(response.status).toBe(200);
    expect(response.body.page.relPath).toMatch(/^scratchpad\//);
    expect(fs.existsSync(path.join(root, `${response.body.page.relPath}.md`))).toBe(true);
  });

  it('bridges markdown previews through the native bridge', async () => {
    const root = makeTempDir();
    const previewPath = path.join(root, 'Preview.md');
    fs.writeFileSync(previewPath, '# Preview\n');
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getMarkdownPreview: (filePath) => ({
          title: path.basename(filePath),
          filePath,
          content: fs.readFileSync(filePath, 'utf-8'),
        }),
      },
    });
    servers.push(server);
    const address = await server.start();

    const response = await request(`http://${address.host}:${address.port}/native/commands/markdown-preview?token=test-token&path=${encodeURIComponent(previewPath)}`);

    expect(response.status).toBe(200);
    expect(response.body.preview).toEqual({
      title: 'Preview.md',
      filePath: previewPath,
      content: '# Preview\n',
    });
  });

  it('bridges renderer storage through the native bridge', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const values: Record<string, string | null> = {
      'library-pinned-item-ids': '["wiki:Plan"]',
      'fieldtheory-line-numbers': 'visible',
      'fieldtheory-rendered-edit-click-mode': 'click',
      'fieldtheory-text-cursor-blink': 'false',
      'fieldtheory-rendered-text-cursor-style': 'bar',
      'fieldtheory-rendered-block-cursor-opacity': '0.8',
      'fieldtheory-shared-file-toggle-hotkey': 'Command+Shift+R',
      'librarian-last-selection': '{"type":"wiki","relPath":"scratchpad/Native"}',
    };
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getRendererStorage: () => ({ available: true, values }),
        setRendererStorage: (key, value) => {
          values[key] = value;
        },
      },
    });
    servers.push(server);
    const address = await server.start();

    const listResponse = await request(`http://${address.host}:${address.port}/native/renderer-storage?token=test-token`);
    const setResponse = await request(`http://${address.host}:${address.port}/native/renderer-storage`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { key: 'fieldtheory.contentToolbar.pinnedActions.v2', value: '["fieldtheory"]' },
    });

    expect(listResponse.body.values['library-pinned-item-ids']).toBe('["wiki:Plan"]');
    expect(listResponse.body.values['fieldtheory-line-numbers']).toBe('visible');
    expect(listResponse.body.values['fieldtheory-rendered-edit-click-mode']).toBe('click');
    expect(listResponse.body.values['fieldtheory-text-cursor-blink']).toBe('false');
    expect(listResponse.body.values['fieldtheory-rendered-text-cursor-style']).toBe('bar');
    expect(listResponse.body.values['fieldtheory-rendered-block-cursor-opacity']).toBe('0.8');
    expect(listResponse.body.values['fieldtheory-shared-file-toggle-hotkey']).toBe('Command+Shift+R');
    expect(listResponse.body.values['librarian-last-selection']).toBe('{"type":"wiki","relPath":"scratchpad/Native"}');
    expect(listResponse.body.available).toBe(true);
    expect(setResponse.status).toBe(200);
    expect(values['fieldtheory.contentToolbar.pinnedActions.v2']).toBe('["fieldtheory"]');
  });

  it('reports renderer storage as unavailable when no native bridge snapshot exists', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
    });
    servers.push(server);
    const address = await server.start();

    const response = await request(`http://${address.host}:${address.port}/native/renderer-storage?token=test-token`);

    expect(response.status).toBe(200);
    expect(response.body.available).toBe(false);
    expect(response.body.values).toEqual({});
  });

  it('bridges configurable hotkeys through the native bridge', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getHotkey: (id) => id === 'scratchpad' ? 'Control+Option+Command+Space' : null,
      },
    });
    servers.push(server);
    const address = await server.start();

    const response = await request(`http://${address.host}:${address.port}/native/hotkey?token=test-token&id=scratchpad`);

    expect(response.status).toBe(200);
    expect(response.body.hotkey).toBe('Control+Option+Command+Space');
  });

  it('bridges librarian footer actions through the native bridge', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const calls: unknown[] = [];
    let muted = false;
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getShareStatus: (filePath) => ({ shared: true, slug: 'plan-123', url: `https://librarian.fieldtheory.dev/${path.basename(filePath)}` }),
        shareReading: (filePath) => {
          calls.push(['share', filePath]);
          return { slug: 'plan-123', url: 'https://librarian.fieldtheory.dev/plan-123' };
        },
        unshareReading: (filePath) => {
          calls.push(['unshare', filePath]);
          return true;
        },
        updateSharedReading: (filePath, content, title) => {
          calls.push(['update', filePath, content, title]);
          return true;
        },
        pollLibrarianStatus: () => ({
          pendingPath: '/tmp/Auto.md',
          edits: 3,
          threshold: 5,
          didReset: false,
        }),
        isMutedForToday: () => muted,
        muteForToday: () => {
          muted = true;
          return muted;
        },
        unmute: () => {
          muted = false;
          return true;
        },
      },
    });
    servers.push(server);
    const address = await server.start();
    const encodedPath = encodeURIComponent('/tmp/Plan.md');

    const shareStatus = await request(`http://${address.host}:${address.port}/native/librarian/share-status?token=test-token&path=${encodedPath}`);
    const share = await request(`http://${address.host}:${address.port}/native/librarian/share-reading`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { filePath: '/tmp/Plan.md' },
    });
    const update = await request(`http://${address.host}:${address.port}/native/librarian/update-shared-reading`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { filePath: '/tmp/Plan.md', content: '# Updated\n', title: 'Plan' },
    });
    const status = await request(`http://${address.host}:${address.port}/native/librarian/status?token=test-token`);
    const mutedBefore = await request(`http://${address.host}:${address.port}/native/librarian/muted-for-today?token=test-token`);
    const mute = await request(`http://${address.host}:${address.port}/native/librarian/mute-for-today`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });
    const unmute = await request(`http://${address.host}:${address.port}/native/librarian/unmute`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });
    const unshare = await request(`http://${address.host}:${address.port}/native/librarian/unshare-reading`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { filePath: '/tmp/Plan.md' },
    });

    expect(shareStatus.body.status).toEqual({ shared: true, slug: 'plan-123', url: 'https://librarian.fieldtheory.dev/Plan.md' });
    expect(share.body.result).toEqual({ slug: 'plan-123', url: 'https://librarian.fieldtheory.dev/plan-123' });
    expect(update.body.success).toBe(true);
    expect(status.body.status).toEqual({
      pendingPath: '/tmp/Auto.md',
      edits: 3,
      threshold: 5,
      didReset: false,
    });
    expect(mutedBefore.body.muted).toBe(false);
    expect(mute.body.muted).toBe(true);
    expect(unmute.body.muted).toBe(false);
    expect(unshare.body.success).toBe(true);
    expect(calls).toEqual([
      ['share', '/tmp/Plan.md'],
      ['update', '/tmp/Plan.md', '# Updated\n', 'Plan'],
      ['unshare', '/tmp/Plan.md'],
    ]);
  });

  it('bridges show-in-folder through the native bridge', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const shown: string[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        showItemInFolder: (filePath) => {
          shown.push(filePath);
          return true;
        },
      },
    });
    servers.push(server);
    const address = await server.start();

    const response = await request(`http://${address.host}:${address.port}/native/shell/show-item-in-folder`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { filePath: '/tmp/Plan.md' },
    });

    expect(response.body.success).toBe(true);
    expect(shown).toEqual(['/tmp/Plan.md']);
  });

  it('bridges represented filename changes through the native bridge with the browser client id', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const represented: Array<[string, string | null | undefined]> = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        setRepresentedFilename: (filePath, clientId) => {
          represented.push([filePath, clientId]);
        },
      },
    });
    servers.push(server);
    const address = await server.start();

    const response = await request(`http://${address.host}:${address.port}/native/shell/represented-filename`, {
      method: 'POST',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
        'X-FieldTheory-Browser-Client': 'client-one',
      },
      body: { filePath: '/tmp/Plan.md' },
    });
    const clear = await request(`http://${address.host}:${address.port}/native/shell/represented-filename`, {
      method: 'POST',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
        'X-FieldTheory-Browser-Client': 'client-one',
      },
      body: { filePath: '' },
    });

    expect(response.status).toBe(200);
    expect(clear.status).toBe(200);
    expect(represented).toEqual([
      ['/tmp/Plan.md', 'client-one'],
      ['', 'client-one'],
    ]);
  });

  it('bridges tagged-doc actions through the native bridge', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const calls: string[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        listTaggedDocs: () => [{ ulid: 'tag-1', unread: true }],
        markTaggedDocRead: (ulid) => {
          calls.push(`read:${ulid}`);
          return { ulid, unread: false };
        },
        markAllTaggedDocsRead: () => {
          calls.push('read-all');
          return [{ ulid: 'tag-1', unread: false }];
        },
        rescanTaggedDocs: () => {
          calls.push('rescan');
          return [{ ulid: 'tag-2', unread: true }];
        },
      },
    });
    servers.push(server);
    const address = await server.start();

    const list = await request(`http://${address.host}:${address.port}/native/tagged-docs/list?token=test-token`);
    const markRead = await request(`http://${address.host}:${address.port}/native/tagged-docs/mark-read`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { ulid: 'tag-1' },
    });
    const markAll = await request(`http://${address.host}:${address.port}/native/tagged-docs/mark-all-read`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });
    const rescan = await request(`http://${address.host}:${address.port}/native/tagged-docs/rescan`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });

    expect(list.body.items).toEqual([{ ulid: 'tag-1', unread: true }]);
    expect(markRead.body.item).toEqual({ ulid: 'tag-1', unread: false });
    expect(markAll.body.items).toEqual([{ ulid: 'tag-1', unread: false }]);
    expect(rescan.body.items).toEqual([{ ulid: 'tag-2', unread: true }]);
    expect(calls).toEqual(['read:tag-1', 'read-all', 'rescan']);
  });

  it('bridges shared-file actions through the native bridge', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const calls: unknown[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getSharedFilesAvailability: () => ({ available: true, canWrite: true, hasTeamMembers: true }),
        getSharedFileStatus: (filePath) => ({ shared: true, sharedId: `shared:${path.basename(filePath)}`, revision: 2 }),
        shareSharedFile: (input) => {
          calls.push(['share', input]);
          return { shared: true, sharedId: 'shared-1', revision: 1 };
        },
        unshareSharedFile: (filePath) => {
          calls.push(['unshare', filePath]);
          return true;
        },
        syncSharedFiles: () => {
          calls.push(['sync']);
          return { written: 1, removed: 0, created: 0, errors: [] };
        },
        updateSharedFileContent: (sharedId, content, expectedRevision, documentPath) => {
          calls.push(['update', sharedId, content, expectedRevision, documentPath]);
          return { ok: true, revision: expectedRevision + 1 };
        },
        setActivePresence: (sharedId) => {
          calls.push(['presence', sharedId]);
          return [{ userId: 'user-1', initials: 'FT' }];
        },
        getPinnedItemIds: () => ['wiki:River (shared)/Team Plan'],
        setPinned: (filePath, pinned) => {
          calls.push(['pin', filePath, pinned]);
          return { success: true, filePath, pinned };
        },
      },
    });
    servers.push(server);
    const address = await server.start();
    const pinsEvent = readFirstEvent(`http://${address.host}:${address.port}/native/events?token=test-token`, 'sharedFiles:pinsChanged');

    const availability = await request(`http://${address.host}:${address.port}/native/shared-files/availability?token=test-token`);
    const pinnedIds = await request(`http://${address.host}:${address.port}/native/shared-files/pinned-item-ids?token=test-token`);
    const status = await request(`http://${address.host}:${address.port}/native/shared-files/status?token=test-token&path=${encodeURIComponent('/tmp/Plan.md')}`);
    const share = await request(`http://${address.host}:${address.port}/native/shared-files/share`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { filePath: '/tmp/Plan.md', title: 'Plan' },
    });
    const update = await request(`http://${address.host}:${address.port}/native/shared-files/update-content`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { sharedId: 'shared-1', content: '# Plan\n', expectedRevision: 1, documentPath: '/tmp/Plan.md' },
    });
    const presence = await request(`http://${address.host}:${address.port}/native/shared-files/active-presence`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { sharedId: 'shared-1' },
    });
    const pin = await request(`http://${address.host}:${address.port}/native/shared-files/pinned`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { filePath: '/tmp/River.md', pinned: true },
    });
    const sync = await request(`http://${address.host}:${address.port}/native/shared-files/sync`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });
    const unshare = await request(`http://${address.host}:${address.port}/native/shared-files/unshare`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { filePath: '/tmp/Plan.md' },
    });

    expect(availability.body.availability).toEqual({ available: true, canWrite: true, hasTeamMembers: true });
    expect(pinnedIds.body.ids).toEqual(['wiki:River (shared)/Team Plan']);
    expect(status.body.status).toEqual({ shared: true, sharedId: 'shared:Plan.md', revision: 2 });
    expect(share.body.status).toEqual({ shared: true, sharedId: 'shared-1', revision: 1 });
    expect(update.body.result).toEqual({ ok: true, revision: 2 });
    expect(presence.body.users).toEqual([{ userId: 'user-1', initials: 'FT' }]);
    expect(pin.body.result).toEqual({ success: true, filePath: '/tmp/River.md', pinned: true });
    expect(sync.body.result).toEqual({ written: 1, removed: 0, created: 0, errors: [] });
    expect(unshare.body.success).toBe(true);
    expect(calls).toEqual([
      ['share', { filePath: '/tmp/Plan.md', title: 'Plan' }],
      ['update', 'shared-1', '# Plan\n', 1, '/tmp/Plan.md'],
      ['presence', 'shared-1'],
      ['pin', '/tmp/River.md', true],
      ['sync'],
      ['unshare', '/tmp/Plan.md'],
    ]);
    server.emitNativeEvent({ type: 'sharedFiles:pinsChanged' });
    await expect(pinsEvent).resolves.toContain('sharedFiles:pinsChanged');
  });

  it('saves native wiki writes with expected-version protection', async () => {
    const { address, root } = await startServer();
    const pageResponse = await request(`http://${address.host}:${address.port}/native/wiki/page?token=test-token&relPath=Plan`);
    const page = pageResponse.body.page;

    const saveResponse = await request(`http://${address.host}:${address.port}/native/wiki/page`, {
      method: 'PUT',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
      },
      body: {
        relPath: 'Plan',
        content: '# Native write\n',
        expectedVersion: page.documentVersion,
      },
    });

    expect(saveResponse.status).toBe(200);
    expect(fs.readFileSync(path.join(root, 'Plan.md'), 'utf-8')).toBe('# Native write\n');
  });

  it('creates and renames native wiki pages through browser host routes', async () => {
    const { address, root } = await startServer();

    const createResponse = await request(`http://${address.host}:${address.port}/native/wiki/file`, {
      method: 'POST',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
      },
      body: {
        folderRelPath: 'Notes',
        fileName: 'Browser Plan',
      },
    });
    const renameResponse = await request(`http://${address.host}:${address.port}/native/wiki/rename`, {
      method: 'POST',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
      },
      body: {
        relPath: 'Notes/Browser Plan',
        newName: 'Renamed Plan',
      },
    });
    const dirResponse = await request(`http://${address.host}:${address.port}/native/wiki/dir`, {
      method: 'POST',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
      },
      body: {
        dirRelPath: 'Projects',
      },
    });

    expect(createResponse.status).toBe(200);
    expect(createResponse.body.page).toEqual(expect.objectContaining({
      relPath: 'Notes/Browser Plan',
      title: 'Browser Plan',
      content: '',
    }));
    expect(renameResponse.status).toBe(200);
    expect(renameResponse.body.newRelPath).toBe('Notes/Renamed Plan');
    expect(dirResponse.status).toBe(200);
    expect(fs.existsSync(path.join(root, 'Notes', 'Browser Plan.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'Notes', 'Renamed Plan.md'))).toBe(true);
    expect(fs.statSync(path.join(root, 'Projects')).isDirectory()).toBe(true);
  });

  it('records Browser-created wiki and library files in native recents', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const recentCalls: unknown[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        recordRecentWikiPage: (page) => {
          recentCalls.push(['wiki', page]);
        },
        recordRecentCreatedLibraryPage: (page, rootPath) => {
          recentCalls.push(['library', rootPath, page]);
        },
      },
    });
    servers.push(server);
    const address = await server.start();

    const wikiCreate = await request(`http://${address.host}:${address.port}/native/wiki/file`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: {
        folderRelPath: 'Notes',
        fileName: 'Browser Plan',
      },
    });
    const wikiDefault = await request(`http://${address.host}:${address.port}/native/wiki/default-file`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: {
        folderRelPath: 'Notes',
      },
    });
    const libraryCreate = await request(`http://${address.host}:${address.port}/native/library/file`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: {
        rootPath: root,
        folderRelPath: 'Library',
        fileName: 'Library Plan',
      },
    });

    expect(wikiCreate.status).toBe(200);
    expect(wikiDefault.status).toBe(200);
    expect(libraryCreate.status).toBe(200);
    expect(recentCalls).toEqual([
      ['wiki', expect.objectContaining({ relPath: 'Notes/Browser Plan', title: 'Browser Plan' })],
      ['wiki', expect.objectContaining({ relPath: expect.stringMatching(/^Notes\//) })],
      ['library', root, expect.objectContaining({ relPath: 'Library/Library Plan', title: 'Library Plan' })],
    ]);
  });

  it('supports native left-nav root, delete, and move operations', async () => {
    const { address, root } = await startServer();
    const extraRoot = makeTempDir();
    fs.writeFileSync(path.join(extraRoot, 'Extra.md'), '# Extra\n');
    fs.mkdirSync(path.join(root, 'Inbox'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Inbox', 'Move Me.md'), '# Move me\n');

    const addRoot = await request(`http://${address.host}:${address.port}/native/library/root`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { dirPath: extraRoot },
    });
    const move = await request(`http://${address.host}:${address.port}/native/library/move`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: {
        rootPath: root,
        kind: 'file',
        sourceRelPath: 'Inbox/Move Me',
        targetDirRelPath: '',
      },
    });
    const deleteWiki = await request(`http://${address.host}:${address.port}/native/wiki/page`, {
      method: 'DELETE',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { relPath: 'Plan' },
    });
    fs.mkdirSync(path.join(root, 'Delete Me'), { recursive: true });
    const deleteDir = await request(`http://${address.host}:${address.port}/native/library/dir`, {
      method: 'DELETE',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { rootPath: root, dirRelPath: 'Delete Me' },
    });
    const removeRoot = await request(`http://${address.host}:${address.port}/native/library/root`, {
      method: 'DELETE',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { dirPath: extraRoot },
    });

    expect(addRoot.status).toBe(200);
    expect(addRoot.body.root.path).toBe(extraRoot);
    expect(move.status).toBe(200);
    expect(move.body.newRelPath).toBe('Move Me');
    expect(fs.existsSync(path.join(root, 'Inbox', 'Move Me.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'Move Me.md'))).toBe(true);
    expect(deleteWiki.status).toBe(200);
    expect(fs.existsSync(path.join(root, 'Plan.md'))).toBe(false);
    expect(deleteDir.status).toBe(200);
    expect(fs.existsSync(path.join(root, 'Delete Me'))).toBe(false);
    expect(removeRoot.status).toBe(200);
  });

  it('supports document-version lookup and external rename/delete routes', async () => {
    const { address, root } = await startServer();
    const extraRoot = makeTempDir();
    fs.writeFileSync(path.join(extraRoot, 'External.md'), '# External\n');
    await request(`http://${address.host}:${address.port}/native/library/root`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { dirPath: extraRoot },
    });
    const wiki = await request(`http://${address.host}:${address.port}/native/wiki/page?token=test-token&relPath=Plan`);
    const external = await request(`http://${address.host}:${address.port}/native/external/open?token=test-token&path=${encodeURIComponent(path.join(extraRoot, 'External.md'))}`);

    const wikiLookup = await request(`http://${address.host}:${address.port}/native/wiki/find-by-document-version`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { version: wiki.body.page.documentVersion },
    });
    const externalLookup = await request(`http://${address.host}:${address.port}/native/external/find-by-document-version`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { version: external.body.file.documentVersion },
    });
    const rename = await request(`http://${address.host}:${address.port}/native/external/rename`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { path: path.join(extraRoot, 'External.md'), newName: 'Renamed External' },
    });
    const remove = await request(`http://${address.host}:${address.port}/native/external/file`, {
      method: 'DELETE',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { path: path.join(extraRoot, 'Renamed External.md') },
    });

    expect(wikiLookup.body.page).toEqual(expect.objectContaining({ relPath: 'Plan' }));
    expect(externalLookup.body.file).toEqual(expect.objectContaining({ path: path.join(extraRoot, 'External.md') }));
    expect(rename.body.file).toEqual(expect.objectContaining({
      path: path.join(extraRoot, 'Renamed External.md'),
      name: 'Renamed External.md',
    }));
    expect(fs.existsSync(path.join(extraRoot, 'External.md'))).toBe(false);
    expect(remove.status).toBe(200);
    expect(fs.existsSync(path.join(extraRoot, 'Renamed External.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'Plan.md'))).toBe(true);
  });

  it('returns native-shaped nulls for missing wiki and external documents', async () => {
    const { address } = await startServer();

    const missingWiki = await request(`http://${address.host}:${address.port}/native/wiki/page?token=test-token&relPath=Missing`);
    const missingExternal = await request(`http://${address.host}:${address.port}/native/external/open?token=test-token&path=${encodeURIComponent('/tmp/not-in-library.md')}`);

    expect(missingWiki.status).toBe(200);
    expect(missingWiki.body.page).toBeNull();
    expect(missingExternal.status).toBe(200);
    expect(missingExternal.body.file).toBeNull();
  });

  it('bridges markdown image operations through the native bridge', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const calls: unknown[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        copyImageForDocument: (documentPath, imagePath, alt) => {
          calls.push(['copy-file', documentPath, imagePath, alt]);
          return { markdown: '![Alt](./assets/image.png)', destination: 'assets/image.png', copiedPath: '/tmp/image.png' };
        },
        copyImageDataUrlForDocument: (documentPath, dataUrl, alt) => {
          calls.push(['copy-data-url', documentPath, dataUrl, alt]);
          return { markdown: '![Alt](./assets/data.png)', destination: 'assets/data.png', copiedPath: '/tmp/data.png' };
        },
        makeImagesPortable: (documentPath, content) => {
          calls.push(['portable', documentPath, content]);
          return { content: `${content}\nportable`, copied: 1, rewritten: 1, missing: 0 };
        },
        deleteUnusedCopiedImages: (documentPath, removedMarkdown, remainingContent) => {
          calls.push(['delete-unused', documentPath, removedMarkdown, remainingContent]);
          return { deleted: 1, skipped: 0, missing: 0 };
        },
      },
    });
    servers.push(server);
    const address = await server.start();

    const copyFile = await request(`http://${address.host}:${address.port}/native/markdown-images/copy-file`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { documentPath: '/tmp/Plan.md', imagePath: '/tmp/source.png', alt: 'Alt' },
    });
    const copyDataUrl = await request(`http://${address.host}:${address.port}/native/markdown-images/copy-data-url`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { documentPath: '/tmp/Plan.md', dataUrl: 'data:image/png;base64,abc', alt: 'Alt' },
    });
    const portable = await request(`http://${address.host}:${address.port}/native/markdown-images/make-portable`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { documentPath: '/tmp/Plan.md', content: '# Plan\n' },
    });
    const deleteUnused = await request(`http://${address.host}:${address.port}/native/markdown-images/delete-unused`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { documentPath: '/tmp/Plan.md', removedMarkdown: '![Old](old.png)', remainingContent: '# Plan\n' },
    });

    expect(copyFile.body.result.markdown).toContain('assets/image.png');
    expect(copyDataUrl.body.result.markdown).toContain('assets/data.png');
    expect(portable.body.result).toEqual({ content: '# Plan\n\nportable', copied: 1, rewritten: 1, missing: 0 });
    expect(deleteUnused.body.result).toEqual({ deleted: 1, skipped: 0, missing: 0 });
    expect(calls).toEqual([
      ['copy-file', '/tmp/Plan.md', '/tmp/source.png', 'Alt'],
      ['copy-data-url', '/tmp/Plan.md', 'data:image/png;base64,abc', 'Alt'],
      ['portable', '/tmp/Plan.md', '# Plan\n'],
      ['delete-unused', '/tmp/Plan.md', '![Old](old.png)', '# Plan\n'],
    ]);
  });

  it('bridges editor clipboard image helpers through the native bridge', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const calls: unknown[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        writeClipboardText: (text) => {
          calls.push(['text', text]);
          return { success: true };
        },
        getClipboardImagePath: () => '/tmp/current-clipboard.png',
        savePastedImageFile: (file) => {
          calls.push(file);
          return '/tmp/pasted-image.png';
        },
      },
    });
    servers.push(server);
    const address = await server.start();

    const imagePath = await request(`http://${address.host}:${address.port}/native/clipboard/image-path?token=test-token`);
    const copiedText = await request(`http://${address.host}:${address.port}/native/clipboard/text`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { text: 'Copy me' },
    });
    const pasted = await request(`http://${address.host}:${address.port}/native/clipboard/pasted-image-file`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { name: 'paste.png', type: 'image/png', data: [137, 80, 78, 71] },
    });

    expect(imagePath.body.path).toBe('/tmp/current-clipboard.png');
    expect(copiedText.body.result).toEqual({ success: true });
    expect(pasted.body.path).toBe('/tmp/pasted-image.png');
    expect(calls).toEqual([
      ['text', 'Copy me'],
      {
        name: 'paste.png',
        type: 'image/png',
        data: Uint8Array.from([137, 80, 78, 71]),
      },
    ]);
  });

  it('bridges rendered editor diagnostics through the native bridge', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const calls: unknown[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        appendRenderedEditorDebug: (entry) => {
          calls.push(['append', entry]);
          return { ok: true, path: '/tmp/rendered-debug.jsonl' };
        },
        clearRenderedEditorDebugLog: () => {
          calls.push(['clear']);
          return { ok: true, path: '/tmp/rendered-debug.jsonl' };
        },
      },
    });
    servers.push(server);
    const address = await server.start();

    const append = await request(`http://${address.host}:${address.port}/native/diagnostics/rendered-editor-debug`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { entry: { stage: 'debug-mark', path: '/tmp/Plan.md' } },
    });
    const clear = await request(`http://${address.host}:${address.port}/native/diagnostics/rendered-editor-debug`, {
      method: 'DELETE',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });

    expect(append.body.result).toEqual({ ok: true, path: '/tmp/rendered-debug.jsonl' });
    expect(clear.body.result).toEqual({ ok: true, path: '/tmp/rendered-debug.jsonl' });
    expect(calls).toEqual([
      ['append', { stage: 'debug-mark', path: '/tmp/Plan.md' }],
      ['clear'],
    ]);
  });

  it('bridges artifact reading read, save, delete, and document-window operations', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const artifactPath = path.join(root, 'Artifact.md');
    const openedTargets: unknown[] = [];
    let artifact = {
      path: artifactPath,
      title: 'Artifact',
      content: '# Artifact\n',
      documentVersion: { mtimeMs: 1, size: 11, sha256: 'old' },
    };
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getReading: (filePath) => filePath === artifactPath ? artifact : null,
        saveReading: (filePath, content) => {
          artifact = {
            ...artifact,
            path: filePath,
            content,
            documentVersion: { mtimeMs: 2, size: content.length, sha256: 'new' },
          };
          return { ok: true, version: artifact.documentVersion };
        },
        deleteReading: (filePath) => {
          if (filePath !== artifactPath) return false;
          return true;
        },
        openDocumentWindow: (target) => {
          openedTargets.push(target);
          return { success: true };
        },
      },
    });
    servers.push(server);
    const address = await server.start();

    const read = await request(`http://${address.host}:${address.port}/native/librarian/reading?token=test-token&path=${encodeURIComponent(artifactPath)}`);
    const save = await request(`http://${address.host}:${address.port}/native/librarian/reading`, {
      method: 'PUT',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { filePath: artifactPath, content: '# Updated\n', expectedVersion: artifact.documentVersion },
    });
    const openWindow = await request(`http://${address.host}:${address.port}/native/library/open-document-window`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { type: 'artifact', path: artifactPath },
    });
    const remove = await request(`http://${address.host}:${address.port}/native/librarian/reading`, {
      method: 'DELETE',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { filePath: artifactPath },
    });

    expect(read.body.reading).toEqual(expect.objectContaining({ path: artifactPath, content: '# Artifact\n' }));
    expect(save.status).toBe(200);
    expect(save.body.result).toEqual({ ok: true, version: { mtimeMs: 2, size: 10, sha256: 'new' } });
    expect(openWindow.body.result).toEqual({ success: true });
    expect(openedTargets).toEqual([{ type: 'artifact', path: artifactPath }]);
    expect(remove.status).toBe(200);
  });

  it('bridges Librarian setup, watched directories, hooks, and personalization through native logic', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    let enabled = false;
    let setupComplete = false;
    let discoveryFrequency = 'sometimes';
    let expertiseContext: string | undefined;
    let stateHookInstalled = false;
    let cursorHookInstalled = false;
    let codexHookInstalled = false;
    const watchedDirs: Array<{ path: string; enabled: boolean }> = [];
    const calls: unknown[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        isLibrarianEnabled: () => enabled,
        setLibrarianEnabled: (nextEnabled) => {
          enabled = nextEnabled;
          return enabled;
        },
        isLibrarianSetupComplete: () => setupComplete,
        setLibrarianSetupComplete: (complete) => {
          setupComplete = complete;
        },
        createWelcomeArtifact: (dirPath) => {
          calls.push(['welcome', dirPath]);
          return true;
        },
        getLibrarianWatchedDirs: () => watchedDirs,
        addLibrarianWatchedDir: (dirPath) => {
          const dir = { path: dirPath, enabled: true };
          watchedDirs.push(dir);
          return dir;
        },
        removeLibrarianWatchedDir: (dirPath) => {
          const index = watchedDirs.findIndex((dir) => dir.path === dirPath);
          if (index < 0) return false;
          watchedDirs.splice(index, 1);
          return true;
        },
        browseLibrarianDirectory: () => '/tmp/readings',
        getDiscoveryFrequency: () => discoveryFrequency,
        setDiscoveryFrequency: (frequency) => {
          discoveryFrequency = frequency;
          return true;
        },
        getUserExpertiseContext: () => expertiseContext,
        setUserExpertiseContext: (context) => {
          expertiseContext = context;
          return true;
        },
        getClaudeCodeStatus: () => 'directory-only',
        isStateEnforcedHookInstalled: () => stateHookInstalled,
        installStateEnforcedHook: () => {
          stateHookInstalled = true;
          return true;
        },
        uninstallStateEnforcedHook: () => {
          stateHookInstalled = false;
          return true;
        },
        isCursorHookInstalled: () => cursorHookInstalled,
        installCursorHook: () => {
          cursorHookInstalled = true;
          return true;
        },
        uninstallCursorHook: () => {
          cursorHookInstalled = false;
          return true;
        },
        isCodexHookInstalled: () => codexHookInstalled,
        installCodexHook: () => {
          codexHookInstalled = true;
          return true;
        },
        uninstallCodexHook: () => {
          codexHookInstalled = false;
          return true;
        },
      },
    });
    servers.push(server);
    const address = await server.start();
    const authHeaders = { 'X-FieldTheory-Browser-Token': 'test-token' };

    const initialSetup = await request(`http://${address.host}:${address.port}/native/librarian/setup-complete?token=test-token`);
    const enable = await request(`http://${address.host}:${address.port}/native/librarian/enabled`, {
      method: 'POST',
      headers: authHeaders,
      body: { enabled: true },
    });
    const complete = await request(`http://${address.host}:${address.port}/native/librarian/setup-complete`, {
      method: 'POST',
      headers: authHeaders,
      body: { complete: true },
    });
    const addDir = await request(`http://${address.host}:${address.port}/native/librarian/watched-dirs`, {
      method: 'POST',
      headers: authHeaders,
      body: { dirPath: '~/.librarian' },
    });
    const dirs = await request(`http://${address.host}:${address.port}/native/librarian/watched-dirs?token=test-token`);
    const browse = await request(`http://${address.host}:${address.port}/native/librarian/browse-directory?token=test-token`);
    const welcome = await request(`http://${address.host}:${address.port}/native/librarian/welcome-artifact`, {
      method: 'POST',
      headers: authHeaders,
      body: { dirPath: '~/.librarian' },
    });
    const frequency = await request(`http://${address.host}:${address.port}/native/librarian/discovery-frequency`, {
      method: 'POST',
      headers: authHeaders,
      body: { frequency: 'often' },
    });
    const expertise = await request(`http://${address.host}:${address.port}/native/librarian/user-expertise-context`, {
      method: 'POST',
      headers: authHeaders,
      body: { context: 'Writes fast, reviews carefully.' },
    });
    const claudeStatus = await request(`http://${address.host}:${address.port}/native/librarian/claude-code-status?token=test-token`);
    const installStateHook = await request(`http://${address.host}:${address.port}/native/librarian/state-enforced-hook`, {
      method: 'POST',
      headers: authHeaders,
    });
    const stateHook = await request(`http://${address.host}:${address.port}/native/librarian/state-enforced-hook?token=test-token`);
    const installCursorHook = await request(`http://${address.host}:${address.port}/native/librarian/cursor-hook`, {
      method: 'POST',
      headers: authHeaders,
    });
    const uninstallCodexHook = await request(`http://${address.host}:${address.port}/native/librarian/codex-hook`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    expect(initialSetup.body.complete).toBe(false);
    expect(enable.body.enabled).toBe(true);
    expect(complete.status).toBe(200);
    expect(addDir.body.dir).toEqual({ path: '~/.librarian', enabled: true });
    expect(dirs.body.dirs).toEqual([{ path: '~/.librarian', enabled: true }]);
    expect(browse.body.dirPath).toBe('/tmp/readings');
    expect(welcome.body.created).toBe(true);
    expect(calls).toEqual([['welcome', '~/.librarian']]);
    expect(frequency.body.success).toBe(true);
    expect(expertise.body.success).toBe(true);
    expect(claudeStatus.body.status).toBe('directory-only');
    expect(installStateHook.body.success).toBe(true);
    expect(stateHook.body.installed).toBe(true);
    expect(installCursorHook.body.success).toBe(true);
    expect(uninstallCodexHook.body.success).toBe(true);
  });

  it('streams librarian reading lifecycle events to browser clients', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
    });
    servers.push(server);
    const address = await server.start();
    const eventPromise = readFirstEvent(`http://${address.host}:${address.port}/native/events?token=test-token`, 'librarian:readingRenamed');

    setTimeout(() => server.emitNativeEvent({
      type: 'librarian:readingRenamed',
      event: { oldPath: '/tmp/Old.md', reading: { path: '/tmp/New.md' } },
    }), 10);

    await expect(eventPromise).resolves.toContain('librarian:readingRenamed');
  });

  it('bridges meeting toolbar actions and status events through the native bridge', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const activeSession = { status: 'recording', title: 'Weekly Review' };
    const calls: string[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getActiveMeeting: () => activeSession,
        startMeetingHere: () => {
          calls.push('start');
          return { success: true, session: activeSession };
        },
        stopMeeting: () => {
          calls.push('stop');
          return { success: true, session: { ...activeSession, status: 'idle' } };
        },
      },
    });
    servers.push(server);
    const address = await server.start();
    const eventPromise = readFirstEvent(`http://${address.host}:${address.port}/native/events?token=test-token`, 'meetings:status');

    const active = await request(`http://${address.host}:${address.port}/native/meetings/active?token=test-token`);
    const start = await request(`http://${address.host}:${address.port}/native/meetings/start-here`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });
    const stop = await request(`http://${address.host}:${address.port}/native/meetings/stop`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });
    setTimeout(() => server.emitNativeEvent({ type: 'meetings:status', session: activeSession }), 10);

    expect(active.body.session).toEqual(activeSession);
    expect(start.body.result).toEqual({ success: true, session: activeSession });
    expect(stop.body.result).toEqual({ success: true, session: { ...activeSession, status: 'idle' } });
    expect(calls).toEqual(['start', 'stop']);
    await expect(eventPromise).resolves.toContain('meetings:status');
  });

  it('bridges legacy Commands preload APIs through the native bridge', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const calls: unknown[] = [];
    const command = {
      name: 'review',
      displayName: 'review',
      filePath: '/commands/review.md',
      lastModified: 10,
    };
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getCommandDirectory: () => '/commands',
        setCommandDirectory: (directoryPath) => {
          calls.push(['set-directory', directoryPath]);
          return { success: true };
        },
        getCommandDirectories: () => [{ path: '/commands', commandCount: 1 }],
        refreshCommands: () => [command],
        getCommandContent: (commandName) => (
          commandName === 'review' ? { content: '# Review\n', filePath: '/commands/review.md' } : null
        ),
      },
    });
    servers.push(server);
    const address = await server.start();

    const directory = await request(`http://${address.host}:${address.port}/native/commands/directory?token=test-token`);
    const updateDirectory = await request(`http://${address.host}:${address.port}/native/commands/directory`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { directoryPath: '/next-commands' },
    });
    const directories = await request(`http://${address.host}:${address.port}/native/commands/directories?token=test-token`);
    const refreshed = await request(`http://${address.host}:${address.port}/native/commands/refresh`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });
    const content = await request(`http://${address.host}:${address.port}/native/commands/content?name=review&token=test-token`);

    expect(directory.body.directory).toBe('/commands');
    expect(updateDirectory.body.result).toEqual({ success: true });
    expect(directories.body.directories).toEqual([{ path: '/commands', commandCount: 1 }]);
    expect(refreshed.body.commands).toEqual([command]);
    expect(content.body.content).toEqual({ content: '# Review\n', filePath: '/commands/review.md' });
    expect(calls).toEqual([['set-directory', '/next-commands']]);
  });

  it('streams command directory change events to browser clients', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
    });
    servers.push(server);
    const address = await server.start();
    const eventPromise = readFirstEvent(
      `http://${address.host}:${address.port}/native/events?token=test-token`,
      'commands:directoryChanged',
    );

    setTimeout(() => {
      server.emitNativeEvent({ type: 'commands:directoryChanged', directoryPath: '/commands' });
    }, 10);

    await expect(eventPromise).resolves.toContain('"directoryPath":"/commands"');
  });

  it('bridges editor focus, replace results, insertion events, and external links', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const calls: unknown[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        setMarkdownEditorFocused: (focused) => {
          calls.push(['focused', focused]);
        },
        replaceSelectedMarkdownTextResult: (result) => {
          calls.push(['replace-result', result]);
        },
        setBrowserLibraryImmersiveDismissable: (dismissable, clientId) => {
          calls.push(['immersive-dismissable', dismissable, clientId]);
        },
        setBrowserLibrarySizeKey: (key, clientId) => {
          calls.push(['size-key', key, clientId]);
        },
        openExternal: (href) => {
          calls.push(['open-external', href]);
          return true;
        },
        pasteIntoCodexInput: (text) => {
          calls.push(['paste-codex', text]);
          return { success: true, delivery: 'native-helper' };
        },
        openFieldTheoryMarkdownInNativeApp: (target) => {
          calls.push(['open-field-theory-native', target]);
          return { success: true };
        },
      },
    });
    servers.push(server);
    const address = await server.start();
    const eventPromise = readFirstEvent(`http://${address.host}:${address.port}/native/events?token=test-token`, 'librarian:insertMarkdownText');

    const focus = await request(`http://${address.host}:${address.port}/native/librarian/editor-focused`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { focused: true },
    });
    const replace = await request(`http://${address.host}:${address.port}/native/librarian/replace-selected-markdown-text-result`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { requestId: 'request-1', success: true },
    });
    const immersiveDismissable = await request(`http://${address.host}:${address.port}/native/librarian/immersive-dismissable`, {
      method: 'POST',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
        'X-FieldTheory-Browser-Client': 'client-one',
      },
      body: { dismissable: true },
    });
    const sizeKey = await request(`http://${address.host}:${address.port}/native/librarian/size-key`, {
      method: 'POST',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
        'X-FieldTheory-Browser-Client': 'client-one',
      },
      body: { key: 'canvas' },
    });
    const open = await request(`http://${address.host}:${address.port}/native/shell/open-external`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { href: 'fieldtheory://wiki/open?path=Plan' },
    });
    const pasteCodex = await request(`http://${address.host}:${address.port}/native/shell/paste-into-codex-input`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { text: 'selected prose' },
    });
    const openNative = await request(`http://${address.host}:${address.port}/native/shell/open-field-theory-markdown`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { target: { kind: 'wiki', path: 'Plan.md', contentMode: 'rendered' } },
    });
    setTimeout(() => server.emitNativeEvent({ type: 'librarian:insertMarkdownText', text: 'hello' }), 10);

    expect(focus.status).toBe(200);
    expect(replace.status).toBe(200);
    expect(immersiveDismissable.status).toBe(200);
    expect(sizeKey.status).toBe(200);
    expect(open.body.success).toBe(true);
    expect(pasteCodex.body.result).toEqual({ success: true, delivery: 'native-helper' });
    expect(openNative.body.result).toEqual({ success: true });
    expect(calls).toEqual([
      ['focused', true],
      ['replace-result', { requestId: 'request-1', success: true }],
      ['immersive-dismissable', true, 'client-one'],
      ['size-key', 'canvas', 'client-one'],
      ['open-external', 'fieldtheory://wiki/open?path=Plan'],
      ['paste-codex', 'selected prose'],
      ['open-field-theory-native', { kind: 'wiki', path: 'Plan.md', contentMode: 'rendered' }],
    ]);
    await expect(eventPromise).resolves.toContain('librarian:insertMarkdownText');
  });

  it('can target editor events to one browser client', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
    });
    servers.push(server);
    const address = await server.start();
    const firstClient = readEventOrTimeout(`http://${address.host}:${address.port}/native/events?token=test-token&clientId=client-one`, 'librarian:insertMarkdownText', 80);
    const secondClient = readEventOrTimeout(`http://${address.host}:${address.port}/native/events?token=test-token&clientId=client-two`, 'librarian:insertMarkdownText', 500);

    setTimeout(() => {
      server.emitNativeEventToClient('client-two', { type: 'librarian:insertMarkdownText', text: 'targeted' });
    }, 30);

    await expect(secondClient).resolves.toContain('targeted');
    await expect(firstClient).resolves.toBeNull();
  });

  it('reports the active browser client for launcher navigation targeting', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const activeClients: Array<[string | null | undefined, string | null | undefined]> = [];
    const clearedClients: Array<string | null | undefined> = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      setActiveClient: (clientId, surface) => activeClients.push([clientId, surface]),
      clearActiveClient: (clientId) => clearedClients.push(clientId),
    });
    servers.push(server);
    const address = await server.start();

    const response = await request(`http://${address.host}:${address.port}/native/client-active`, {
      method: 'POST',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
        'X-FieldTheory-Browser-Client': 'client-one',
      },
      body: { surface: 'library' },
    });
    const commandsResponse = await request(`http://${address.host}:${address.port}/native/client-active`, {
      method: 'POST',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
        'X-FieldTheory-Browser-Client': 'client-one',
      },
      body: { surface: 'commands' },
    });
    const bookmarksResponse = await request(`http://${address.host}:${address.port}/native/client-active`, {
      method: 'POST',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
        'X-FieldTheory-Browser-Client': 'client-one',
      },
      body: { surface: 'bookmarks' },
    });
    const emberResponse = await request(`http://${address.host}:${address.port}/native/client-active`, {
      method: 'POST',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
        'X-FieldTheory-Browser-Client': 'client-one',
      },
      body: { surface: 'ember' },
    });
    const clearResponse = await request(`http://${address.host}:${address.port}/native/client-active`, {
      method: 'DELETE',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
        'X-FieldTheory-Browser-Client': 'client-one',
      },
    });

    expect(response.status).toBe(200);
    expect(commandsResponse.status).toBe(200);
    expect(bookmarksResponse.status).toBe(200);
    expect(emberResponse.status).toBe(200);
    expect(clearResponse.status).toBe(200);
    expect(activeClients).toEqual([
      ['client-one', 'library'],
      ['client-one', 'commands'],
      ['client-one', 'bookmarks'],
      ['client-one', 'ember'],
    ]);
    expect(clearedClients).toEqual(['client-one']);
  });

  it('reports browser client disconnects so native state can be released', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const disconnected: Array<string | null> = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      onClientDisconnected: (clientId) => disconnected.push(clientId),
    });
    servers.push(server);
    const address = await server.start();

    await openEventStreamAndClose(`http://${address.host}:${address.port}/native/events?token=test-token&clientId=client-one`);

    expect(disconnected).toEqual(['client-one']);
  });

  it('bridges bookmark snapshot, actions, collections, and change events', async () => {
    const root = makeTempDir();
    const mediaDir = makeTempDir();
    const outsideDir = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    fs.writeFileSync(path.join(mediaDir, 'bookmark-image.jpg'), 'image-bytes');
    fs.writeFileSync(path.join(outsideDir, 'escaped.jpg'), 'escaped-bytes');
    fs.symlinkSync(path.join(outsideDir, 'escaped.jpg'), path.join(mediaDir, 'escaped-link.jpg'));
    const snapshot = {
      bookmarks: [{ id: 'bookmark-1', text: 'Saved thought', folders: [] }],
      folders: [],
      xLastSyncedAt: null,
    };
    const calls: unknown[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getBookmarks: () => snapshot,
        getBookmarkDataSource: () => ({
          dataDir: '/Users/ada/.fieldtheory/bookmarks',
          bookmarksCachePath: '/Users/ada/.fieldtheory/bookmarks/bookmarks.jsonl',
          mediaDir: '/Users/ada/.fieldtheory/bookmarks/media',
          mediaManifestPath: '/Users/ada/.fieldtheory/bookmarks/media-manifest.json',
          usingLegacyDataDir: false,
        }),
        syncBookmarksIfStale: () => {
          calls.push('sync');
          return { status: 'fresh' };
        },
        getBookmarkAuthors: () => {
          calls.push('authors');
          return [{ handle: 'ada', name: 'Ada' }];
        },
        getAuthorBookmarks: (handle) => {
          calls.push(['author-bookmarks', handle]);
          return [{ id: 'bookmark-2', authorHandle: handle }];
        },
        getTaxonomyBookmarks: (filePaths) => {
          calls.push(['taxonomy', filePaths]);
          return [{ id: 'bookmark-3', filePaths }];
        },
        searchBookmarks: (query) => {
          calls.push(['search', query]);
          return [{ id: 'bookmark-4', query }];
        },
        saveWebBookmarkUrl: (url) => {
          calls.push(['save-url', url]);
          return { success: true, markdownPath: '/tmp/bookmark.md', created: true };
        },
        getActiveWebPageForBookmark: () => {
          calls.push('active-page');
          return { success: true, page: { url: 'https://example.com' } };
        },
        saveActiveWebPageBookmark: () => {
          calls.push('save-active-page');
          return { success: true, page: { url: 'https://example.com' }, created: false };
        },
        invokeBookmark: (id) => {
          calls.push(['invoke', id]);
          return { success: true };
        },
        sendBookmarkToCodex: (id) => {
          calls.push(['send-to-codex', id]);
          return { success: true, delivery: 'native-helper' };
        },
        copyBookmarkForAgent: (id) => {
          calls.push(['copy', id]);
          return { success: true };
        },
        invokeBookmarkAuthorTimeline: (handle) => {
          calls.push(['invoke-author', handle]);
          return { success: true };
        },
        getBookmarkMediaDirectory: () => mediaDir,
        getBookmarkMediaFilePath: (filename) => path.join(mediaDir, path.basename(filename)),
      },
    });
    servers.push(server);
    const address = await server.start();
    const eventPromise = readFirstEvent(`http://${address.host}:${address.port}/native/events?token=test-token`, 'bookmarks:changed');

    const all = await request(`http://${address.host}:${address.port}/native/bookmarks/all?token=test-token`);
    const source = await request(`http://${address.host}:${address.port}/native/bookmarks/source?token=test-token`);
    const sync = await request(`http://${address.host}:${address.port}/native/bookmarks/sync-if-stale`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });
    const authors = await request(`http://${address.host}:${address.port}/native/bookmarks/authors?token=test-token`);
    const authorBookmarks = await request(`http://${address.host}:${address.port}/native/bookmarks/author?token=test-token&handle=ada`);
    const taxonomy = await request(`http://${address.host}:${address.port}/native/bookmarks/taxonomy`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { filePaths: ['/tmp/taxonomy.md', 12] },
    });
    const search = await request(`http://${address.host}:${address.port}/native/bookmarks/search?token=test-token&query=systems`);
    const saveUrl = await request(`http://${address.host}:${address.port}/native/bookmarks/save-web-url`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { url: 'https://example.com/post' },
    });
    const activePage = await request(`http://${address.host}:${address.port}/native/bookmarks/active-web-page?token=test-token`);
    const saveActivePage = await request(`http://${address.host}:${address.port}/native/bookmarks/save-active-web-page`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });
    const invoke = await request(`http://${address.host}:${address.port}/native/bookmarks/invoke`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { id: 'bookmark-1' },
    });
    const sendToCodex = await request(`http://${address.host}:${address.port}/native/bookmarks/send-to-codex`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { id: 'bookmark-1' },
    });
    const copy = await request(`http://${address.host}:${address.port}/native/bookmarks/copy-for-agent`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { id: 'bookmark-1' },
    });
    const invokeAuthor = await request(`http://${address.host}:${address.port}/native/bookmarks/invoke-author-timeline`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { handle: 'ada' },
    });
    const media = await request(`http://${address.host}:${address.port}/native/bookmarks/media/bookmark-image.jpg?token=test-token`);
    const traversal = await request(`http://${address.host}:${address.port}/native/bookmarks/media/..%2Fbookmark-image.jpg?token=test-token`);
    const malformedMedia = await request(`http://${address.host}:${address.port}/native/bookmarks/media/%E0%A4%A?token=test-token`);
    const symlinkEscape = await request(`http://${address.host}:${address.port}/native/bookmarks/media/escaped-link.jpg?token=test-token`);
    setTimeout(() => server.emitNativeEvent({ type: 'bookmarks:changed' }), 10);

    expect(all.body.snapshot).toEqual(snapshot);
    expect(source.body.source).toEqual({
      dataDir: '/Users/ada/.fieldtheory/bookmarks',
      bookmarksCachePath: '/Users/ada/.fieldtheory/bookmarks/bookmarks.jsonl',
      mediaDir: '/Users/ada/.fieldtheory/bookmarks/media',
      mediaManifestPath: '/Users/ada/.fieldtheory/bookmarks/media-manifest.json',
      usingLegacyDataDir: false,
    });
    expect(sync.body.result).toEqual({ status: 'fresh' });
    expect(authors.body.authors).toEqual([{ handle: 'ada', name: 'Ada' }]);
    expect(authorBookmarks.body.bookmarks).toEqual([{ id: 'bookmark-2', authorHandle: 'ada' }]);
    expect(taxonomy.body.bookmarks).toEqual([{ id: 'bookmark-3', filePaths: ['/tmp/taxonomy.md'] }]);
    expect(search.body.bookmarks).toEqual([{ id: 'bookmark-4', query: 'systems' }]);
    expect(saveUrl.body.result).toEqual({ success: true, markdownPath: '/tmp/bookmark.md', created: true });
    expect(activePage.body.result).toEqual({ success: true, page: { url: 'https://example.com' } });
    expect(saveActivePage.body.result).toEqual({ success: true, page: { url: 'https://example.com' }, created: false });
    expect(invoke.body.result).toEqual({ success: true });
    expect(sendToCodex.body.result).toEqual({ success: true, delivery: 'native-helper' });
    expect(copy.body.result).toEqual({ success: true });
    expect(invokeAuthor.body.result).toEqual({ success: true });
    expect(media.status).toBe(200);
    expect(media.rawBody).toBe('image-bytes');
    expect(media.headers['content-type']).toBe('image/jpeg');
    expect(traversal.status).toBe(404);
    expect(malformedMedia.status).toBe(404);
    expect(symlinkEscape.status).toBe(404);
    expect(calls).toEqual([
      'sync',
      'authors',
      ['author-bookmarks', 'ada'],
      ['taxonomy', ['/tmp/taxonomy.md']],
      ['search', 'systems'],
      ['save-url', 'https://example.com/post'],
      'active-page',
      'save-active-page',
      ['invoke', 'bookmark-1'],
      ['send-to-codex', 'bookmark-1'],
      ['copy', 'bookmark-1'],
      ['invoke-author', 'ada'],
    ]);
    await expect(eventPromise).resolves.toContain('bookmarks:changed');
  });

  it('serves bookmark media from the native media directory without a file resolver', async () => {
    const mediaDir = makeTempDir();
    fs.writeFileSync(path.join(mediaDir, 'avatar.jpg'), 'avatar-bytes');
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([makeTempDir()]),
      token: 'test-token',
      nativeBridge: {
        getBookmarkMediaDirectory: () => mediaDir,
      },
    });
    servers.push(server);
    const address = await server.start();

    const media = await request(`http://${address.host}:${address.port}/native/bookmarks/media/avatar.jpg?token=test-token`);
    const traversal = await request(`http://${address.host}:${address.port}/native/bookmarks/media/..%2Favatar.jpg?token=test-token`);

    expect(media.status).toBe(200);
    expect(media.rawBody).toBe('avatar-bytes');
    expect(media.headers['content-type']).toBe('image/jpeg');
    expect(traversal.status).toBe(404);
  });

  it('serves allowed local images for browser-rendered markdown', async () => {
    const root = makeTempDir();
    const imagePath = path.join(root, 'Figure 1.png');
    const textPath = path.join(root, 'notes.txt');
    fs.writeFileSync(imagePath, 'image-bytes');
    fs.writeFileSync(textPath, 'not-image');
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
    });
    servers.push(server);
    const address = await server.start();

    const imageUrl = `ftlocalfile://${imagePath.split('/').map((part, index) => (
      index === 0 ? '' : encodeURIComponent(part)
    )).join('/')}`;
    const textUrl = `ftlocalfile://${textPath.split('/').map((part, index) => (
      index === 0 ? '' : encodeURIComponent(part)
    )).join('/')}`;
    const image = await request(`http://${address.host}:${address.port}/native/local-image?token=test-token&url=${encodeURIComponent(imageUrl)}`);
    const text = await request(`http://${address.host}:${address.port}/native/local-image?token=test-token&url=${encodeURIComponent(textUrl)}`);

    expect(image.status).toBe(200);
    expect(image.rawBody).toBe('image-bytes');
    expect(image.headers['content-type']).toBe('image/png');
    expect(text.status).toBe(404);
  });

  it('bridges Maxwell history, memory, undo/redo, and local command status', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    const calls: unknown[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        listMaxwellRuns: (limit) => {
          calls.push(['list-runs', limit]);
          return [{ runId: 'run-1', status: 'success' }];
        },
        getMaxwellMemory: () => ({ enabled: true, content: 'memory', path: '/tmp/memory.md', maxChars: 12000 }),
        saveMaxwellMemory: (request) => {
          calls.push(['save-memory', request]);
          return { success: true, memory: { enabled: false, content: '', path: '/tmp/memory.md', maxChars: 12000 } };
        },
        cancelMaxwellRun: (runId) => {
          calls.push(['cancel', runId]);
          return { success: true, run: { runId, status: 'cancelled' } };
        },
        undoMaxwellRun: (runId) => {
          calls.push(['undo', runId]);
          return { success: true, run: { runId, status: 'reverted' } };
        },
        redoMaxwellRun: (runId) => {
          calls.push(['redo', runId]);
          return { success: true, run: { runId, status: 'success' } };
        },
      },
    });
    servers.push(server);
    const address = await server.start();
    const eventPromise = readFirstEvent(`http://${address.host}:${address.port}/native/events?token=test-token`, 'commands:localCommandStatus');

    const runs = await request(`http://${address.host}:${address.port}/native/commands/maxwell-runs?token=test-token&limit=12`);
    const memory = await request(`http://${address.host}:${address.port}/native/commands/maxwell-memory?token=test-token`);
    const savedMemory = await request(`http://${address.host}:${address.port}/native/commands/maxwell-memory`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { enabled: false, content: '' },
    });
    const cancel = await request(`http://${address.host}:${address.port}/native/commands/maxwell-run/cancel`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { runId: 'run-1' },
    });
    const undo = await request(`http://${address.host}:${address.port}/native/commands/maxwell-run/undo`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { runId: 'run-1' },
    });
    const redo = await request(`http://${address.host}:${address.port}/native/commands/maxwell-run/redo`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { runId: 'run-1' },
    });
    setTimeout(() => server.emitNativeEvent({
      type: 'commands:localCommandStatus',
      status: { status: 'success', runId: 'run-1' },
    }), 10);

    expect(runs.body.runs).toEqual([{ runId: 'run-1', status: 'success' }]);
    expect(memory.body.memory).toEqual({ enabled: true, content: 'memory', path: '/tmp/memory.md', maxChars: 12000 });
    expect(savedMemory.body.result.success).toBe(true);
    expect(cancel.body.result).toEqual({ success: true, run: { runId: 'run-1', status: 'cancelled' } });
    expect(undo.body.result).toEqual({ success: true, run: { runId: 'run-1', status: 'reverted' } });
    expect(redo.body.result).toEqual({ success: true, run: { runId: 'run-1', status: 'success' } });
    expect(calls).toEqual([
      ['list-runs', 12],
      ['save-memory', { enabled: false, content: '' }],
      ['cancel', 'run-1'],
      ['undo', 'run-1'],
      ['redo', 'run-1'],
    ]);
    await expect(eventPromise).resolves.toContain('commands:localCommandStatus');
  });

  it('bridges active Library launcher actions through the native manager', async () => {
    const root = makeTempDir();
    const calls: string[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        archiveActiveLibraryFile: () => {
          calls.push('archive');
          return { success: true };
        },
        toggleActiveLibraryLineNumbers: () => {
          calls.push('toggle-line-numbers');
          return { success: true };
        },
      },
    });
    servers.push(server);
    const address = await server.start();

    const archive = await request(`http://${address.host}:${address.port}/native/commands/archive-active-library-file`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });
    const toggle = await request(`http://${address.host}:${address.port}/native/commands/toggle-active-line-numbers`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });

    expect(archive.status).toBe(200);
    expect(archive.body.result).toEqual({ success: true });
    expect(toggle.status).toBe(200);
    expect(toggle.body.result).toEqual({ success: true });
    expect(calls).toEqual(['archive', 'toggle-line-numbers']);
  });

  it('bridges command editor directory and CRUD routes to the native manager', async () => {
    const root = makeTempDir();
    const calls: unknown[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        initializeCommands: () => {
          calls.push('initialize');
        },
        getWatchedCommandDirs: () => [{ path: root, displayName: 'Commands' }],
        addWatchedCommandDir: (dirPath) => {
          calls.push(['add-dir', dirPath]);
          return { path: dirPath, displayName: 'Added' };
        },
        removeWatchedCommandDir: (dirPath) => {
          calls.push(['remove-dir', dirPath]);
          return true;
        },
        getDefaultCommandDirectory: () => root,
        createDefaultCommandDirectory: () => root,
        getCommands: () => [{ name: 'write-goal', displayName: 'write-goal', filePath: path.join(root, 'write-goal.md') }],
        getCommandByPath: (filePath) => ({ name: 'write-goal', displayName: 'write-goal', filePath, content: '# Goal\n' }),
        saveCommand: (filePath, content, expectedVersion) => {
          calls.push(['save-command', filePath, content, expectedVersion]);
          return { ok: true, documentVersion: { mtimeMs: 1, size: content.length, sha256: 'saved' } };
        },
        createCommand: (directoryPath, name, content) => {
          calls.push(['create-command', directoryPath, name, content]);
          return { path: path.join(directoryPath, `${name}.md`), name };
        },
        deleteCommand: (filePath) => {
          calls.push(['delete-command', filePath]);
          return true;
        },
        renameCommand: (oldFilePath, newName) => {
          calls.push(['rename-command', oldFilePath, newName]);
          return path.join(path.dirname(oldFilePath), `${newName}.md`);
        },
        shareCommand: (command) => ({ data: { id: 'shared-command', ...(command as Record<string, unknown>) } }),
        unshareCommand: (commandId) => ({ success: commandId === 'shared-command' }),
      },
    });
    servers.push(server);
    const address = await server.start();
    const commandPath = path.join(root, 'write-goal.md');

    const initialize = await request(`http://${address.host}:${address.port}/native/commands/initialize`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });
    const dirs = await request(`http://${address.host}:${address.port}/native/commands/watched-dirs?token=test-token`);
    const addedDir = await request(`http://${address.host}:${address.port}/native/commands/watched-dir`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { dirPath: root },
    });
    const removedDir = await request(`http://${address.host}:${address.port}/native/commands/watched-dir`, {
      method: 'DELETE',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { dirPath: root },
    });
    const defaultDir = await request(`http://${address.host}:${address.port}/native/commands/default-directory?token=test-token`);
    const createdDefaultDir = await request(`http://${address.host}:${address.port}/native/commands/default-directory`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });
    const commands = await request(`http://${address.host}:${address.port}/native/commands/list?token=test-token`);
    const command = await request(`http://${address.host}:${address.port}/native/commands/by-path?token=test-token&path=${encodeURIComponent(commandPath)}`);
    const saved = await request(`http://${address.host}:${address.port}/native/commands/by-path`, {
      method: 'PUT',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { filePath: commandPath, content: '# Saved\n', expectedVersion: { mtimeMs: 0, size: 0, sha256: 'old' } },
    });
    const created = await request(`http://${address.host}:${address.port}/native/commands/by-path`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { directoryPath: root, name: 'new-command', content: '# New\n' },
    });
    const renamed = await request(`http://${address.host}:${address.port}/native/commands/rename`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { oldFilePath: commandPath, newName: 'renamed' },
    });
    const deleted = await request(`http://${address.host}:${address.port}/native/commands/by-path`, {
      method: 'DELETE',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { filePath: commandPath },
    });
    const shared = await request(`http://${address.host}:${address.port}/native/commands/share`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { name: 'write-goal', content: '# Goal\n' },
    });
    const unshared = await request(`http://${address.host}:${address.port}/native/commands/unshare`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { commandId: 'shared-command' },
    });

    expect(initialize.status).toBe(200);
    expect(dirs.body.dirs).toEqual([{ path: root, displayName: 'Commands' }]);
    expect(addedDir.body.dir).toEqual({ path: root, displayName: 'Added' });
    expect(removedDir.body.success).toBe(true);
    expect(defaultDir.body.directory).toBe(root);
    expect(createdDefaultDir.body.directory).toBe(root);
    expect(commands.body.commands[0]).toEqual(expect.objectContaining({ name: 'write-goal' }));
    expect(command.body.command.content).toBe('# Goal\n');
    expect(saved.body.result.ok).toBe(true);
    expect(created.body.command.name).toBe('new-command');
    expect(renamed.body.filePath).toBe(path.join(root, 'renamed.md'));
    expect(deleted.body.success).toBe(true);
    expect(shared.body.result.data.id).toBe('shared-command');
    expect(unshared.body.result.success).toBe(true);
    expect(calls).toEqual([
      'initialize',
      ['add-dir', root],
      ['remove-dir', root],
      ['save-command', commandPath, '# Saved\n', { mtimeMs: 0, size: 0, sha256: 'old' }],
      ['create-command', root, 'new-command', '# New\n'],
      ['rename-command', commandPath, 'renamed'],
      ['delete-command', commandPath],
    ]);
  });

  it('bridges Field Theory sync status for the command shared surface', async () => {
    const root = makeTempDir();
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        getFieldTheorySyncStatus: () => ({
          localEnabled: true,
          authenticated: true,
          serverEnforced: false,
          enabled: true,
          reason: 'enabled',
        }),
      },
    });
    servers.push(server);
    const address = await server.start();

    const response = await request(`http://${address.host}:${address.port}/native/field-theory-sync/status?token=test-token`);

    expect(response.status).toBe(200);
    expect(response.body.status).toEqual({
      localEnabled: true,
      authenticated: true,
      serverEnforced: false,
      enabled: true,
      reason: 'enabled',
    });
  });

  it('bridges agent kickoff start, cancel, progress, and status events', async () => {
    const root = makeTempDir();
    const calls: unknown[] = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      nativeBridge: {
        startAgentKickoff: (args) => {
          calls.push(['start', args]);
          return { ok: true, runId: 'run-1', absPath: '/tmp/Plan.md', model: 'codex' };
        },
        cancelAgentKickoff: (runId) => {
          calls.push(['cancel', runId]);
          return true;
        },
      },
    });
    servers.push(server);
    const address = await server.start();
    const progressEvent = readFirstEvent(`http://${address.host}:${address.port}/native/events?token=test-token`, 'agent:kickoffProgress');
    const statusEvent = readFirstEvent(`http://${address.host}:${address.port}/native/events?token=test-token`, 'agent:kickoffStatus');

    const start = await request(`http://${address.host}:${address.port}/native/agent-kickoff/start`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { absPath: '/tmp/Plan.md', instruction: 'tighten this', model: 'codex' },
    });
    const cancel = await request(`http://${address.host}:${address.port}/native/agent-kickoff/cancel`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { runId: 'run-1' },
    });
    setTimeout(() => {
      server.emitNativeEvent({
        type: 'agent:kickoffProgress',
        event: { runId: 'run-1', absPath: '/tmp/Plan.md', model: 'codex', kind: 'stdout', chunk: 'working' },
      });
      server.emitNativeEvent({
        type: 'agent:kickoffStatus',
        event: { runId: 'run-1', absPath: '/tmp/Plan.md', model: 'codex', status: 'started', message: 'Codex started' },
      });
    }, 10);

    expect(start.body.result).toEqual({ ok: true, runId: 'run-1', absPath: '/tmp/Plan.md', model: 'codex' });
    expect(cancel.body.success).toBe(true);
    expect(calls).toEqual([
      ['start', { absPath: '/tmp/Plan.md', instruction: 'tighten this', model: 'codex' }],
      ['cancel', 'run-1'],
    ]);
    await expect(progressEvent).resolves.toContain('working');
    await expect(statusEvent).resolves.toContain('Codex started');
  });

  it('saves valid writes and rejects stale writes with conflicts', async () => {
    const { address, root } = await startServer();
    const docResponse = await request(`http://${address.host}:${address.port}/doc?token=test-token&rootId=root-1&relPath=Plan.md`);
    const document = docResponse.body.document;

    const saveResponse = await request(`http://${address.host}:${address.port}/doc`, {
      method: 'PUT',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
      },
      body: {
        rootId: 'root-1',
        relPath: 'Plan.md',
        content: '# Updated\n',
        expectedVersion: document.version,
      },
    });

    expect(saveResponse.status).toBe(200);
    expect(fs.readFileSync(path.join(root, 'Plan.md'), 'utf-8')).toBe('# Updated\n');

    const staleResponse = await request(`http://${address.host}:${address.port}/doc`, {
      method: 'PUT',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
      },
      body: {
        rootId: 'root-1',
        relPath: 'Plan.md',
        content: '# Stale\n',
        expectedVersion: document.version,
      },
    });

    expect(staleResponse.status).toBe(409);
    expect(staleResponse.body.result.reason).toBe('conflict');
    expect(fs.readFileSync(path.join(root, 'Plan.md'), 'utf-8')).toBe('# Updated\n');
  });
});

function parseJsonBody(raw: string): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readFirstEvent(url: string, eventName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      method: 'GET',
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : Buffer.from(chunk).toString('utf-8');
        if (raw.includes(`event: ${eventName}`)) {
          req.destroy();
          resolve(raw);
        }
      });
    });
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNRESET' && eventName) return;
      reject(error);
    });
    req.end();
  });
}

async function readEventOrTimeout(url: string, eventName: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    let done = false;
    const req = http.request({
      method: 'GET',
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : Buffer.from(chunk).toString('utf-8');
        if (raw.includes(`event: ${eventName}`)) {
          done = true;
          req.destroy();
          resolve(raw);
        }
      });
    });
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      req.destroy();
      resolve(null);
    }, timeoutMs);
    req.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (error.code === 'ECONNRESET' && done) return;
      reject(error);
    });
    req.end();
  });
}

async function openEventStreamAndClose(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    let connected = false;
    const req = http.request({
      method: 'GET',
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
    }, (res) => {
      res.on('data', () => {
        if (connected) return;
        connected = true;
        req.destroy();
        setTimeout(resolve, 10);
      });
    });
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (connected && error.code === 'ECONNRESET') return;
      reject(error);
    });
    req.end();
  });
}
