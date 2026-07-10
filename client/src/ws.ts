import type { ClientMessage, ServerMessage } from './types';

export type WSStatus = 'connecting' | 'open' | 'closed';

export interface WSHandle {
  send: (msg: ClientMessage) => void;
  close: () => void;
}

/**
 * Websocket client with automatic reconnect (exponential backoff, capped,
 * with jitter). Goes through the Vite proxy in dev, same-origin in prod.
 */
export function connectWS(
  onMessage: (msg: ServerMessage) => void,
  onStatus: (status: WSStatus) => void,
): WSHandle {
  let ws: WebSocket | null = null;
  let attempts = 0;
  let closedByUser = false;
  let reconnectTimer: number | undefined;
  const pending: ClientMessage[] = [];

  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  function open(): void {
    if (closedByUser) return;
    onStatus('connecting');
    ws = new WebSocket(url);

    ws.onopen = () => {
      attempts = 0;
      onStatus('open');
      while (pending.length) ws?.send(JSON.stringify(pending.shift()));
    };

    ws.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(ev.data as string) as ServerMessage);
      } catch {
        // malformed frame — ignore
      }
    };

    ws.onclose = () => {
      ws = null;
      if (closedByUser) return;
      onStatus('closed');
      const delay = Math.min(15_000, 1000 * 2 ** attempts) + Math.random() * 500;
      attempts++;
      reconnectTimer = window.setTimeout(open, delay);
    };

    ws.onerror = () => ws?.close();
  }

  open();

  return {
    send(msg) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      else pending.push(msg);
    },
    close() {
      closedByUser = true;
      window.clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
