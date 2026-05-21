import type { Message } from '../types';
import type { Transport } from '../hooks/useChorusStream';
import { createPersistentWebSocketTransport } from './websocket/persistent';
import { createTransientWebSocketTransport } from './websocket/transient';

export type FormatMessageResult = string | { payload: string; correlationId?: string | null };

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
   * Receives each decoded WebSocket message before it is wrapped as an SSE
   * payload.
   *
   * In transient mode this mirrors what the response stream receives: it fires
   * only for frames actually delivered to the active stream. Frames that arrive
   * after the consumer cancels the reader (which closes the stream and the
   * socket) are not observed, so token-counting/telemetry consumers stay in
   * sync with what reached the UI.
   *
   * In persistent mode this observes raw socket frames, including server-pushed
   * messages that arrive when no send response stream is currently active.
   */
  onMessage?: (data: string, event: MessageEvent) => void;
  /**
   * Serialize the outgoing request.
   *
   * Return a string payload (default behaviour) or `{ payload, correlationId }`
   * to register the active response stream under a correlation id. In
   * persistent mode the paired `correlate` callback can then route each inbound
   * frame back to the request that started it instead of broadcasting to every
   * active stream.
   *
   * Defaults to `JSON.stringify({ prompt, history })`, matching the fetch SSE transport.
   * `history` includes the current user turn; `prompt` is a convenience copy.
   */
  formatMessage?: (text: string, history: Message<TMeta>[]) => FormatMessageResult;
  /**
   * Route inbound frames to a specific active request in persistent mode.
   *
   * Receives each decoded WebSocket frame and returns the correlation id that
   * `formatMessage` registered for the request that produced it. Frames whose
   * id matches an active stream are enqueued to that stream only; frames whose
   * id matches no active stream are dropped. Return `null` (or `undefined`) to
   * fall through to the legacy fan-out broadcast for that frame (e.g. for
   * server-pushed messages that aren't request responses).
   *
   * Only consulted in persistent mode. Without this callback every inbound
   * frame is broadcast to every active response stream, which duplicates
   * payloads when sends overlap. Providing `correlate` without `persistent:
   * true` has no effect — transient sends each own their own socket — and logs
   * a one-time dev-mode warning so the silently-inert option is not missed.
   */
  correlate?: (frame: string) => string | null | undefined;
}

export type WebSocketTransport<TMeta = Record<string, unknown>> = Transport<TMeta> & {
  /**
   * Close any open WebSocket owned by this transport.
   *
   * A client-initiated close is treated as truncation, not completion: any send
   * still in flight is settled with a transport-closed error — its outer promise
   * rejects if it has not resolved yet, otherwise the response body reader
   * rejects on the next `read()`. This is deliberately different from the server
   * closing the socket normally (code 1000), which ends the active stream as a
   * clean `done`. Use `close()` for teardown (unmount, hot-reload) — not as a
   * way to end an in-flight response.
   *
   * `code`/`reason` are forwarded to the WebSocket close frame.
   */
  close: (code?: number, reason?: string) => void;
};

/**
 * Creates a Transport backed by a native WebSocket connection.
 *
 * Each incoming WS message is treated as one SSE payload so the rest of the
 * Chorus pipeline (connector extraction, chunk callbacks) works unchanged.
 * The server should send one message per token/chunk carrying the *raw payload
 * value only* — exactly the JSON (or text) an SSE server would place AFTER the
 * `data: ` prefix on a `data:` line, never a pre-framed SSE event.
 *
 * The transport prefixes `data: ` to every line of each WS message itself, so
 * do NOT build WS messages with `formatSSEEvent`/`encodeSSEEvent` from
 * `react-chorus/server`: an already-`data:`-framed string would be
 * double-wrapped (`data: data: {...}`) and the connector would receive a
 * literal `data: {...}` string as its payload. Those SSE framing helpers are
 * for HTTP SSE proxy routes only — send the unframed payload over WebSockets.
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
  const formatMessage: (text: string, history: Message<TMeta>[]) => FormatMessageResult =
    opts?.formatMessage ??
    ((text: string, history: Message<TMeta>[]) => JSON.stringify({ prompt: text, history }));

  return opts?.persistent
    ? createPersistentWebSocketTransport(url, opts, formatMessage)
    : createTransientWebSocketTransport(url, opts, formatMessage);
}
