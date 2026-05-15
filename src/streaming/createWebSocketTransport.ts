import type { Message } from '../types';
import type { Transport } from '../hooks/useChorusStream';

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

type ManagedResponseStream = {
  readonly body: ReadableStream<Uint8Array>;
  readonly closed: () => boolean;
  readonly enqueue: (chunk: Uint8Array) => void;
  readonly close: () => void;
  readonly error: (error: unknown) => void;
  readonly setCleanup: (fn: () => void) => void;
};

type OpenWaiter = {
  resolve: (ws: WebSocket) => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  onAbort: () => void;
};

const webSocketTransportFinalizer = typeof FinalizationRegistry === 'undefined'
  ? null
  : new FinalizationRegistry<() => void>((close) => close());

function encodeSSEDataEvent(data: string) {
  return `${data.split(/\r\n|\r|\n/).map(line => `data: ${line}`).join('\n')}\n\n`;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

function createAbortError() {
  return new DOMException('Aborted', 'AbortError');
}

function createClosedBeforeOpenError(event: CloseEvent) {
  const reason = event.reason ? `: ${event.reason}` : '';
  return new Error(`WebSocket closed before opening (code ${event.code}${reason})`);
}

function safeCloseSocket(ws: WebSocket, code?: number, reason?: string) {
  try {
    if (code === undefined) ws.close();
    else ws.close(code, reason);
  } catch {}
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

function createManagedResponseStream(onCancel: () => void): ManagedResponseStream {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let streamClosed = false;
  let cleanup = () => {};

  const close = () => {
    if (streamClosed) return;
    streamClosed = true;
    cleanup();
    try { controller?.close(); } catch {}
  };

  const error = (err: unknown) => {
    if (streamClosed) return;
    streamClosed = true;
    cleanup();
    try { controller?.error(toError(err)); } catch {}
  };

  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      if (!streamClosed) {
        streamClosed = true;
        cleanup();
      }
      onCancel();
    },
  });

  return {
    body,
    closed: () => streamClosed,
    enqueue: (chunk: Uint8Array) => {
      if (streamClosed) return;
      try { controller?.enqueue(chunk); } catch {}
    },
    close,
    error,
    setCleanup: (fn: () => void) => {
      cleanup = fn;
    },
  };
}

function createTransientWebSocketTransport<TMeta = Record<string, unknown>>(
  url: string,
  opts: WebSocketTransportOptions<TMeta> | undefined,
  formatMessage: (text: string, history: Message<TMeta>[]) => string,
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
          ws.send(formatMessage(text, history));
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

function createPersistentWebSocketTransport<TMeta = Record<string, unknown>>(
  url: string,
  opts: WebSocketTransportOptions<TMeta> | undefined,
  formatMessage: (text: string, history: Message<TMeta>[]) => string,
): WebSocketTransport<TMeta> {
  const activeStreams = new Set<ManagedResponseStream>();
  const openWaiters = new Set<OpenWaiter>();
  const encoder = new TextEncoder();
  let socket: WebSocket | null = null;
  let socketState: 'idle' | 'connecting' | 'open' | 'closed' = 'idle';

  const removeOpenWaiter = (waiter: OpenWaiter) => {
    openWaiters.delete(waiter);
    waiter.signal.removeEventListener('abort', waiter.onAbort);
  };

  const rejectOpenWaiters = (error: Error) => {
    for (const waiter of Array.from(openWaiters)) {
      removeOpenWaiter(waiter);
      waiter.reject(error);
    }
  };

  const resolveOpenWaiters = (ws: WebSocket) => {
    for (const waiter of Array.from(openWaiters)) {
      removeOpenWaiter(waiter);
      waiter.resolve(ws);
    }
  };

  const closeActiveStreams = () => {
    for (const stream of Array.from(activeStreams)) {
      activeStreams.delete(stream);
      stream.close();
    }
  };

  const errorActiveStreams = (error: unknown) => {
    for (const stream of Array.from(activeStreams)) {
      activeStreams.delete(stream);
      stream.error(error);
    }
  };

  const closePersistentSocket = (code?: number, reason?: string) => {
    const ws = socket;
    if (!ws) return;
    socket = null;
    socketState = 'closed';
    rejectOpenWaiters(new Error('WebSocket transport closed'));
    closeActiveStreams();
    safeCloseSocket(ws, code, reason);
  };

  const handleSocketFailure = (ws: WebSocket, error: unknown) => {
    const err = toError(error);
    if (socket === ws) {
      socket = null;
      socketState = 'closed';
    }
    rejectOpenWaiters(err);
    errorActiveStreams(err);
    safeCloseSocket(ws);
  };

  const getOrCreateSocket = () => {
    if (socket && (socketState === 'connecting' || socketState === 'open')) return socket;

    const ws = new WebSocket(url, opts?.protocols);
    socket = ws;
    socketState = 'connecting';

    ws.onopen = () => {
      if (socket !== ws) return;
      socketState = 'open';
      resolveOpenWaiters(ws);
      opts?.onOpen?.();
    };

    ws.onmessage = (event: MessageEvent) => {
      void webSocketMessageToText(event.data).then(data => {
        opts?.onMessage?.(data, event);
        if (!activeStreams.size) return;
        const chunk = encoder.encode(encodeSSEDataEvent(data));
        for (const stream of Array.from(activeStreams)) stream.enqueue(chunk);
      }).catch(error => handleSocketFailure(ws, error));
    };

    ws.onclose = (event: CloseEvent) => {
      const closedBeforeOpening = socket === ws && socketState === 'connecting';
      if (socket === ws) {
        socket = null;
        socketState = 'closed';
      }
      rejectOpenWaiters(closedBeforeOpening ? createClosedBeforeOpenError(event) : new Error('WebSocket closed'));
      closeActiveStreams();
      opts?.onClose?.(event.code, event.reason);
    };

    ws.onerror = (event: Event) => {
      handleSocketFailure(ws, new Error('WebSocket connection error'));
      opts?.onError?.(event);
    };

    return ws;
  };

  const waitForOpenSocket = (signal: AbortSignal) => {
    const ws = getOrCreateSocket();
    if (socket === ws && socketState === 'open') return Promise.resolve(ws);

    return new Promise<WebSocket>((resolve, reject) => {
      const waiter: OpenWaiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          removeOpenWaiter(waiter);
          reject(createAbortError());
        },
      };

      if (signal.aborted) {
        reject(createAbortError());
        return;
      }

      openWaiters.add(waiter);
      signal.addEventListener('abort', waiter.onAbort, { once: true });
    });
  };

  const transport = ((text: string, history: Message<TMeta>[], signal: AbortSignal) =>
    new Promise<Response>((resolve, reject) => {
      if (signal.aborted) {
        reject(createAbortError());
        return;
      }

      let settled = false;
      const responseStream = createManagedResponseStream(() => cleanupStream());

      const cleanupStream = () => {
        signal.removeEventListener('abort', onAbort);
        activeStreams.delete(responseStream);
      };

      const settleReject = (error: unknown) => {
        const err = toError(error);
        cleanupStream();
        responseStream.error(err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      const settleResolve = () => {
        if (!settled) {
          settled = true;
          resolve(new Response(responseStream.body, { status: 200 }));
        }
      };

      function onAbort() {
        settleReject(createAbortError());
      }

      responseStream.setCleanup(cleanupStream);
      activeStreams.add(responseStream);
      signal.addEventListener('abort', onAbort, { once: true });

      try {
        void waitForOpenSocket(signal).then(ws => {
          if (signal.aborted) throw createAbortError();
          const payload = formatMessage(text, history);
          try {
            ws.send(payload);
          } catch (error) {
            handleSocketFailure(ws, error);
            throw error;
          }
          if (signal.aborted) throw createAbortError();
          settleResolve();
        }).catch(settleReject);
      } catch (error) {
        settleReject(error);
      }
    })) as WebSocketTransport<TMeta>;

  transport.close = closePersistentSocket;
  webSocketTransportFinalizer?.register(transport, closePersistentSocket);

  return transport;
}

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
