import type { SendCallbacks } from '../hooks/chorus-stream/types';
import type { ConnectorToolDelta } from '../connectors/types';
import { createAbortError, isAbortError, toError } from './internal/streamErrors';

type DelayedStreamEvent =
  | { type: 'text'; chunk: string }
  | { type: 'reasoning'; chunk: string }
  | { type: 'toolDelta'; toolDelta: ConnectorToolDelta };

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

export function createDelayedChunkEmitter(cb: SendCallbacks, startedAt: number, signal: AbortSignal) {
  const minDelayMs = Math.max(0, cb.minDelayMs ?? 0);

  // Mutable state — every change goes through one of the methods below so the
  // invariants ('callbackError is set at most once', 'once cancelled, no
  // further events flow', 'releasePromise/deliveryPromise are settled exactly
  // once') can be checked locally.
  let hasFiredOnStart = false;
  let released = minDelayMs === 0;
  let cancelled = false;
  let bufferedEvents: DelayedStreamEvent[] = [];
  let deliveryPromise: Promise<void> | null = null;
  let callbackError: Error | null = null;

  let rejectCallbackError!: (err: Error) => void;
  const callbackErrorPromise = new Promise<never>((_, reject) => {
    rejectCallbackError = reject;
  });
  callbackErrorPromise.catch(() => undefined);

  const release = createReleaseSchedule(signal, () => {
    cancelled = true;
    bufferedEvents = [];
  });

  const failDelivery = (err: unknown) => {
    const error = toError(err);
    if (!callbackError) {
      callbackError = error;
      cancelled = true;
      bufferedEvents = [];
      release.rejectWith(error);
      rejectCallbackError(error);
    }
    return callbackError;
  };

  const throwIfDeliveryFailed = () => {
    if (callbackError) throw callbackError;
  };

  const throwIfCancelled = () => {
    if (cancelled) throw createAbortError();
  };

  const deliverEvent = (event: DelayedStreamEvent) => {
    if (cancelled) return;

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
      throw failDelivery(err);
    }
  };

  const flushBufferedEvents = () => {
    throwIfDeliveryFailed();
    if (cancelled || released) return;
    released = true;
    const events = bufferedEvents;
    bufferedEvents = [];
    for (const event of events) deliverEvent(event);
    release.settle();
  };

  const cancel = () => {
    cancelled = true;
    bufferedEvents = [];
    release.rejectWith(createAbortError());
  };

  const scheduleRelease = () => {
    if (released || cancelled) return Promise.resolve();

    const wait = Math.max(0, minDelayMs - (Date.now() - startedAt));
    if (wait <= 0) return Promise.resolve();

    if (signal.aborted) {
      cancel();
      return Promise.reject(createAbortError());
    }

    return release.schedule(wait);
  };

  const scheduleBufferedDelivery = () => {
    if (deliveryPromise) return deliveryPromise;

    deliveryPromise = scheduleRelease()
      .then(() => deliverSafely(flushBufferedEvents))
      .catch((err: unknown) => {
        if (!isAbortError(err)) failDelivery(err);
      })
      .finally(() => {
        deliveryPromise = null;
      });

    return deliveryPromise;
  };

  const handleEvent = (event: DelayedStreamEvent) => {
    throwIfDeliveryFailed();
    if (cancelled) return;
    if ((event.type === 'text' || event.type === 'reasoning') && !event.chunk) return;

    if (released || Date.now() - startedAt >= minDelayMs) {
      deliverSafely(() => {
        if (!released) flushBufferedEvents();
        deliverEvent(event);
      });
      return;
    }

    bufferedEvents.push(event);
    void scheduleBufferedDelivery();
  };

  const flushBeforeDone = async () => {
    if (!released && bufferedEvents.length > 0) await scheduleBufferedDelivery();
    else if (deliveryPromise) await deliveryPromise;
    throwIfDeliveryFailed();
    throwIfCancelled();
  };

  return {
    handleChunk: (chunk: string) => handleEvent({ type: 'text', chunk }),
    handleReasoning: (chunk: string) => handleEvent({ type: 'reasoning', chunk }),
    handleToolDelta: (toolDelta: ConnectorToolDelta) => handleEvent({ type: 'toolDelta', toolDelta }),
    flushBeforeDone,
    cancel,
    callbackErrorPromise,
    getCallbackError: () => callbackError,
  };
}
