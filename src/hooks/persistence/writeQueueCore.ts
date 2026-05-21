import React from 'react';
import { isPromiseLike } from '../../utils/async';

/**
 * Lets other effects (notably cross-tab `storage` listeners) coordinate with
 * in-flight local writes so an external update cannot clobber a write that is
 * still settling (lost update).
 */
export interface WriteCoordination {
  /** True while a local write is executing or awaiting its async adapter. */
  isWritePending: () => boolean;
  /** Resolves once the writes currently on the chain have fully settled. */
  whenWriteSettles: () => Promise<void>;
}

/**
 * The minimum the write-queue core needs from a queued write: a `version`
 * snapshot that gates `onWriteSuccess`. Everything else — storage target,
 * serialized payload, remove flag, … — is opaque to the core and interpreted
 * only by the owning hook's `performWrite` / `reportWriteError` callbacks.
 */
export interface QueuedWrite {
  /** Version snapshot captured when the write was queued; gates `onWriteSuccess`. */
  version: number;
}

export interface WriteQueueScheduleOptions {
  /** Flush immediately instead of arming the debounce timer. */
  flushNow: boolean;
  /** Debounce window in milliseconds; `<= 0` flushes immediately. */
  debounceMs: number;
}

interface UseWriteQueueCoreOptions<TWrite extends QueuedWrite> {
  /** Performs the storage IO for a queued write. May be synchronous or return a promise. */
  performWrite: (write: TWrite) => void | Promise<void>;
  /** Reports a thrown/rejected write failure for a queued write. */
  reportWriteError: (rawError: unknown, write: TWrite) => void;
  /** Invoked with the write's `version` once it resolves cleanly. */
  onWriteSuccess: (writeVersion: number) => void;
  /**
   * When true a *synchronous* write still settles through a microtask: the
   * queue keeps reporting `isWritePending()` true until the next microtask
   * boundary. Message persistence needs this so a `pagehide` flush issued in
   * the same task as a just-flushed write chains behind it through
   * `runWriteImmediately` instead of racing it. The conversation index has no
   * immediate page-lifecycle path and settles synchronous writes eagerly
   * (false), so a cross-tab event arriving right after a local write is applied
   * at once rather than deferred a microtask. Async writes settle on their
   * adapter promise either way.
   */
  deferSyncSettle: boolean;
}

export interface WriteQueueCore<TWrite extends QueuedWrite> {
  /** The write awaiting its debounce window / flush, if any. */
  peekPending: () => TWrite | null;
  /** Replace the pending write, then flush now or (re)arm the debounce timer. */
  schedule: (write: TWrite, options: WriteQueueScheduleOptions) => void;
  /** Flush the pending write (if any) through the serialized write chain. */
  flush: () => void;
  /**
   * Page-lifecycle flush: writes synchronously on the fast path when no async
   * write is in flight so the value lands before the page is frozen.
   */
  flushForPageLifecycle: () => void;
  writeCoordination: WriteCoordination;
}

/**
 * Generic serialized/debounced write queue shared by message persistence and
 * conversation-index persistence. It owns the pending-write ref, debounce
 * timer, async write chain, in-flight tracking, and the `WriteCoordination`
 * cross-tab lost-update guard. The owning hook supplies `performWrite` (the
 * actual storage IO), `reportWriteError`, and `onWriteSuccess`, and builds the
 * opaque `TWrite` payload it passes to `schedule`.
 */
export function useWriteQueueCore<TWrite extends QueuedWrite>({
  performWrite,
  reportWriteError,
  onWriteSuccess,
  deferSyncSettle,
}: UseWriteQueueCoreOptions<TWrite>): WriteQueueCore<TWrite> {
  const pendingWriteRef = React.useRef<TWrite | null>(null);
  const writeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeChainRef = React.useRef(Promise.resolve());
  const writeInFlightRef = React.useRef(false);
  const asyncWriteInFlightRef = React.useRef(false);

  // Runs the storage IO and resolves the write's success/error. Synchronous
  // adapters report success/failure inline; async adapters return the settled
  // promise so callers can chain behind it.
  const executeWrite = React.useCallback((write: TWrite): void | Promise<void> => {
    try {
      const result = performWrite(write);
      if (isPromiseLike<void>(result)) {
        asyncWriteInFlightRef.current = true;
        return Promise.resolve(result).then(
          () => { onWriteSuccess(write.version); },
          writeError => { reportWriteError(writeError, write); },
        );
      }
      onWriteSuccess(write.version);
    } catch (writeError) {
      reportWriteError(writeError, write);
    }
    return undefined;
  }, [performWrite, onWriteSuccess, reportWriteError]);

  const runQueuedWrite = React.useCallback((write: TWrite): Promise<void> => {
    writeInFlightRef.current = true;
    asyncWriteInFlightRef.current = false;
    const result = executeWrite(write);
    // `deferSyncSettle` keeps a synchronous write marked in-flight until the
    // next microtask; an async write always settles on its adapter promise.
    if (deferSyncSettle || isPromiseLike<void>(result)) {
      return Promise.resolve(result).finally(() => {
        writeInFlightRef.current = false;
        asyncWriteInFlightRef.current = false;
      });
    }
    writeInFlightRef.current = false;
    asyncWriteInFlightRef.current = false;
    return Promise.resolve();
  }, [executeWrite, deferSyncSettle]);

  const enqueueWrite = React.useCallback((write: TWrite): Promise<void> => {
    const tracked = writeInFlightRef.current
      ? writeChainRef.current.then(() => runQueuedWrite(write), () => runQueuedWrite(write))
      : runQueuedWrite(write);
    writeChainRef.current = tracked;
    tracked.catch(() => {});
    return tracked;
  }, [runQueuedWrite]);

  const runWriteImmediately = React.useCallback((write: TWrite): Promise<void> => {
    // If a prior write is still settling, route this write through the shared
    // chain via enqueueWrite. Replacing writeChainRef here would orphan that
    // prior write — its resolution/error would never propagate, its finally
    // would later clobber the in-flight flags, and a subsequent flush could
    // interleave with it.
    if (writeInFlightRef.current) return enqueueWrite(write);

    // Fast path: the write chain is idle. Perform the write now — synchronously
    // for sync storage so it lands before the page is frozen on pagehide.
    try {
      const result = performWrite(write);
      if (isPromiseLike<void>(result)) {
        writeInFlightRef.current = true;
        asyncWriteInFlightRef.current = true;
        const tracked = Promise.resolve(result)
          .then(
            () => { onWriteSuccess(write.version); },
            writeError => reportWriteError(writeError, write),
          )
          .finally(() => {
            writeInFlightRef.current = false;
            asyncWriteInFlightRef.current = false;
          });
        writeChainRef.current = tracked;
        tracked.catch(() => {});
        return tracked;
      }
      onWriteSuccess(write.version);
    } catch (writeError) {
      reportWriteError(writeError, write);
    }
    return writeChainRef.current;
  }, [enqueueWrite, onWriteSuccess, reportWriteError, performWrite]);

  const takePendingWrite = React.useCallback(() => {
    if (writeTimerRef.current !== null) {
      clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }

    const pending = pendingWriteRef.current;
    pendingWriteRef.current = null;
    return pending;
  }, []);

  const flush = React.useCallback(() => {
    const pending = takePendingWrite();
    if (!pending) return;
    enqueueWrite(pending);
  }, [enqueueWrite, takePendingWrite]);

  const flushForPageLifecycle = React.useCallback(() => {
    const pending = takePendingWrite();
    if (!pending) return;

    if (asyncWriteInFlightRef.current) enqueueWrite(pending);
    else runWriteImmediately(pending);
  }, [enqueueWrite, runWriteImmediately, takePendingWrite]);

  const schedule = React.useCallback((write: TWrite, { flushNow, debounceMs }: WriteQueueScheduleOptions) => {
    pendingWriteRef.current = write;

    if (flushNow || debounceMs <= 0) {
      flush();
      return;
    }

    if (writeTimerRef.current !== null) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(flush, debounceMs);
  }, [flush]);

  const peekPending = React.useCallback(() => pendingWriteRef.current, []);

  const isWritePending = React.useCallback(() => writeInFlightRef.current, []);
  const whenWriteSettles = React.useCallback(() => writeChainRef.current, []);
  const writeCoordination = React.useMemo<WriteCoordination>(
    () => ({ isWritePending, whenWriteSettles }),
    [isWritePending, whenWriteSettles],
  );

  return { peekPending, schedule, flush, flushForPageLifecycle, writeCoordination };
}
