import React from 'react';
import type { Message, StorageAdapter } from '../../types';
import type { PersistenceOperation, SerializeMessages } from './types';
import { useWriteQueueCore, type QueuedWrite } from './writeQueueCore';

export type { WriteCoordination } from './writeQueueCore';

interface PendingWrite extends QueuedWrite {
  key: string;
  storage: StorageAdapter;
  serialized: string;
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

/**
 * Message-persistence write queue: a thin wrapper over the shared
 * `useWriteQueueCore` that adds message serialization, the `removeIfEmpty`
 * key-removal path, and the `(key, storage)` source identity used to flush a
 * stale pending write when the persistence source changes.
 */
export function usePersistenceWriteQueue<TMeta = Record<string, unknown>>({
  keyRef,
  storageRef,
  serializeMessagesRef,
  writeDebounceMsRef,
  onWriteSuccess,
  reportPersistenceError,
}: UsePersistenceWriteQueueOptions<TMeta>) {
  const reportWriteError = React.useCallback((rawError: unknown, write: PendingWrite) => {
    reportPersistenceError(rawError, write.remove ? 'remove' : 'write', write.key);
  }, [reportPersistenceError]);

  const { peekPending, schedule, flush, flushForPageLifecycle, writeCoordination } = useWriteQueueCore<PendingWrite>({
    performWrite: writeToStorage,
    reportWriteError,
    onWriteSuccess,
    // A synchronous write stays in-flight for a microtask so a same-task
    // `pagehide` flush chains behind it through `runWriteImmediately`.
    deferSyncSettle: true,
  });

  const queueWrite = React.useCallback((messages: Message<TMeta>[], version: number, flushNow: boolean, removeIfEmpty: boolean) => {
    const k = keyRef.current;
    const s = storageRef.current;
    if (!k || !s) return;

    const pending = peekPending();
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

    schedule(
      { key: k, storage: s, serialized, version, remove: shouldRemove },
      { flushNow, debounceMs: writeDebounceMsRef.current },
    );
  }, [flush, keyRef, peekPending, reportPersistenceError, schedule, serializeMessagesRef, storageRef, writeDebounceMsRef]);

  return { flush, flushForPageLifecycle, queueWrite, writeCoordination };
}
