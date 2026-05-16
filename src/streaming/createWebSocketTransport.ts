import type { Message } from '../types';
import type { Transport } from '../hooks/useChorusStream';
import { createPersistentWebSocketTransport } from './websocket/persistent';
import { createTransientWebSocketTransport } from './websocket/transient';

export interface WebSocketTransportOptions<TMeta = Record<string, unknown>> {
  /** WebSocket sub-protocols forwarded to the WebSocket constructor. */
  protocols?: string | string[];
  /**
   * Keep one WebSocket open across sends.
   *
   * In persistent mode the socket is opened on the first send and reused until
   * it closes, the returned transport's `close()` method is called, or the
   * transport is garbage-collected in runtimes that support FinalizationRegistry.
   */
  persistent?: boolean;
  /** Called when a real WebSocket connection opens. */
  onOpen?: () => void;
  /** Called when a real WebSocket connection closes. */
  onClose?: (code: number, reason: string) => void;
  /** Called when the WebSocket reports an error, in addition to rejecting/erroring the transport. */
  onError?: (event: Event) => void;
  /**
   * Receives every decoded WebSocket message before it is wrapped as an SSE
   * payload. In persistent mode this also observes server-pushed messages when
   * no send response stream is currently active.
   */
  onMessage?: (data: string, event: MessageEvent) => void;
  /**
   * Serialize the outgoing request.
   * Defaults to `JSON.stringify({ prompt, history })`, matching the fetch SSE transport.
   * `history` includes the current user turn; `prompt` is a convenience copy.
   */
  formatMessage?: (text: string, history: Message<TMeta>[]) => string;
}

export type WebSocketTransport<TMeta = Record<string, unknown>> = Transport<TMeta> & {
  /** Close any currently open WebSocket owned by this transport. */
  close: (code?: number, reason?: string) => void;
};

/**
 * Creates a Transport backed by a native WebSocket connection.
 *
 * Each incoming WS message is treated as one SSE payload so the rest of the
 * Chorus pipeline (connector extraction, chunk callbacks) works unchanged.
 * The server should send one message per token/chunk in the same JSON format
 * that an SSE server would put in a `data:` line.
 *
 * By default the connection is opened fresh for each call and closed when the
 * stream ends, when the connector reports a done sentinel, or when the
 * AbortSignal fires.
 *
 * Pass `{ persistent: true }` to open one socket on the first send and keep it
 * open across sends. Persistent mode does not add reconnect/backoff or
 * request/response correlation; your server/client protocol must provide those
 * semantics when multiple requests or pushed messages can overlap. End each
 * response with a connector-specific done sentinel (or cancel the response
 * body) so the current stream can finish while the socket remains open. Call
 * `transport.close()` when the persistent connection is no longer needed.
 *
 * @example
 * ```tsx
 * const transport = createWebSocketTransport('wss://api.example.com/chat');
 * ```
 */
export function createWebSocketTransport<TMeta = Record<string, unknown>>(
  url: string,
  opts?: WebSocketTransportOptions<TMeta>,
): WebSocketTransport<TMeta> {
  const formatMessage =
    opts?.formatMessage ??
    ((text: string, history: Message<TMeta>[]) => JSON.stringify({ prompt: text, history }));

  return opts?.persistent
    ? createPersistentWebSocketTransport(url, opts, formatMessage)
    : createTransientWebSocketTransport(url, opts, formatMessage);
}
