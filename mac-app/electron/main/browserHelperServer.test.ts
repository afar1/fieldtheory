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
    const traversal = await request(`http://${address.host}:${address.port}/assets/../browserHelperServer.ts?token=test-token`);

    expect(html.status).toBe(200);
    expect(html.rawBody).toContain('app.js');
    expect(asset.status).toBe(200);
    expect(asset.rawBody).toContain('window.loaded');
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

  it('serves hidden folders from the native bridge and persists updates through it', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    let hiddenFolders = ['scratchpad'];
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
      body: { folderId: 'entries', hidden: true },
    });

    expect(listResponse.body.hiddenFolders).toEqual(['scratchpad']);
    expect(updateResponse.body.hiddenFolders).toEqual(['scratchpad', 'entries']);
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
      },
    });
    servers.push(server);
    const address = await server.start();

    const availability = await request(`http://${address.host}:${address.port}/native/shared-files/availability?token=test-token`);
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
    expect(status.body.status).toEqual({ shared: true, sharedId: 'shared:Plan.md', revision: 2 });
    expect(share.body.status).toEqual({ shared: true, sharedId: 'shared-1', revision: 1 });
    expect(update.body.result).toEqual({ ok: true, revision: 2 });
    expect(presence.body.users).toEqual([{ userId: 'user-1', initials: 'FT' }]);
    expect(sync.body.result).toEqual({ written: 1, removed: 0, created: 0, errors: [] });
    expect(unshare.body.success).toBe(true);
    expect(calls).toEqual([
      ['share', { filePath: '/tmp/Plan.md', title: 'Plan' }],
      ['update', 'shared-1', '# Plan\n', 1, '/tmp/Plan.md'],
      ['presence', 'shared-1'],
      ['sync'],
      ['unshare', '/tmp/Plan.md'],
    ]);
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
        openExternal: (href) => {
          calls.push(['open-external', href]);
          return true;
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
    const open = await request(`http://${address.host}:${address.port}/native/shell/open-external`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { href: 'fieldtheory://wiki/open?path=Plan' },
    });
    setTimeout(() => server.emitNativeEvent({ type: 'librarian:insertMarkdownText', text: 'hello' }), 10);

    expect(focus.status).toBe(200);
    expect(replace.status).toBe(200);
    expect(open.body.success).toBe(true);
    expect(calls).toEqual([
      ['focused', true],
      ['replace-result', { requestId: 'request-1', success: true }],
      ['open-external', 'fieldtheory://wiki/open?path=Plan'],
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
    const activeClients: Array<string | null | undefined> = [];
    const server = new BrowserHelperServer({
      service: new BrowserHelperDocumentService([root]),
      token: 'test-token',
      setActiveClient: (clientId) => activeClients.push(clientId),
    });
    servers.push(server);
    const address = await server.start();

    const response = await request(`http://${address.host}:${address.port}/native/client-active`, {
      method: 'POST',
      headers: {
        'X-FieldTheory-Browser-Token': 'test-token',
        'X-FieldTheory-Browser-Client': 'client-one',
      },
    });

    expect(response.status).toBe(200);
    expect(activeClients).toEqual(['client-one']);
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

  it('bridges bookmark snapshot, sync, copy, and change events', async () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
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
        syncBookmarksIfStale: () => {
          calls.push('sync');
          return { status: 'fresh' };
        },
        copyBookmarkForAgent: (id) => {
          calls.push(['copy', id]);
          return { success: true };
        },
      },
    });
    servers.push(server);
    const address = await server.start();
    const eventPromise = readFirstEvent(`http://${address.host}:${address.port}/native/events?token=test-token`, 'bookmarks:changed');

    const all = await request(`http://${address.host}:${address.port}/native/bookmarks/all?token=test-token`);
    const sync = await request(`http://${address.host}:${address.port}/native/bookmarks/sync-if-stale`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
    });
    const copy = await request(`http://${address.host}:${address.port}/native/bookmarks/copy-for-agent`, {
      method: 'POST',
      headers: { 'X-FieldTheory-Browser-Token': 'test-token' },
      body: { id: 'bookmark-1' },
    });
    setTimeout(() => server.emitNativeEvent({ type: 'bookmarks:changed' }), 10);

    expect(all.body.snapshot).toEqual(snapshot);
    expect(sync.body.result).toEqual({ status: 'fresh' });
    expect(copy.body.result).toEqual({ success: true });
    expect(calls).toEqual(['sync', ['copy', 'bookmark-1']]);
    await expect(eventPromise).resolves.toContain('bookmarks:changed');
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
