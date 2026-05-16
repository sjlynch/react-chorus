import type { SendCallbacks } from '../hooks/useChorusStream';
import type { ConnectorToolDelta } from '../connectors/types';

// Local duplicates keep streaming-only imports from pulling UI-owned utility chunks.
function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) return error as Error;
  return new Error(String(error));
}

function isAbortError(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name?: unknown }).name === 'AbortError';
}

function createAbortError(message = 'Aborted'): Error {
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError') as Error;
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

type DelayedStreamEvent =
  | { type: 'text'; chunk: string }
  | { type: 'reasoning'; chunk: string }
  | { type: 'toolDelta'; toolDelta: ConnectorToolDelta };

export function createDelayedChunkEmitter(cb: SendCallbacks, startedAt: number, signal: AbortSignal) {
  const minDelayMs = Math.max(0, cb.minDelayMs ?? 0);
  let hasDeliveredFirstTextChunk = false;
  let released = minDelayMs === 0;
  let cancelled = false;
  let bufferedEvents: DelayedStreamEvent[] = [];
  let releasePromise: Promise<void> | null = null;
  let deliveryPromise: Promise<void> | null = null;
  let callbackError: Error | null = null;
  let rejectCallbackError!: (err: Error) => void;
  let resolveRelease: (() => void) | null = null;
  let rejectRelease: ((err: Error) => void) | null = null;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  let abortListener: ((event: Event) => void) | null = null;

  const callbackErrorPromise = new Promise<never>((_, reject) => {
    rejectCallbackError = reject;
  });
  callbackErrorPromise.catch(() => undefined);

  const cleanupScheduledRelease = () => {
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

  const settleScheduledRelease = () => {
    const resolve = resolveRelease;
    cleanupScheduledRelease();
    releasePromise = null;
    resolve?.();
  };

  const rejectScheduledRelease = (err: Error) => {
    const reject = rejectRelease;
    cleanupScheduledRelease();
    releasePromise = null;
    reject?.(err);
  };

  const failDelivery = (err: unknown) => {
    const error = toError(err);
    if (!callbackError) {
      callbackError = error;
      cancelled = true;
      bufferedEvents = [];
      rejectScheduledRelease(error);
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

  const deliverSafely = (deliver: () => void) => {
    try {
      deliver();
    } catch (err) {
      throw failDelivery(err);
    }
  };

  const deliverEvent = (event: DelayedStreamEvent) => {
    if (cancelled) return;

    if (event.type === 'text') {
      if (!hasDeliveredFirstTextChunk) {
        hasDeliveredFirstTextChunk = true;
        cb.onStart?.(event.chunk);
      }
      cb.onChunk(event.chunk);
      return;
    }

    if (event.type === 'reasoning') {
      cb.onReasoning?.(event.chunk);
      return;
    }

    cb.onToolDelta?.(event.toolDelta);
  };

  const flushBufferedEvents = () => {
    throwIfDeliveryFailed();
    if (cancelled || released) return;
    released = true;
    const events = bufferedEvents;
    bufferedEvents = [];
    for (const event of events) deliverEvent(event);
    settleScheduledRelease();
  };

  const cancel = () => {
    cancelled = true;
    bufferedEvents = [];
    rejectScheduledRelease(createAbortError());
  };

  const scheduleRelease = () => {
    if (released || cancelled) return Promise.resolve();

    const wait = Math.max(0, minDelayMs - (Date.now() - startedAt));
    if (wait <= 0) return Promise.resolve();

    if (signal.aborted) {
      cancel();
      return Promise.reject(createAbortError());
    }

    if (!releasePromise) {
      releasePromise = new Promise<void>((resolve, reject) => {
        resolveRelease = resolve;
        rejectRelease = reject;
        abortListener = () => {
          cancelled = true;
          bufferedEvents = [];
          rejectScheduledRelease(createAbortError());
        };
        signal.addEventListener('abort', abortListener, { once: true });
        releaseTimer = setTimeout(settleScheduledRelease, wait);
      });
    }

    return releasePromise;
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
