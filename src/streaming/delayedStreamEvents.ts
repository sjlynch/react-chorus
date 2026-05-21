import type { SendCallbacks } from '../hooks/chorus-stream/types';
import type { ConnectorToolDelta } from '../connectors/types';
import {
  createAbortCancellation,
  createDelayedEventQueue,
  isEmptyChunkEvent,
} from './internal/delayedEventQueue';
import type { DelayedStreamEvent } from './internal/delayedEventQueue';
import { createReleaseSchedule, createReleaseState } from './internal/delayedReleaseSchedule';
import { createBufferedDelivery, createCallbackDelivery } from './internal/delayedCallbackDelivery';

/**
 * Buffers the first text/reasoning/tool events for `minDelayMs`, then releases
 * them to the callbacks. This is the only public surface; the release timer,
 * event queue, abort cancellation, and callback delivery/error helpers live in
 * `./internal/delayed*` modules.
 */
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
