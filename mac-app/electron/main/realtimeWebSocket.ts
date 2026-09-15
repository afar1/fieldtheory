import WebSocket from 'ws';
import type { WebSocketLikeConstructor } from '@supabase/realtime-js';
import { createLogger } from './logger';

const log = createLogger('Realtime');

export class RealtimeWebSocket extends WebSocket {
  constructor(address: string | URL, protocols?: string | string[], options?: WebSocket.ClientOptions) {
    super(address, protocols, options);
    // Supabase clears onerror after close(), before ws emits the CONNECTING
    // cancellation error. This listener survives teardown without replacing
    // Supabase's handler while the connection is active.
    this.on('error', (error: Error) => {
      log.warn('WebSocket error:', error.message);
    });
  }
}

// ws implements the browser socket API, but its event target types differ.
export const realtimeTransport = RealtimeWebSocket as unknown as WebSocketLikeConstructor;
