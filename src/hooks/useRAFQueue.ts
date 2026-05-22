import React from 'react';
import { useLatestRef } from './useLatestRef';

export function useRAFQueue(flushCallback: (queued: string, isUnmountFlush: boolean) => void) {
  const chunkQueueRef = React.useRef<string[]>([]);
  const rafIdRef = React.useRef<number | null>(null);
  const flushCallbackRef = useLatestRef(flushCallback);

  const flushQueue = React.useCallback((isUnmountFlush = false) => {
    const q = chunkQueueRef.current;
    if (q.length === 0) return;
    const add = q.join('');
    q.length = 0;
    flushCallbackRef.current(add, isUnmountFlush);
  }, [flushCallbackRef]);

  const enqueue = React.useCallback((chunk: string) => {
    chunkQueueRef.current.push(chunk);
    if (rafIdRef.current != null) return;

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        flushQueue();
      });
      return;
    }

    flushQueue();
  }, [flushQueue]);

  const cancelPending = React.useCallback((flushPending = false, isUnmountFlush = false) => {
    if (flushPending) flushQueue(isUnmountFlush);

    if (rafIdRef.current != null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = null;
    if (!flushPending) chunkQueueRef.current.length = 0;
  }, [flushQueue]);

  // On unmount, flush synchronously instead of discarding: if a chunk was enqueued
  // (via onChunk/appendAssistant) but the next RAF hasn't fired yet, dropping it would
  // leave the in-memory message — and any subsequent persistence write — ending mid-token.
  // The flush is tagged as an unmount flush so the callback can route it into
  // persistence only: a controlled host's `onChange` (or the uncontrolled
  // `setInternalMsgs`) must not be invoked after the component has torn down.
  //
  // It runs as a layout effect so the flush lands in the commit phase, ahead of
  // passive-effect cleanups — notably `useChorusPersistence`'s own unmount flush of
  // its debounced write. That ordering lets the buffered token upgrade the pending
  // persistence write in place; otherwise the stale pre-token snapshot is written
  // first and the completed-token write chains behind it on the async write queue,
  // so a synchronous post-unmount read of storage still sees the mid-token text.
  React.useLayoutEffect(() => () => cancelPending(true, true), [cancelPending]);

  return { enqueue, cancelPending };
}
