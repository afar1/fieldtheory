import http from 'http';
import type { BrowserHelperServerAddress } from './browserHelperServer';
import { DEFAULT_BROWSER_PANEL_LAUNCHER_PORT } from './browserLibraryUrl';

export type BrowserPanelLauncherServerAddress = {
  host: string;
  port: number;
  url: string;
};

export type BrowserPanelLauncherServerOptions = {
  getBrowserHelperAddress: () => BrowserHelperServerAddress;
  host?: string;
  port?: number;
};

export class BrowserPanelLauncherServer {
  private readonly getBrowserHelperAddress: () => BrowserHelperServerAddress;
  private readonly host: string;
  private readonly port: number;
  private server: http.Server | null = null;

  constructor(options: BrowserPanelLauncherServerOptions) {
    this.getBrowserHelperAddress = options.getBrowserHelperAddress;
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? DEFAULT_BROWSER_PANEL_LAUNCHER_PORT;
  }

  async start(): Promise<BrowserPanelLauncherServerAddress> {
    if (this.server) return this.address();

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.port, this.host, () => {
        this.server?.off('error', reject);
        resolve();
      });
    });

    return this.address();
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  address(): BrowserPanelLauncherServerAddress {
    if (!this.server) {
      return { host: this.host, port: this.port, url: `http://${this.host}:${this.port}/panel` };
    }
    const address = this.server.address();
    const port = typeof address === 'object' && address ? address.port : this.port;
    return { host: this.host, port, url: `http://${this.host}:${port}/panel` };
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const parsed = new URL(req.url ?? '/', `http://${req.headers.host ?? `${this.host}:${this.port}`}`);

    if (req.method === 'GET' && parsed.pathname === '/health') {
      this.writeJson(res, 200, { ok: true });
      return;
    }

    if (req.method !== 'GET' || (parsed.pathname !== '/' && parsed.pathname !== '/panel')) {
      this.writeJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }

    const helperAddress = this.getBrowserHelperAddress();
    const destination = new URL(`http://${helperAddress.host}:${helperAddress.port}/panel`);
    for (const [key, value] of parsed.searchParams.entries()) {
      destination.searchParams.append(key, value);
    }

    res.writeHead(302, {
      Location: destination.toString(),
      'Cache-Control': 'no-store',
    });
    res.end();
  }

  private writeJson(res: http.ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }
}
