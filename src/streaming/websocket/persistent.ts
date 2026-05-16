import type { Message } from '../../types';
import type { WebSocketTransport, WebSocketTransportOptions } from '../createWebSocketTransport';
import { createManagedResponseStream, type ManagedResponseStream } from './managedResponseStream';
import { createAbortError, createClosedBeforeOpenError, encodeSSEDataEvent, safeCloseSocket, toError, webSocketMessageToText } from './shared';

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
