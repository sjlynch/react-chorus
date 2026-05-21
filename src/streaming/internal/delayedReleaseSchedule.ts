import { createAbortError } from './streamErrors';

function remainingDelayMs(startedAt: number, minDelayMs: number): number {
  return Math.max(0, minDelayMs - (Date.now() - startedAt));
}

/**
 * Owns the `minDelayMs` release timer. The timer either settles (release the
 * buffered events) or rejects (caller cancelled / signal aborted). The
 * promise/timer/abort-listener bookkeeping all live here so the delivery
 * pipeline only sees a single `schedule()` -> Promise<void> surface.
 */
export function createReleaseSchedule(signal: AbortSignal, onAbort: () => void) {
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

export type ReleaseSchedule = ReturnType<typeof createReleaseSchedule>;

export function createReleaseState(minDelayMs: number, startedAt: number) {
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

export type ReleaseState = ReturnType<typeof createReleaseState>;
