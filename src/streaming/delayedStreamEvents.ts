import type { SendCallbacks } from '../hooks/chorus-stream/types';
import type { ConnectorToolDelta } from '../connectors/types';
import { createAbortError, isAbortError, toError } from './internal/streamErrors';

type DelayedStreamEvent =
  | { type: 'text'; chunk: string }
  | { type: 'reasoning'; chunk: string }
  | { type: 'toolDelta'; toolDelta: ConnectorToolDelta };

type ReleaseSchedule = ReturnType<typeof createReleaseSchedule>;
type DelayedEventQueue = ReturnType<typeof createDelayedEventQueue>;
type AbortCancellation = ReturnType<typeof createAbortCancellation>;

function isEmptyChunkEvent(event: DelayedStreamEvent): boolean {
  return (event.type === 'text' || event.type === 'reasoning') && !event.chunk;
}

function remainingDelayMs(startedAt: number, minDelayMs: number): number {
  return Math.max(0, minDelayMs - (Date.now() - startedAt));
}

/**
 * Owns the `minDelayMs` release timer. The timer either settles (release the
 * buffered events) or rejects (caller cancelled / signal aborted). The
 * promise/timer/abort-listener bookkeeping all live here so the delivery
 * pipeline only sees a single `schedule()` -> Promise<void> surface.
 */
function createReleaseSchedule(signal: AbortSignal, onAbort: () => void) {
  let releasePromise: Promise<void> | null = null;
  let resolveRelease: (() => void) | null = null;
  let rejectRelease: ((err: Error) => void) | null = null;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  let abortListener: ((event: Event) => void) | null = null;

  const cleanup = () => {
    if (releaseTimer !== null) {
      clearTimeout(releaseTimer);
      releaseTimer = null;
    }
    if (abortListener) {
      signal.removeEventListener('abort', abortListener);
      abortListener = null;
    }
    resolveRelease = null;
    rejectRelease = null;
  };

  const settle = () => {
    const resolve = resolveRelease;
    cleanup();
    releasePromise = null;
    resolve?.();
  };

  const reject = (err: Error) => {
    const r = rejectRelease;
    cleanup();
    releasePromise = null;
    r?.(err);
  };

  return {
    schedule(waitMs: number) {
      if (!releasePromise) {
        releasePromise = new Promise<void>((resolve, rej) => {
          resolveRelease = resolve;
          rejectRelease = rej;
          abortListener = () => {
            onAbort();
            reject(createAbortError());
          };
          signal.addEventListener('abort', abortListener, { once: true });
          releaseTimer = setTimeout(settle, waitMs);
        });
      }
      return releasePromise;
    },
    /**
     * Resolve the pending schedule promise (if any) and tear down the timer
     * and abort listener. Used by callers that deliver buffered events
     * synchronously before the timer would have fired.
     */
    settle,
    rejectWith: reject,
  };
}

function createReleaseState(minDelayMs: number, startedAt: number) {
  let released = minDelayMs === 0;

  return {
    get released() {
      return released;
    },
    markReleased() {
      released = true;
    },
    shouldDeliverNow() {
      return released || Date.now() - startedAt >= minDelayMs;
    },
    remainingDelay() {
      return remainingDelayMs(startedAt, minDelayMs);
    },
  };
}

function createDelayedEventQueue() {
  let events: DelayedStreamEvent[] = [];

  return {
    push(event: DelayedStreamEvent) {
      events.push(event);
    },
    drain() {
      const drained = events;
      events = [];
      return drained;
    },
    clear() {
      events = [];
    },
    get hasEvents() {
      return events.length > 0;
    },
  };
}

function createAbortCancellation(queue: DelayedEventQueue) {
  let cancelled = false;

  const cancelBufferedWork = () => {
    cancelled = true;
    queue.clear();
  };

  return {
    get cancelled() {
      return cancelled;
    },
    cancelBufferedWork,
    cancelRelease(release: ReleaseSchedule) {
      cancelBufferedWork();
      release.rejectWith(createAbortError());
    },
    throwIfCancelled() {
      if (cancelled) throw createAbortError();
    },
  };
}

function createCallbackDelivery(cb: SendCallbacks, onFailure: (error: Error) => void) {
  let hasFiredOnStart = false;
  let callbackError: Error | null = null;

  let rejectCallbackError!: (err: Error) => void;
  const callbackErrorPromise = new Promise<never>((_, reject) => {
    rejectCallbackError = reject;
  });
  callbackErrorPromise.catch(() => undefined);

  const fail = (err: unknown) => {
    const error = toError(err);
    if (!callbackError) {
      callbackError = error;
      onFailure(error);
      rejectCallbackError(error);
    }
    return callbackError;
  };

  const throwIfFailed = () => {
    if (callbackError) throw callbackError;
  };

  const deliverEvent = (event: DelayedStreamEvent) => {
    // onStart fires once on the first delivered event of ANY type so consumers
    // get the signal even for reasoning-first or tool-only turns that emit no
    // answer text. The first text chunk is passed through; non-text first
    // events pass '' since there is no text content to forward yet.
    if (!hasFiredOnStart) {
      hasFiredOnStart = true;
      cb.onStart?.(event.type === 'text' ? event.chunk : '');
    }

    if (event.type === 'text') {
      cb.onChunk(event.chunk);
      return;
    }

    if (event.type === 'reasoning') {
      cb.onReasoning?.(event.chunk);
      return;
    }

    cb.onToolDelta?.(event.toolDelta);
  };

  const deliverSafely = (deliver: () => void) => {
    try {
      deliver();
    } catch (err) {
      throw fail(err);
    }
  };

  return {
    deliverEvent,
    deliverSafely,
    fail,
    throwIfFailed,
    callbackErrorPromise,
    getCallbackError: () => callbackError,
  };
}

function createBufferedDelivery(args: {
  signal: AbortSignal;
  queue: DelayedEventQueue;
  releaseState: ReturnType<typeof createReleaseState>;
  releaseSchedule: ReleaseSchedule;
  cancellation: AbortCancellation;
  delivery: ReturnType<typeof createCallbackDelivery>;
}) {
  const { signal, queue, releaseState, releaseSchedule, cancellation, delivery } = args;
  let deliveryPromise: Promise<void> | null = null;

  const flushBufferedEvents = () => {
    delivery.throwIfFailed();
    if (cancellation.cancelled || releaseState.released) return;
    releaseState.markReleased();
    for (const event of queue.drain()) delivery.deliverEvent(event);
    releaseSchedule.settle();
  };

  const cancel = () => {
    cancellation.cancelRelease(releaseSchedule);
  };

  const scheduleRelease = () => {
    if (releaseState.released || cancellation.cancelled) return Promise.resolve();

    const wait = releaseState.remainingDelay();
    if (wait <= 0) return Promise.resolve();

    if (signal.aborted) {
      cancel();
      return Promise.reject(createAbortError());
    }

    return releaseSchedule.schedule(wait);
  };

  const scheduleBufferedDelivery = () => {
    if (deliveryPromise) return deliveryPromise;

    deliveryPromise = scheduleRelease()
      .then(() => delivery.deliverSafely(flushBufferedEvents))
      .catch((err: unknown) => {
        if (!isAbortError(err)) delivery.fail(err);
      })
      .finally(() => {
        deliveryPromise = null;
      });

    return deliveryPromise;
  };

  const deliverNow = (event: DelayedStreamEvent) => {
    delivery.deliverSafely(() => {
      if (!releaseState.released) flushBufferedEvents();
      delivery.deliverEvent(event);
    });
  };

  const flushBeforeDone = async () => {
    if (!releaseState.released && queue.hasEvents) await scheduleBufferedDelivery();
    else if (deliveryPromise) await deliveryPromise;
    delivery.throwIfFailed();
    cancellation.throwIfCancelled();
  };

  return {
    deliverNow,
    scheduleBufferedDelivery,
    flushBeforeDone,
    cancel,
  };
}

export function createDelayedChunkEmitter(cb: SendCallbacks, startedAt: number, signal: AbortSignal) {
  const minDelayMs = Math.max(0, cb.minDelayMs ?? 0);
  const queue = createDelayedEventQueue();
  const releaseState = createReleaseState(minDelayMs, startedAt);
  const cancellation = createAbortCancellation(queue);
  const releaseSchedule = createReleaseSchedule(signal, cancellation.cancelBufferedWork);
  const delivery = createCallbackDelivery(cb, (error) => {
    cancellation.cancelBufferedWork();
    releaseSchedule.rejectWith(error);
  });
  const bufferedDelivery = createBufferedDelivery({
    signal,
    queue,
    releaseState,
    releaseSchedule,
    cancellation,
    delivery,
  });

  const handleEvent = (event: DelayedStreamEvent) => {
    delivery.throwIfFailed();
    if (cancellation.cancelled) return;
    if (isEmptyChunkEvent(event)) return;

    if (releaseState.shouldDeliverNow()) {
      bufferedDelivery.deliverNow(event);
      return;
    }

    queue.push(event);
    void bufferedDelivery.scheduleBufferedDelivery();
  };

  return {
    handleChunk: (chunk: string) => handleEvent({ type: 'text', chunk }),
    handleReasoning: (chunk: string) => handleEvent({ type: 'reasoning', chunk }),
    handleToolDelta: (toolDelta: ConnectorToolDelta) => handleEvent({ type: 'toolDelta', toolDelta }),
    flushBeforeDone: bufferedDelivery.flushBeforeDone,
    cancel: bufferedDelivery.cancel,
    callbackErrorPromise: delivery.callbackErrorPromise,
    getCallbackError: delivery.getCallbackError,
  };
}
