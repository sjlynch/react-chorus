import React from 'react';
import { useLatestRef } from './useLatestRef';

export function useRAFQueue(flushCallback: (queued: string) => void) {
  const chunkQueueRef = React.useRef<string[]>([]);
  const rafIdRef = React.useRef<number | null>(null);
  const flushCallbackRef = useLatestRef(flushCallback);

  const flushQueue = React.useCallback(() => {
    const q = chunkQueueRef.current;
    if (q.length === 0) return;
    const add = q.join('');
    q.length = 0;
    flushCallbackRef.current(add);
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

  const cancelPending = React.useCallback((flushPending = false) => {
    if (flushPending) flushQueue();

    if (rafIdRef.current != null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = null;
    if (!flushPending) chunkQueueRef.current.length = 0;
  }, [flushQueue]);

  React.useEffect(() => () => cancelPending(false), [cancelPending]);

  return { enqueue, cancelPending };
}
