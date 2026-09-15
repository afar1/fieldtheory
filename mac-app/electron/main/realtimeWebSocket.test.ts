// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, Server } from 'node:http';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { RealtimeClient } from '@supabase/realtime-js';
import { WebSocketServer } from 'ws';
import { RealtimeWebSocket, realtimeTransport } from './realtimeWebSocket';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('./logger', () => ({ createLogger: () => ({ warn }) }));

let server: Server;
let client: RealtimeClient | undefined;
afterEach(async () => {
  client?.disconnect();
  client = undefined;
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  warn.mockClear();
});
async function listen() {
  server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('RealtimeWebSocket', () => {
  it('handles the real SDK removeChannel race before the handshake completes', async () => {
    const url = await listen();
    client = new RealtimeClient(url, { transport: realtimeTransport, params: { apikey: "local-test" } });
    const channel = client.channel('race').subscribe();
    const socket = client.conn as unknown as RealtimeWebSocket;
    expect(socket.readyState).toBe(RealtimeWebSocket.CONNECTING);
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    await client.removeChannel(channel);
    expect(socket.onerror).toBeNull();
    // No test error listener: only the production transport prevents the crash.
    await closed;
    expect(warn).toHaveBeenCalledWith('WebSocket error:', 'WebSocket was closed before the connection was established');
    expect(client.getChannels()).toHaveLength(0);
  });

  it('still delivers genuine handshake failures to the SDK error handler', async () => {
    const url = await listen();
    server.on('upgrade', (_request, socket) => socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'));
    client = new RealtimeClient(url, { transport: realtimeTransport, params: { apikey: "local-test" } });
    const onError = vi.fn();
    client.channel('failure').subscribe(onError);
    const socket = client.conn as unknown as RealtimeWebSocket;
    await new Promise<void>((resolve) => socket.once('close', () => resolve()));
    expect(onError).toHaveBeenCalledWith('CHANNEL_ERROR', undefined);
    expect(warn).toHaveBeenCalledWith('WebSocket error:', expect.stringContaining('503'));
  });

  it('supports successful connections, messages, and normal closure', async () => {
    const url = await listen();
    const wss = new WebSocketServer({ server });
    wss.on('connection', (socket) => socket.send('hello'));
    const socket = new RealtimeWebSocket(url);
    const message = once(socket, 'message');
    await once(socket, 'open');
    expect(String((await message)[0])).toBe('hello');
    const closed = once(socket, 'close');
    socket.close(1000);
    await closed;
    expect(warn).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });
});
