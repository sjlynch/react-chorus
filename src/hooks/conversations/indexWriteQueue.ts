import React from 'react';
import type { StorageAdapter } from '../../types';
import type { ConversationStorageOperation, ConversationSummary } from './types';
import { isPromiseLike } from '../../utils/async';
import { serializeConversationIndex } from './indexCodec';

export type IndexPersistMode = 'immediate' | 'debounced';

interface PendingIndexWrite {
  storage: StorageAdapter;
  indexKey: string;
  serialized: string;
}

interface UseConversationIndexWriteQueueOptions {
  storageRef: React.RefObject<StorageAdapter | null>;
  indexKeyRef: React.RefObject<string>;
  debounceMs: number;
  reportError: (rawError: unknown, operation: ConversationStorageOperation, key: string, conversationId?: string) => void;
}

export function useConversationIndexWriteQueue({
  storageRef,
  indexKeyRef,
  debounceMs,
  reportError,
}: UseConversationIndexWriteQueueOptions) {
  const pendingIndexWriteRef = React.useRef<PendingIndexWrite | null>(null);
  const indexWriteTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const indexWriteChainRef = React.useRef(Promise.resolve());
  const indexWriteInFlightRef = React.useRef(false);

  const runIndexWrite = React.useCallback((write: PendingIndexWrite): void | Promise<void> => {
    try {
      const result = write.storage.setItem(write.indexKey, write.serialized);
      if (isPromiseLike<void>(result)) {
        return Promise.resolve(result).catch(writeError => reportError(writeError, 'write', write.indexKey));
      }
    } catch (writeError) {
      reportError(writeError, 'write', write.indexKey);
    }
    return undefined;
  }, [reportError]);

  const enqueueIndexWrite = React.useCallback((write: PendingIndexWrite) => {
    const runQueuedWrite = () => {
      indexWriteInFlightRef.current = true;
      const result = runIndexWrite(write);
      if (isPromiseLike<void>(result)) {
        return Promise.resolve(result).finally(() => {
          indexWriteInFlightRef.current = false;
        });
      }

      indexWriteInFlightRef.current = false;
      return Promise.resolve();
    };

    indexWriteChainRef.current = indexWriteInFlightRef.current
      ? indexWriteChainRef.current.then(runQueuedWrite, runQueuedWrite)
      : runQueuedWrite();
    indexWriteChainRef.current.catch(() => {});
  }, [runIndexWrite]);

  const takePendingIndexWrite = React.useCallback(() => {
    if (indexWriteTimerRef.current !== null) {
      clearTimeout(indexWriteTimerRef.current);
      indexWriteTimerRef.current = null;
    }

    const pending = pendingIndexWriteRef.current;
    pendingIndexWriteRef.current = null;
    return pending;
  }, []);

  const flushPendingIndexWrite = React.useCallback(() => {
    const pending = takePendingIndexWrite();
    if (!pending) return;
    enqueueIndexWrite(pending);
  }, [enqueueIndexWrite, takePendingIndexWrite]);

  const persistIndex = React.useCallback((
    conversations: ConversationSummary[],
    activeId: string | null,
    mode: IndexPersistMode = 'immediate',
  ) => {
    const targetStorage = storageRef.current;
    if (!targetStorage) return;

    const key = indexKeyRef.current;
    const pending = pendingIndexWriteRef.current;
    if (pending && (pending.storage !== targetStorage || pending.indexKey !== key)) flushPendingIndexWrite();

    let serialized: string;
    try {
      serialized = serializeConversationIndex(conversations, activeId);
    } catch (serializationError) {
      reportError(serializationError, 'write', key);
      return;
    }

    pendingIndexWriteRef.current = { storage: targetStorage, indexKey: key, serialized };

    if (mode === 'debounced') {
      if (indexWriteTimerRef.current !== null) clearTimeout(indexWriteTimerRef.current);
      indexWriteTimerRef.current = setTimeout(flushPendingIndexWrite, debounceMs);
      return;
    }

    flushPendingIndexWrite();
  }, [debounceMs, flushPendingIndexWrite, indexKeyRef, reportError, storageRef]);

  return { flushPendingIndexWrite, persistIndex };
}
