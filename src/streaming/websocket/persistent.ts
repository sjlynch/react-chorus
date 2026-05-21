import type { Message } from '../../types';
import type { FormatMessageResult, WebSocketTransport, WebSocketTransportOptions } from '../createWebSocketTransport';
import { createOpenWaiterManager } from './openWaiters';
import { createPersistentStreamRouter } from './persistentStreamRouter';
import { createAbnormalCloseError, createAbortError, createClosedBeforeOpenError, createTransportClosedError, isNormalCloseCode, normalizeFormatMessageResult, safeCloseSocket, toError, webSocketMessageToText } from './shared';

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

const webSocketTransportFinalizer = typeof FinalizationRegistry === 'undefined'
  ? null
  : new FinalizationRegistry<() => void>((close) => close());

export function createPersistentWebSocketTransport<TMeta = Record<string, unknown>>(
  url: string,
  opts: WebSocketTransportOptions<TMeta> | undefined,
  formatMessage: (text: string, history: Message<TMeta>[]) => FormatMessageResult,
): WebSocketTransport<TMeta> {
  const openWaiters = createOpenWaiterManager();
  const streamRouter = createPersistentStreamRouter({
    hasCorrelate: () => Boolean(opts?.correlate),
    correlateFrame: (frame) => opts?.correlate?.(frame),
    isDevMode: isPersistentWebSocketDevMode,
  });
  let socket: WebSocket | null = null;
  let socketState: 'idle' | 'connecting' | 'open' | 'closed' = 'idle';

  const closePersistentSocket = (code?: number, reason?: string) => {
    const ws = socket;
    if (!ws) return;
    socket = null;
    socketState = 'closed';
    openWaiters.reject(new Error('WebSocket transport closed'));
    // A client-initiated close is *not* a clean end-of-stream: unlike a server
    // close (code 1000 → done), any response still streaming was truncated.
    // Error the active streams so a reader mid-stream rejects instead of seeing
    // a silent `done`. A genuine server-side normal-close EOF is still handled
    // as a clean close in `ws.onclose`.
    streamRouter.errorAll(createTransportClosedError(code, reason));
    safeCloseSocket(ws, code, reason);
  };

  const handleSocketFailure = (ws: WebSocket, error: unknown) => {
    const err = toError(error);
    if (socket === ws) {
      socket = null;
      socketState = 'closed';
    }
    openWaiters.reject(err);
    streamRouter.errorAll(err);
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
      openWaiters.resolve(ws);
      opts?.onOpen?.();
    };

    ws.onmessage = (event: MessageEvent) => {
      void webSocketMessageToText(event.data).then(data => {
        opts?.onMessage?.(data, event);
        streamRouter.enqueueFrame(data);
      }).catch(error => handleSocketFailure(ws, error));
    };

    ws.onclose = (event: CloseEvent) => {
      const closedBeforeOpening = socket === ws && socketState === 'connecting';
      if (socket === ws) {
        socket = null;
        socketState = 'closed';
      }
      openWaiters.reject(closedBeforeOpening ? createClosedBeforeOpenError(event) : new Error('WebSocket closed'));
      if (isNormalCloseCode(event.code)) {
        streamRouter.closeAll();
      } else {
        streamRouter.errorAll(createAbnormalCloseError(event));
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

    return openWaiters.wait(signal);
  };

  const transport = ((text: string, history: Message<TMeta>[], signal: AbortSignal) =>
    new Promise<Response>((resolve, reject) => {
      if (signal.aborted) {
        reject(createAbortError());
        return;
      }

      let settled = false;
      streamRouter.warnIfOverlappingWithoutCorrelation();
      const responseRegistration = streamRouter.createStream(() => {
        signal.removeEventListener('abort', onAbort);
      });
      const responseStream = responseRegistration.stream;
      const cleanupStream = responseRegistration.cleanup;

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

      signal.addEventListener('abort', onAbort, { once: true });

      try {
        void waitForOpenSocket(signal).then(ws => {
          if (signal.aborted) throw createAbortError();
          const { payload, correlationId } = normalizeFormatMessageResult(formatMessage(text, history));
          responseRegistration.registerCorrelationId(correlationId);
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
