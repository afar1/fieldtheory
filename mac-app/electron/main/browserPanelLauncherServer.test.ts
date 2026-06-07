import http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserPanelLauncherServer } from './browserPanelLauncherServer';

const servers: BrowserPanelLauncherServer[] = [];

async function request(url: string): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  rawBody: string;
}> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          rawBody: Buffer.concat(chunks).toString('utf8'),
        });
      });
    }).on('error', reject);
  });
}

async function startServer(): Promise<{
  server: BrowserPanelLauncherServer;
  address: { host: string; port: number; url: string };
}> {
  const server = new BrowserPanelLauncherServer({
    port: 0,
    getBrowserHelperAddress: () => ({
      host: '127.0.0.1',
      port: 59971,
      token: 'test-token',
      url: 'http://127.0.0.1:59971/?token=test-token',
    }),
  });
  servers.push(server);
  const address = await server.start();
  return { server, address };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe('BrowserPanelLauncherServer', () => {
  it('redirects stable panel URLs to the current helper panel without adding tokens', async () => {
    const { address } = await startServer();

    const response = await request(`http://${address.host}:${address.port}/panel?kind=library`);

    expect(response.status).toBe(302);
    const location = String(response.headers.location ?? '');
    const redirected = new URL(location);
    expect(redirected.origin).toBe('http://127.0.0.1:59971');
    expect(redirected.pathname).toBe('/panel');
    expect(redirected.searchParams.get('kind')).toBe('library');
    expect(redirected.searchParams.get('token')).toBeNull();
  });

  it('reports health and keeps unknown paths inert', async () => {
    const { address } = await startServer();

    const health = await request(`http://${address.host}:${address.port}/health`);
    const missing = await request(`http://${address.host}:${address.port}/assets/app.js`);

    expect(health.status).toBe(200);
    expect(JSON.parse(health.rawBody)).toEqual({ ok: true });
    expect(missing.status).toBe(404);
  });
});
