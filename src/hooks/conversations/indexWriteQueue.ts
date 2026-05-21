import React from 'react';
import type { StorageAdapter } from '../../types';
import type { ConversationStorageOperation, ConversationSummary } from './types';
import { serializeConversationIndex } from './indexCodec';
import { useWriteQueueCore, type QueuedWrite, type WriteCoordination } from '../persistence/writeQueueCore';

export type IndexPersistMode = 'immediate' | 'debounced';

interface PendingIndexWrite extends QueuedWrite {
  storage: StorageAdapter;
  indexKey: string;
  serialized: string;
}

/**
 * Lets other index effects (notably the cross-tab `storage` listener) coordinate
 * with in-flight local index writes so an external update cannot clobber a write
 * that is still settling (lost update). Mirrors the message-persistence
 * `WriteCoordination` so the conversation index gets the same protection — both
 * queues share `persistence/writeQueueCore.ts`.
 */
export type IndexWriteCoordination = WriteCoordination;

interface UseConversationIndexWriteQueueOptions {
  storageRef: React.RefObject<StorageAdapter | null>;
  indexKeyRef: React.RefObject<string>;
  versionRef: React.RefObject<number>;
  debounceMs: number;
  /** Invoked with the write's version snapshot when an index write resolves cleanly. */
  onWriteSuccess: (writeVersion: number) => void;
  reportError: (rawError: unknown, operation: ConversationStorageOperation, key: string, conversationId?: string) => void;
}

/**
 * Conversation-index write queue: a thin wrapper over the shared
 * `useWriteQueueCore` that adds index serialization and the `(storage, indexKey)`
 * source identity used to flush a stale pending write when the source changes.
 */
export function useConversationIndexWriteQueue({
  storageRef,
  indexKeyRef,
  versionRef,
  debounceMs,
  onWriteSuccess,
  reportError,
}: UseConversationIndexWriteQueueOptions) {
  const performWrite = React.useCallback(
    (write: PendingIndexWrite) => write.storage.setItem(write.indexKey, write.serialized),
    [],
  );
  const reportWriteError = React.useCallback(
    (rawError: unknown, write: PendingIndexWrite) => reportError(rawError, 'write', write.indexKey),
    [reportError],
  );

  const { peekPending, schedule, flush, writeCoordination } = useWriteQueueCore<PendingIndexWrite>({
    performWrite,
    reportWriteError,
    onWriteSuccess,
    // Settle synchronous index writes eagerly so a cross-tab `storage` event
    // arriving right after a local write is applied at once, not deferred.
    deferSyncSettle: false,
  });

  const persistIndex = React.useCallback((
    conversations: ConversationSummary[],
    activeId: string | null,
    mode: IndexPersistMode = 'immediate',
  ) => {
    const targetStorage = storageRef.current;
    if (!targetStorage) return;

    const key = indexKeyRef.current;
    const pending = peekPending();
    if (pending && (pending.storage !== targetStorage || pending.indexKey !== key)) flush();

    let serialized: string;
    try {
      serialized = serializeConversationIndex(conversations, activeId);
    } catch (serializationError) {
      reportError(serializationError, 'write', key);
      return;
    }

    schedule(
      { storage: targetStorage, indexKey: key, serialized, version: versionRef.current },
      { flushNow: mode !== 'debounced', debounceMs },
    );
  }, [debounceMs, flush, indexKeyRef, peekPending, reportError, schedule, storageRef, versionRef]);

  return { flushPendingIndexWrite: flush, persistIndex, writeCoordination };
}
