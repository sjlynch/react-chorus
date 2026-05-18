import type React from 'react';
import type { StorageAdapter } from '../../types';
import { isPromiseLike } from '../../utils/async';
import { createRandomId } from '../../utils/ids';
import { emptyState, stateFromRaw, type ConversationsState } from './indexCodec';
import { createConversationStorageError } from './storageErrors';
import type { ConversationStorageError, UseConversationsOptions } from './types';

export const DEFAULT_INDEX_KEY = 'chorus-conversations-index';
export const DEFAULT_MESSAGE_KEY_PREFIX = 'chorus-conversation:';
export const DEFAULT_TITLE = 'New conversation';
export const INDEX_TOUCH_WRITE_DEBOUNCE_MS = 300;

export interface PendingIndexRead {
  storage: StorageAdapter;
  indexKey: string;
  promise: Promise<string | null>;
  version: number;
}

export interface InitialSyncRead {
  storage: StorageAdapter;
  indexKey: string;
}

interface ReadInitialConversationStateOptions {
  storage: StorageAdapter | null;
  indexKey: string;
  initialActiveId?: string | null;
  defaultTitle: string;
  now: () => Date | string | number;
  versionRef: React.RefObject<number>;
  initialAsyncReadRef: React.RefObject<PendingIndexRead | null>;
  initialSyncReadRef: React.RefObject<InitialSyncRead | null>;
  initialCleanIndexStateRef: React.RefObject<ConversationsState | null>;
  initialErrorRef: React.RefObject<ConversationStorageError | null>;
}

export function resolveDefaultStorage(): StorageAdapter | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function resolveStorage(options?: Pick<UseConversationsOptions, 'storage'>): StorageAdapter | null {
  if (options?.storage !== undefined) return options.storage;
  return resolveDefaultStorage();
}

export function createDefaultConversationId() {
  return createRandomId('chorus-conversation');
}

export function readInitialConversationState({
  storage,
  indexKey,
  initialActiveId,
  defaultTitle,
  now,
  versionRef,
  initialAsyncReadRef,
  initialSyncReadRef,
  initialCleanIndexStateRef,
  initialErrorRef,
}: ReadInitialConversationStateOptions): ConversationsState {
  if (!storage) return emptyState();

  try {
    const raw = storage.getItem(indexKey);
    if (isPromiseLike<string | null>(raw)) {
      const promise = Promise.resolve(raw);
      promise.catch(() => {});
      initialAsyncReadRef.current = { storage, indexKey, promise, version: versionRef.current };
      return { conversations: [], activeId: null, loaded: false };
    }
    initialSyncReadRef.current = { storage, indexKey };
    const parsed = stateFromRaw(raw, initialActiveId, indexKey, defaultTitle, now);
    initialErrorRef.current = parsed.error;
    if (!parsed.error && parsed.shouldPersist) initialCleanIndexStateRef.current = parsed.state;
    return parsed.state;
  } catch (readError) {
    initialSyncReadRef.current = { storage, indexKey };
    initialErrorRef.current = createConversationStorageError(indexKey, 'read', readError);
    return emptyState();
  }
}
