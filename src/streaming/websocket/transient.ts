import type { Message } from '../../types';
import type { FormatMessageResult, WebSocketTransport, WebSocketTransportOptions } from '../createWebSocketTransport';
import { createManagedResponseStream } from './managedResponseStream';
import { createAbortError, createClosedBeforeOpenError, encodeSSEDataEvent, normalizeFormatMessageResult, safeCloseSocket, toError, webSocketMessageToText } from './shared';

export function createTransientWebSocketTransport<TMeta = Record<string, unknown>>(
  url: string,
  opts: WebSocketTransportOptions<TMeta> | undefined,
  formatMessage: (text: string, history: Message<TMeta>[]) => FormatMessageResult,
): WebSocketTransport<TMeta> {
  const activeSockets = new Set<WebSocket>();
  const encoder = new TextEncoder();

  const transport = ((text: string, history: Message<TMeta>[], signal: AbortSignal) =>
    new Promise<Response>((resolve, reject) => {
      if (signal.aborted) {
        reject(createAbortError());
        return;
      }

      const ws = new WebSocket(url, opts?.protocols);
      activeSockets.add(ws);
      let resolved = false;
      let settled = false;

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
        activeSockets.delete(ws);
      };

      const safeCloseCurrentSocket = () => safeCloseSocket(ws);
      const responseStream = createManagedResponseStream(() => {
        cleanup();
        safeCloseCurrentSocket();
      });
      responseStream.setCleanup(cleanup);

      const fail = (error: unknown) => {
        const err = toError(error);
        cleanup();
        safeCloseCurrentSocket();
        if (resolved) {
          responseStream.error(err);
          return;
        }
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      function onAbort() {
        fail(createAbortError());
      }

      signal.addEventListener('abort', onAbort, { once: true });

      ws.onopen = () => {
        if (signal.aborted) { safeCloseCurrentSocket(); return; }
        try {
          ws.send(normalizeFormatMessageResult(formatMessage(text, history)).payload);
        } catch (error) {
          fail(error);
          return;
        }
        resolved = true;
        settled = true;
        resolve(new Response(responseStream.body, { status: 200 }));
        opts?.onOpen?.();
      };

      ws.onmessage = (event: MessageEvent) => {
        void webSocketMessageToText(event.data).then(data => {
          opts?.onMessage?.(data, event);
          if (responseStream.closed()) return;
          // Wrap as one SSE event so readSSEStream can parse it downstream.
          // Prefix each line to preserve embedded newlines in the WS payload.
          responseStream.enqueue(encoder.encode(encodeSSEDataEvent(data)));
        }).catch(fail);
      };

      ws.onclose = (event: CloseEvent) => {
        cleanup();
        responseStream.close();
        opts?.onClose?.(event.code, event.reason);
        if (!resolved && !settled) {
          settled = true;
          reject(createClosedBeforeOpenError(event));
        }
      };

      ws.onerror = (event: Event) => {
        fail(new Error('WebSocket connection error'));
        opts?.onError?.(event);
      };
    })) as WebSocketTransport<TMeta>;

  transport.close = (code?: number, reason?: string) => {
    for (const ws of Array.from(activeSockets)) safeCloseSocket(ws, code, reason);
    activeSockets.clear();
  };

  return transport;
}
