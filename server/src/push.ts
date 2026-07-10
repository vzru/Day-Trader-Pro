import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from './types';
import { log, warn } from './util/log';

/**
 * Websocket push channel to the frontend (path /ws). New clients get a
 * full state snapshot, then incremental messages.
 */
export class Push {
  private wss: WebSocketServer;

  constructor(
    server: Server,
    private getSnapshot: () => ServerMessage[],
    private onClientMessage: (msg: ClientMessage) => void,
  ) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      log('push', `client connected (${this.wss.clients.size} total)`);
      for (const msg of this.getSnapshot()) {
        ws.send(JSON.stringify(msg));
      }
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(String(data)) as ClientMessage;
          if (msg && msg.type === 'select' && typeof msg.symbol === 'string') {
            this.onClientMessage(msg);
          }
        } catch {
          warn('push', 'ignoring malformed client message');
        }
      });
      ws.on('error', (e) => warn('push', 'client socket error:', e.message));
    });
  }

  broadcast(msg: ServerMessage): void {
    if (!this.wss.clients.size) return;
    const payload = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }
}
