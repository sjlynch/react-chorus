import type { Message } from '../../types';
import type { FormatMessageResult, WebSocketTransport, WebSocketTransportOptions } from '../createWebSocketTransport';
import { createManagedResponseStream, type ManagedResponseStream } from './managedResponseStream';
import { createAbnormalCloseError, createAbortError, createClosedBeforeOpenError, createTransportClosedError, encodeSSEDataEvent, isNormalCloseCode, normalizeFormatMessageResult, safeCloseSocket, toError, webSocketMessageToText } from './shared';

// Local duplicate of `isChorusDevMode` from `src/utils/devMode.ts`. Importing
// the shared helper here would bundle the transport-only subpath with the
// session/utils chunk and blow its tight size budget (the README documents this
// subpath at a few kB). Same trade-off the CLAUDE.md notes for ChatWindow.
function isPersistentWebSocketDevMode(): boolean {
  try {
    return typeof process !== 'undefined' && typeof process.env !== 'undefined' && process.env.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

type OpenWaiter = {
  resolve: (ws: WebSocket) => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  onAbort: () => void;
};

const webSocketTransportFinalizer = typeof FinalizationRegistry === 'undefined'
  ? null
  : new FinalizationRegistry<() => void>((close) => close());

export function createPersistentWebSocketTransport<TMeta = Record<string, unknown>>(
  url: string,
  opts: WebSocketTransportOptions<TMeta> | undefined,
  formatMessage: (text: string, history: Message<TMeta>[]) => FormatMessageResult,
): WebSocketTransport<TMeta> {
  const activeStreams = new Set<ManagedResponseStream>();
  const streamCorrelationIds = new Map<ManagedResponseStream, string>();
  const openWaiters = new Set<OpenWaiter>();
  const encoder = new TextEncoder();
  let socket: WebSocket | null = null;
  let socketState: 'idle' | 'connecting' | 'open' | 'closed' = 'idle';
  let warnedAboutOverlap = false;

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

  const removeActiveStream = (stream: ManagedResponseStream) => {
    activeStreams.delete(stream);
    streamCorrelationIds.delete(stream);
  };

  const closeActiveStreams = () => {
    for (const stream of Array.from(activeStreams)) {
      removeActiveStream(stream);
      stream.close();
    }
  };

  const errorActiveStreams = (error: unknown) => {
    for (const stream of Array.from(activeStreams)) {
      removeActiveStream(stream);
      stream.error(error);
    }
  };

  const closePersistentSocket = (code?: number, reason?: string) => {
    const ws = socket;
    if (!ws) return;
    socket = null;
    socketState = 'closed';
    rejectOpenWaiters(new Error('WebSocket transport closed'));
    // A client-initiated close is *not* a clean end-of-stream: unlike a server
    // close (code 1000 → done), any response still streaming was truncated.
    // Error the active streams so a reader mid-stream rejects instead of seeing
    // a silent `done`. A genuine server-side normal-close EOF is still handled
    // as a clean close in `ws.onclose`.
    errorActiveStreams(createTransportClosedError(code, reason));
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

        if (opts?.correlate) {
          let id: string | null | undefined;
          try { id = opts.correlate(data); } catch { id = null; }
          if (id != null) {
            for (const [stream, cid] of streamCorrelationIds) {
              if (cid === id && activeStreams.has(stream)) stream.enqueue(chunk);
            }
            return;
          }
        }

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
      if (isNormalCloseCode(event.code)) {
        closeActiveStreams();
      } else {
        errorActiveStreams(createAbnormalCloseError(event));
      }
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
        removeActiveStream(responseStream);
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

      if (activeStreams.size > 0 && !opts?.correlate && !warnedAboutOverlap && isPersistentWebSocketDevMode()) {
        warnedAboutOverlap = true;
        console.warn(
          '[react-chorus] createWebSocketTransport: a second send started on a persistent WebSocket while a previous response was still streaming. Without a `correlate` callback every inbound frame is broadcast to every active response stream, so the same payload will be duplicated into every active assistant message. Provide `correlate` (and have `formatMessage` return `{ payload, correlationId }`) so inbound frames are routed only to the request that started them. This warning fires once per transport instance.',
        );
      }

      responseStream.setCleanup(cleanupStream);
      activeStreams.add(responseStream);
      signal.addEventListener('abort', onAbort, { once: true });

      try {
        void waitForOpenSocket(signal).then(ws => {
          if (signal.aborted) throw createAbortError();
          const { payload, correlationId } = normalizeFormatMessageResult(formatMessage(text, history));
          if (correlationId != null && activeStreams.has(responseStream)) {
            streamCorrelationIds.set(responseStream, correlationId);
          }
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
