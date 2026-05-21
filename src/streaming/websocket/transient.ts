import type { Message } from '../../types';
import type { FormatMessageResult, WebSocketTransport, WebSocketTransportOptions } from '../createWebSocketTransport';
import { createManagedResponseStream } from './managedResponseStream';
import { createAbnormalCloseError, createAbortError, createClosedBeforeOpenError, createTransportClosedError, encodeSSEDataEvent, isNormalCloseCode, normalizeFormatMessageResult, safeCloseSocket, toError, webSocketMessageToText } from './shared';

// Per-send handler that settles an in-flight send with an error: it errors the
// response stream if the send already resolved, otherwise rejects the outer
// promise. `closeCode`/`closeReason` are forwarded to the socket close frame.
type TransientFailHandler = (error: unknown, closeCode?: number, closeReason?: string) => void;

// Local duplicate of `isChorusDevMode` from `src/utils/devMode.ts`. Importing
// the shared helper here would bundle the transport-only subpath with the
// session/utils chunk and blow its tight size budget — the same trade-off
// `persistent.ts` and `createFetchSSETransport.ts` document for these chunks.
function isTransientWebSocketDevMode(): boolean {
  try {
    return typeof process !== 'undefined' && typeof process.env !== 'undefined' && process.env.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

// Warn at most once per process when `correlate` is supplied without
// `persistent: true`. Correlation routing only exists in persistent mode; a
// transient send owns its own socket, so `correlate` is never consulted and the
// `correlationId` half of a `formatMessage` result is discarded. Mirrors
// `createFetchSSETransport`'s one-time warning for a `formatBody` dropped on a
// body-less GET/HEAD request — both surface a silently-inert option in dev.
let warnedCorrelateIgnoredInTransientMode = false;

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

  if (opts?.correlate && !warnedCorrelateIgnoredInTransientMode && isTransientWebSocketDevMode()) {
    warnedCorrelateIgnoredInTransientMode = true;
    console.warn(
      `[react-chorus] createWebSocketTransport: a \`correlate\` callback was provided `
        + `without \`persistent: true\`. Correlation routing only applies in persistent `
        + `mode — in transient mode each send opens its own WebSocket, so \`correlate\` is `
        + `never consulted and any \`correlationId\` returned by \`formatMessage\` is `
        + `discarded. Pass \`persistent: true\` to use correlation, or drop \`correlate\` `
        + `for transient sends. This warning fires once.`,
    );
  }

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
          // `onMessage` fires *after* the `closed()` guard so transient mode
          // mirrors "messages delivered to the stream": once the consumer
          // cancels the reader (which closes the stream and the socket) a late
          // in-flight frame is neither enqueued nor observed. This keeps
          // token-counting/telemetry consumers in sync with what reached the UI.
          // Persistent mode deliberately differs — see `persistent.ts`, where
          // `onMessage` observes raw socket frames including server-pushed ones.
          if (responseStream.closed()) return;
          opts?.onMessage?.(data, event);
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
