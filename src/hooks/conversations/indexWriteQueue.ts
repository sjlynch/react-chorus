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
  /** `versionRef` snapshot when the write was queued; gates `onWriteSuccess`. */
  version: number;
}

/**
 * Lets other index effects (notably the cross-tab `storage` listener) coordinate
 * with in-flight local index writes so an external update cannot clobber a write
 * that is still settling (lost update). Mirrors the message-persistence
 * `WriteCoordination` so the conversation index gets the same protection.
 */
export interface IndexWriteCoordination {
  /** True while a local index write is executing or awaiting its async adapter. */
  isWritePending: () => boolean;
  /** Resolves once the index writes currently on the chain have fully settled. */
  whenWriteSettles: () => Promise<void>;
}

interface UseConversationIndexWriteQueueOptions {
  storageRef: React.RefObject<StorageAdapter | null>;
  indexKeyRef: React.RefObject<string>;
  versionRef: React.RefObject<number>;
  debounceMs: number;
  /** Invoked with the write's version snapshot when an index write resolves cleanly. */
  onWriteSuccess: (writeVersion: number) => void;
  reportError: (rawError: unknown, operation: ConversationStorageOperation, key: string, conversationId?: string) => void;
}

export function useConversationIndexWriteQueue({
  storageRef,
  indexKeyRef,
  versionRef,
  debounceMs,
  onWriteSuccess,
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
        return Promise.resolve(result).then(
          () => { onWriteSuccess(write.version); },
          writeError => reportError(writeError, 'write', write.indexKey),
        );
      }
      onWriteSuccess(write.version);
    } catch (writeError) {
      reportError(writeError, 'write', write.indexKey);
    }
    return undefined;
  }, [onWriteSuccess, reportError]);

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

    pendingIndexWriteRef.current = { storage: targetStorage, indexKey: key, serialized, version: versionRef.current };

    if (mode === 'debounced') {
      if (indexWriteTimerRef.current !== null) clearTimeout(indexWriteTimerRef.current);
      indexWriteTimerRef.current = setTimeout(flushPendingIndexWrite, debounceMs);
      return;
    }

    flushPendingIndexWrite();
  }, [debounceMs, flushPendingIndexWrite, indexKeyRef, reportError, storageRef, versionRef]);

  const isWritePending = React.useCallback(() => indexWriteInFlightRef.current, []);
  const whenWriteSettles = React.useCallback(() => indexWriteChainRef.current, []);
  const writeCoordination = React.useMemo<IndexWriteCoordination>(
    () => ({ isWritePending, whenWriteSettles }),
    [isWritePending, whenWriteSettles],
  );

  return { flushPendingIndexWrite, persistIndex, writeCoordination };
}
