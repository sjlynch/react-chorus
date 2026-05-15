import type { Message } from '../types';
import type { Transport } from '../hooks/useChorusStream';

export interface WebSocketTransportOptions<TMeta = Record<string, unknown>> {
  /** WebSocket sub-protocols forwarded to the WebSocket constructor. */
  protocols?: string | string[];
  /** Called after the WebSocket opens, in addition to resolving the transport response. */
  onOpen?: () => void;
  /** Called when the WebSocket closes, in addition to ending the response stream. */
  onClose?: (code: number, reason: string) => void;
  /** Called when the WebSocket reports an error, in addition to rejecting/erroring the transport. */
  onError?: (event: Event) => void;
  /**
   * Serialize the outgoing request.
   * Defaults to `JSON.stringify({ prompt, history })`, matching the fetch SSE transport.
   * `history` includes the current user turn; `prompt` is a convenience copy.
   */
  formatMessage?: (text: string, history: Message<TMeta>[]) => string;
}

function encodeSSEDataEvent(data: string) {
  return `${data.split(/\r\n|\r|\n/).map(line => `data: ${line}`).join('\n')}\n\n`;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

function isArrayBufferLike(data: unknown): data is ArrayBuffer {
  return typeof data === 'object' && data !== null && typeof (data as ArrayBuffer).byteLength === 'number' && typeof (data as ArrayBuffer).slice === 'function';
}

async function webSocketMessageToText(data: unknown): Promise<string> {
  if (typeof data === 'string') return data;
  if (isArrayBufferLike(data)) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
  throw new Error('WebSocket message data must be a string, Blob, ArrayBuffer, or typed array');
}

/**
 * Creates a Transport backed by a native WebSocket connection.
 *
 * Each incoming WS message is treated as one SSE payload so the rest of the
 * Chorus pipeline (connector extraction, chunk callbacks) works unchanged.
 * The server should send one message per token/chunk in the same JSON format
 * that an SSE server would put in a `data:` line.
 *
 * The connection is opened fresh for each call and closed when the stream ends,
 * when the connector reports a done sentinel, or when the AbortSignal fires.
 *
 * @example
 * ```tsx
 * const transport = createWebSocketTransport('wss://api.example.com/chat');
 * ```
 */
export function createWebSocketTransport<TMeta = Record<string, unknown>>(
  url: string,
  opts?: WebSocketTransportOptions<TMeta>,
): Transport<TMeta> {
  const formatMessage =
    opts?.formatMessage ??
    ((text: string, history: Message<TMeta>[]) => JSON.stringify({ prompt: text, history }));

  return (text: string, history: Message<TMeta>[], signal: AbortSignal) =>
    new Promise<Response>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const ws = new WebSocket(url, opts?.protocols);
      const encoder = new TextEncoder();
      let streamController: ReadableStreamDefaultController<Uint8Array>;
      let resolved = false;
      let settled = false;
      let streamClosed = false;

      const cleanup = () => signal.removeEventListener('abort', onAbort);

      const safeCloseSocket = () => {
        try { ws.close(); } catch {}
      };

      const fail = (error: unknown) => {
        const err = toError(error);
        cleanup();
        safeCloseSocket();
        if (resolved) {
          if (!streamClosed) {
            streamClosed = true;
            try { streamController.error(err); } catch {}
          }
          return;
        }
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      const body = new ReadableStream<Uint8Array>({
        start(c) {
          streamController = c;
        },
        cancel() {
          streamClosed = true;
          cleanup();
          safeCloseSocket();
        },
      });

      function onAbort() {
        fail(new DOMException('Aborted', 'AbortError'));
      }

      signal.addEventListener('abort', onAbort, { once: true });

      ws.onopen = () => {
        if (signal.aborted) { safeCloseSocket(); return; }
        try {
          ws.send(formatMessage(text, history));
        } catch (error) {
          fail(error);
          return;
        }
        resolved = true;
        settled = true;
        resolve(new Response(body, { status: 200 }));
        opts?.onOpen?.();
      };

      ws.onmessage = (event: MessageEvent) => {
        void webSocketMessageToText(event.data).then(data => {
          if (streamClosed) return;
          // Wrap as one SSE event so readSSEStream can parse it downstream.
          // Prefix each line to preserve embedded newlines in the WS payload.
          streamController.enqueue(encoder.encode(encodeSSEDataEvent(data)));
        }).catch(fail);
      };

      ws.onclose = (event: CloseEvent) => {
        cleanup();
        if (!streamClosed) {
          streamClosed = true;
          try { streamController?.close(); } catch {}
        }
        opts?.onClose?.(event.code, event.reason);
        if (!resolved && !settled) {
          settled = true;
          const reason = event.reason ? `: ${event.reason}` : '';
          reject(new Error(`WebSocket closed before opening (code ${event.code}${reason})`));
        }
      };

      ws.onerror = (event: Event) => {
        const err = new Error('WebSocket connection error');
        fail(err);
        opts?.onError?.(event);
      };
    });
}
