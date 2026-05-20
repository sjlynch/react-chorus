import type { Message } from '../../types';
import type { FormatMessageResult, WebSocketTransport, WebSocketTransportOptions } from '../createWebSocketTransport';
import { createManagedResponseStream } from './managedResponseStream';
import { createAbnormalCloseError, createAbortError, createClosedBeforeOpenError, createTransportClosedError, encodeSSEDataEvent, isNormalCloseCode, normalizeFormatMessageResult, safeCloseSocket, toError, webSocketMessageToText } from './shared';

// Per-send handler that settles an in-flight send with an error: it errors the
// response stream if the send already resolved, otherwise rejects the outer
// promise. `closeCode`/`closeReason` are forwarded to the socket close frame.
type TransientFailHandler = (error: unknown, closeCode?: number, closeReason?: string) => void;

export function createTransientWebSocketTransport<TMeta = Record<string, unknown>>(
  url: string,
  opts: WebSocketTransportOptions<TMeta> | undefined,
  formatMessage: (text: string, history: Message<TMeta>[]) => FormatMessageResult,
): WebSocketTransport<TMeta> {
  // Each in-flight send registers its `fail` handler here, keyed by socket, so
  // `transport.close()` can settle every active send with an explicit
  // transport-closed error instead of leaving the socket to close as a clean EOF.
  const activeSends = new Map<WebSocket, TransientFailHandler>();
  const encoder = new TextEncoder();

  const transport = ((text: string, history: Message<TMeta>[], signal: AbortSignal) =>
    new Promise<Response>((resolve, reject) => {
      if (signal.aborted) {
        reject(createAbortError());
        return;
      }

      const ws = new WebSocket(url, opts?.protocols);
      let resolved = false;
      let settled = false;

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
        activeSends.delete(ws);
      };

      const safeCloseCurrentSocket = (code?: number, reason?: string) => safeCloseSocket(ws, code, reason);
      const responseStream = createManagedResponseStream(() => {
        cleanup();
        safeCloseCurrentSocket();
      });
      responseStream.setCleanup(cleanup);

      const fail: TransientFailHandler = (error, closeCode, closeReason) => {
        const err = toError(error);
        cleanup();
        safeCloseCurrentSocket(closeCode, closeReason);
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
      activeSends.set(ws, fail);

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
        if (resolved && !isNormalCloseCode(event.code)) {
          responseStream.error(createAbnormalCloseError(event));
        } else {
          responseStream.close();
        }
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

  // A client-initiated close is *not* a clean end-of-stream: unlike a server
  // close (code 1000 → done), the response was still streaming. Surface an
  // explicit transport-closed error to every in-flight send so a reader
  // mid-stream rejects instead of seeing a silent `done` (a truncated message).
  transport.close = (code?: number, reason?: string) => {
    for (const fail of Array.from(activeSends.values())) {
      fail(createTransportClosedError(code, reason), code, reason);
    }
    activeSends.clear();
  };

  return transport;
}
