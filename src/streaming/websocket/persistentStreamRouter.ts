import { createManagedResponseStream, type ManagedResponseStream } from './managedResponseStream';
import { encodeSSEDataEvent } from './shared';

type PersistentStreamRouterOptions = {
  hasCorrelate: () => boolean;
  correlateFrame: (frame: string) => string | null | undefined;
  isDevMode: () => boolean;
};

export type PersistentStreamRegistration = {
  stream: ManagedResponseStream;
  cleanup: () => void;
  registerCorrelationId: (correlationId: string | null | undefined) => void;
};

export type PersistentStreamRouter = {
  createStream: (onCleanup: () => void) => PersistentStreamRegistration;
  warnIfOverlappingWithoutCorrelation: () => void;
  enqueueFrame: (data: string) => void;
  closeAll: () => void;
  errorAll: (error: unknown) => void;
};

const OVERLAP_WARNING = '[react-chorus] createWebSocketTransport: a second send started on a persistent WebSocket while a previous response was still streaming. Without a `correlate` callback every inbound frame is broadcast to every active response stream, so the same payload will be duplicated into every active assistant message. Provide `correlate` (and have `formatMessage` return `{ payload, correlationId }`) so inbound frames are routed only to the request that started them. This warning fires once per transport instance.';

export function createPersistentStreamRouter(options: PersistentStreamRouterOptions): PersistentStreamRouter {
  const activeStreams = new Set<ManagedResponseStream>();
  const streamCorrelationIds = new Map<ManagedResponseStream, string>();
  const encoder = new TextEncoder();
  let warnedAboutOverlap = false;

  const removeActiveStream = (stream: ManagedResponseStream) => {
    activeStreams.delete(stream);
    streamCorrelationIds.delete(stream);
  };

  const createStream = (onCleanup: () => void) => {
    let cleanup = () => {};
    const stream = createManagedResponseStream(() => cleanup());
    cleanup = () => {
      onCleanup();
      removeActiveStream(stream);
    };

    stream.setCleanup(cleanup);
    activeStreams.add(stream);

    return {
      stream,
      cleanup,
      registerCorrelationId: (correlationId: string | null | undefined) => {
        if (correlationId != null && activeStreams.has(stream)) {
          streamCorrelationIds.set(stream, correlationId);
        }
      },
    };
  };

  const broadcast = (chunk: Uint8Array) => {
    for (const stream of Array.from(activeStreams)) stream.enqueue(chunk);
  };

  const enqueueFrame = (data: string) => {
    if (!activeStreams.size) return;
    const chunk = encoder.encode(encodeSSEDataEvent(data));

    if (options.hasCorrelate()) {
      let id: string | null | undefined;
      try { id = options.correlateFrame(data); } catch { id = null; }
      if (id != null) {
        for (const [stream, cid] of streamCorrelationIds) {
          if (cid === id && activeStreams.has(stream)) stream.enqueue(chunk);
        }
        return;
      }
    }

    broadcast(chunk);
  };

  const closeAll = () => {
    for (const stream of Array.from(activeStreams)) {
      removeActiveStream(stream);
      stream.close();
    }
  };

  const errorAll = (error: unknown) => {
    for (const stream of Array.from(activeStreams)) {
      removeActiveStream(stream);
      stream.error(error);
    }
  };

  const warnIfOverlappingWithoutCorrelation = () => {
    if (!activeStreams.size || options.hasCorrelate() || warnedAboutOverlap || !options.isDevMode()) return;
    warnedAboutOverlap = true;
    console.warn(OVERLAP_WARNING);
  };

  return {
    createStream,
    warnIfOverlappingWithoutCorrelation,
    enqueueFrame,
    closeAll,
    errorAll,
  };
}
