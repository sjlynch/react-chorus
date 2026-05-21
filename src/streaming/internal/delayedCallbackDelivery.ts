import type { SendCallbacks } from '../../hooks/chorus-stream/types';
import { createAbortError, isAbortError, toError } from './streamErrors';
import type {
  AbortCancellation,
  DelayedEventQueue,
  DelayedStreamEvent,
} from './delayedEventQueue';
import type { ReleaseSchedule, ReleaseState } from './delayedReleaseSchedule';

export function createCallbackDelivery(cb: SendCallbacks, onFailure: (error: Error) => void) {
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

export function createBufferedDelivery(args: {
  signal: AbortSignal;
  queue: DelayedEventQueue;
  releaseState: ReleaseState;
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
    // `cancellation.cancelled` is only set by the release-timer abort listener;
    // an abort that lands after `minDelayMs` elapsed (timer settled, listener
    // removed) with nothing buffered leaves that flag clear. Check the signal
    // directly so a late abort during finalize still surfaces to the caller.
    if (signal.aborted) throw createAbortError();
  };

  return {
    deliverNow,
    scheduleBufferedDelivery,
    flushBeforeDone,
    cancel,
  };
}
