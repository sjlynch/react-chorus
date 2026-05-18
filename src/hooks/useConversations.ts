import React from 'react';
import type { StorageAdapter } from '../types';
import { useLatestRef } from './useLatestRef';
import { isChorusDevMode } from '../utils/devMode';
import { chooseActiveId, type ConversationsState, type PendingConversationCreate } from './conversations/indexCodec';
import { createConversationStorageError, isConversationStorageError } from './conversations/storageErrors';
import { useConversationIndexWriteQueue, type IndexPersistMode } from './conversations/indexWriteQueue';
import { createConversationStorageAdapter } from './conversations/storageAdapter';
import { useConversationActions } from './conversations/actions';
import { useLocalStorageConversationIndexSync } from './conversations/crossTabSync';
import { useConversationIndexReadLifecycle } from './conversations/indexReadLifecycle';
import { useConversationIndexFlushLifecycle } from './conversations/lifecycle';
import {
  createDefaultConversationId,
  DEFAULT_INDEX_KEY,
  DEFAULT_MESSAGE_KEY_PREFIX,
  DEFAULT_TITLE,
  INDEX_TOUCH_WRITE_DEBOUNCE_MS,
  readInitialConversationState,
  resolveStorage,
  type InitialSyncRead,
  type PendingIndexRead,
} from './conversations/storageSource';
import type {
  ConversationStorageError,
  ConversationStorageOperation,
  ConversationSummary,
  UseConversationsOptions,
  UseConversationsResult,
} from './conversations/types';

export type {
  ConversationStorageError,
  ConversationStorageOperation,
  ConversationSummary,
  RenameFromFirstMessageOptions,
  UseConversationsOptions,
  UseConversationsResult,
} from './conversations/types';

export function useConversations(options: UseConversationsOptions = {}): UseConversationsResult {
  const storage = resolveStorage(options);
  const indexKey = options.indexKey ?? DEFAULT_INDEX_KEY;
  const messageKeyPrefix = options.messageKeyPrefix ?? DEFAULT_MESSAGE_KEY_PREFIX;
  const defaultTitle = options.defaultTitle ?? DEFAULT_TITLE;
  const createId = options.createId ?? createDefaultConversationId;
  const now = options.now ?? (() => new Date());

  const versionRef = React.useRef(0);
  const initialAsyncReadRef = React.useRef<PendingIndexRead | null>(null);
  const initialSyncReadRef = React.useRef<InitialSyncRead | null>(null);
  const pendingCreatesRef = React.useRef<PendingConversationCreate[]>([]);
  const initialCleanIndexStateRef = React.useRef<ConversationsState | null>(null);
  const initialErrorRef = React.useRef<ConversationStorageError | null>(null);
  const storageRef = React.useRef<StorageAdapter | null>(storage);
  storageRef.current = storage;
  const indexKeyRef = React.useRef(indexKey);
  indexKeyRef.current = indexKey;
  const messageKeyPrefixRef = React.useRef(messageKeyPrefix);
  messageKeyPrefixRef.current = messageKeyPrefix;
  const defaultTitleRef = useLatestRef(defaultTitle);
  const createIdRef = useLatestRef(createId);
  const nowRef = useLatestRef(now);
  const onErrorRef = useLatestRef(options.onError);

  const [state, setState] = React.useState<ConversationsState>(() => readInitialConversationState({
    storage,
    indexKey,
    initialActiveId: options.initialActiveId,
    defaultTitle,
    now,
    versionRef,
    initialAsyncReadRef,
    initialSyncReadRef,
    initialCleanIndexStateRef,
    initialErrorRef,
  }));
  const [error, setError] = React.useState<ConversationStorageError | null>(() => initialErrorRef.current);
  const stateRef = React.useRef(state);
  stateRef.current = state;

  const notifyError = React.useCallback((nextError: ConversationStorageError) => {
    if (isChorusDevMode()) {
      console.warn(`[Chorus] Failed to ${nextError.operation} conversation storage.`, nextError);
    }
    onErrorRef.current?.(nextError);
  }, [onErrorRef]);

  const reportError = React.useCallback((rawError: unknown, operation: ConversationStorageOperation, key: string, conversationId?: string) => {
    const nextError = isConversationStorageError(rawError)
      ? rawError
      : createConversationStorageError(key, operation, rawError, conversationId);
    setError(nextError);
    notifyError(nextError);
  }, [notifyError]);

  React.useEffect(() => {
    if (!initialErrorRef.current) return;
    notifyError(initialErrorRef.current);
    initialErrorRef.current = null;
  }, [notifyError]);

  const getPersistenceKey = React.useCallback((id: string) => `${messageKeyPrefixRef.current}${id}`, []);

  const { flushPendingIndexWrite, persistIndex } = useConversationIndexWriteQueue({
    storageRef,
    indexKeyRef,
    debounceMs: INDEX_TOUCH_WRITE_DEBOUNCE_MS,
    reportError,
  });

  const commit = React.useCallback((
    conversations: ConversationSummary[],
    activeId: string | null,
    persistMode: IndexPersistMode = 'immediate',
  ) => {
    versionRef.current += 1;
    const nextActiveId = chooseActiveId(conversations, activeId);
    const nextState = { conversations, activeId: nextActiveId, loaded: true };
    stateRef.current = nextState;
    setState(nextState);
    persistIndex(conversations, nextActiveId, persistMode);
  }, [persistIndex]);

  const {
    touchConversation,
    createConversation,
    selectConversation,
    renameConversation,
    renameFromFirstMessage,
    deleteConversation,
    pinConversation,
  } = useConversationActions({
    stateRef,
    storageRef,
    indexKeyRef,
    messageKeyPrefixRef,
    defaultTitleRef,
    createIdRef,
    nowRef,
    pendingCreatesRef,
    commit,
    reportError,
  });

  const conversationStorage = React.useMemo<StorageAdapter | null>(() => (
    createConversationStorageAdapter(storage, messageKeyPrefix, touchConversation)
  ), [messageKeyPrefix, storage, touchConversation]);

  useConversationIndexFlushLifecycle({
    storage,
    indexKey,
    flushPendingIndexWrite,
  });

  useLocalStorageConversationIndexSync({
    storage,
    indexKey,
    defaultTitleRef,
    nowRef,
    versionRef,
    stateRef,
    setState,
    setError,
    reportError,
  });

  useConversationIndexReadLifecycle({
    storage,
    indexKey,
    initialActiveId: options.initialActiveId,
    defaultTitleRef,
    nowRef,
    versionRef,
    initialAsyncReadRef,
    initialSyncReadRef,
    pendingCreatesRef,
    initialCleanIndexStateRef,
    stateRef,
    setState,
    setError,
    commit,
    persistIndex,
    reportError,
  });

  const activeConversation = state.conversations.find(conversation => conversation.id === state.activeId) ?? null;

  return {
    conversations: state.conversations,
    activeId: state.activeId,
    activeConversation,
    activePersistenceKey: state.activeId ? getPersistenceKey(state.activeId) : '',
    storage: conversationStorage,
    loaded: state.loaded,
    error,
    getPersistenceKey,
    createConversation,
    selectConversation,
    renameConversation,
    renameFromFirstMessage,
    deleteConversation,
    pinConversation,
  };
}
