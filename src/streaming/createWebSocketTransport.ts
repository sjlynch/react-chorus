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

      const body = new ReadableStream<Uint8Array>({
        start(c) {
          streamController = c;
        },
        cancel() {
          ws.close();
        },
      });

      const cleanup = () => signal.removeEventListener('abort', onAbort);

      const onAbort = () => {
        ws.close();
        if (resolved) {
          try { streamController.error(new DOMException('Aborted', 'AbortError')); } catch {}
        } else {
          reject(new DOMException('Aborted', 'AbortError'));
        }
      };

      signal.addEventListener('abort', onAbort, { once: true });

      ws.onopen = () => {
        if (signal.aborted) { ws.close(); return; }
        ws.send(formatMessage(text, history));
        resolved = true;
        resolve(new Response(body, { status: 200 }));
        opts?.onOpen?.();
      };

      ws.onmessage = (event: MessageEvent) => {
        const data = typeof event.data === 'string' ? event.data : '';
        // Wrap as an SSE event so readSSEStream can parse it downstream.
        streamController.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      ws.onclose = (event: CloseEvent) => {
        cleanup();
        try { streamController?.close(); } catch {}
        opts?.onClose?.(event.code, event.reason);
      };

      ws.onerror = (event: Event) => {
        cleanup();
        const err = new Error('WebSocket connection error');
        if (resolved) {
          try { streamController.error(err); } catch {}
        } else {
          reject(err);
        }
        opts?.onError?.(event);
      };
    });
}
