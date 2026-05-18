import React from 'react';
import type { Message, StorageAdapter } from '../../types';
import type { PersistenceOperation, SerializeMessages } from './types';
import { isPromiseLike } from '../../utils/async';

interface PendingWrite {
  key: string;
  storage: StorageAdapter;
  serialized: string;
  version: number;
  remove: boolean;
}

interface UsePersistenceWriteQueueOptions<TMeta> {
  keyRef: React.RefObject<string>;
  storageRef: React.RefObject<StorageAdapter | null>;
  serializeMessagesRef: React.RefObject<SerializeMessages<TMeta>>;
  writeDebounceMsRef: React.RefObject<number>;
  onWriteSuccess: (writeVersion: number) => void;
  reportPersistenceError: (rawError: unknown, operation: PersistenceOperation, errorKey?: string) => void;
}

function writeToStorage(write: PendingWrite): void | Promise<void> {
  if (write.remove && write.storage.removeItem) return write.storage.removeItem(write.key);
  return write.storage.setItem(write.key, write.serialized);
}

export function usePersistenceWriteQueue<TMeta = Record<string, unknown>>({
  keyRef,
  storageRef,
  serializeMessagesRef,
  writeDebounceMsRef,
  onWriteSuccess,
  reportPersistenceError,
}: UsePersistenceWriteQueueOptions<TMeta>) {
  const pendingWriteRef = React.useRef<PendingWrite | null>(null);
  const writeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeChainRef = React.useRef(Promise.resolve());
  const writeInFlightRef = React.useRef(false);
  const asyncWriteInFlightRef = React.useRef(false);

  const markWriteSuccess = React.useCallback((write: PendingWrite) => {
    onWriteSuccess(write.version);
  }, [onWriteSuccess]);

  const runWrite = React.useCallback(async (write: PendingWrite) => {
    try {
      const result = writeToStorage(write);
      if (isPromiseLike<void>(result)) {
        asyncWriteInFlightRef.current = true;
        await result;
      }
      markWriteSuccess(write);
    } catch (writeError) {
      reportPersistenceError(writeError, write.remove ? 'remove' : 'write', write.key);
    }
  }, [markWriteSuccess, reportPersistenceError]);

  const runWriteImmediately = React.useCallback((write: PendingWrite) => {
    try {
      const result = writeToStorage(write);
      if (isPromiseLike<void>(result)) {
        writeInFlightRef.current = true;
        asyncWriteInFlightRef.current = true;
        const tracked = Promise.resolve(result)
          .then(
            () => { markWriteSuccess(write); },
            writeError => reportPersistenceError(writeError, write.remove ? 'remove' : 'write', write.key),
          )
          .finally(() => {
            writeInFlightRef.current = false;
            asyncWriteInFlightRef.current = false;
          });
        writeChainRef.current = tracked;
        tracked.catch(() => {});
        return;
      }
      markWriteSuccess(write);
    } catch (writeError) {
      reportPersistenceError(writeError, write.remove ? 'remove' : 'write', write.key);
    }
  }, [markWriteSuccess, reportPersistenceError]);

  const enqueueWrite = React.useCallback((write: PendingWrite) => {
    const runQueuedWrite = async () => {
      writeInFlightRef.current = true;
      asyncWriteInFlightRef.current = false;
      try {
        await runWrite(write);
      } finally {
        writeInFlightRef.current = false;
        asyncWriteInFlightRef.current = false;
      }
    };

    writeChainRef.current = writeInFlightRef.current
      ? writeChainRef.current.then(runQueuedWrite, runQueuedWrite)
      : runQueuedWrite();
    writeChainRef.current.catch(() => {});
  }, [runWrite]);

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

  const queueWrite = React.useCallback((messages: Message<TMeta>[], version: number, flushNow: boolean, removeIfEmpty: boolean) => {
    const k = keyRef.current;
    const s = storageRef.current;
    if (!k || !s) return;

    const pending = pendingWriteRef.current;
    if (pending && (pending.key !== k || pending.storage !== s)) flush();

    const shouldRemove = removeIfEmpty && messages.length === 0 && typeof s.removeItem === 'function';
    let serialized = '[]';
    if (!shouldRemove) {
      try {
        serialized = serializeMessagesRef.current(messages);
      } catch (serializationError) {
        reportPersistenceError(serializationError, 'write', k);
        return;
      }
    }

    pendingWriteRef.current = { key: k, storage: s, serialized, version, remove: shouldRemove };

    if (flushNow || writeDebounceMsRef.current <= 0) {
      flush();
      return;
    }

    if (writeTimerRef.current !== null) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(flush, writeDebounceMsRef.current);
  }, [flush, keyRef, reportPersistenceError, serializeMessagesRef, storageRef, writeDebounceMsRef]);

  return { flush, flushForPageLifecycle, queueWrite };
}
