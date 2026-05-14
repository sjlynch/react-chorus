import React from 'react';
import type { StorageAdapter } from '../types';
import { useLatestRef } from './useLatestRef';

const DEFAULT_INDEX_KEY = 'chorus-conversations-index';
const DEFAULT_MESSAGE_KEY_PREFIX = 'chorus-conversation:';
const DEFAULT_TITLE = 'New conversation';
let fallbackConversationIdCounter = 0;

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
}

export interface UseConversationsOptions {
  /** Storage used for both the conversation index and per-conversation messages. Defaults to localStorage. */
  storage?: StorageAdapter | null;
  /** Storage key for the serialized conversation index. */
  indexKey?: string;
  /** Prefix used to derive each conversation's message persistence key. */
  messageKeyPrefix?: string;
  /** Preferred active conversation after the index loads. */
  initialActiveId?: string | null;
  /** Default title for createConversation() when no title is supplied. */
  defaultTitle?: string;
  /** Deterministic ID hook for tests or app-specific IDs. */
  createId?: () => string;
  /** Deterministic timestamp hook for tests. */
  now?: () => Date | string | number;
}

export interface UseConversationsResult {
  conversations: ConversationSummary[];
  activeId: string | null;
  activeConversation: ConversationSummary | null;
  /** Persistence key for the active conversation, suitable for <Chorus persistenceKey>. */
  activePersistenceKey: string;
  /** Storage wrapper suitable for <Chorus persistenceStorage>; message writes update conversation timestamps. */
  storage: StorageAdapter | null;
  loaded: boolean;
  getPersistenceKey: (id: string) => string;
  createConversation: (title?: string) => string;
  selectConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string) => void;
  pinConversation: (id: string, pinned?: boolean) => void;
}

interface ConversationIndexPayload {
  conversations: ConversationSummary[];
  activeId: string | null;
}

interface ConversationsState {
  conversations: ConversationSummary[];
  activeId: string | null;
  loaded: boolean;
}

interface PendingIndexRead {
  storage: StorageAdapter;
  indexKey: string;
  promise: Promise<string | null>;
  version: number;
}

function resolveDefaultStorage(): StorageAdapter | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function resolveStorage(options?: UseConversationsOptions): StorageAdapter | null {
  if (options?.storage !== undefined) return options.storage;
  return resolveDefaultStorage();
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof (value as { then?: unknown }).then === 'function';
}

function createDefaultConversationId() {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto);

  fallbackConversationIdCounter += 1;
  return `chorus-conversation-${Date.now()}-${fallbackConversationIdCounter}`;
}

function normalizeTimestamp(value: Date | string | number): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  return value;
}

function normalizeTitle(title: string | undefined, fallback: string) {
  const trimmed = title?.trim();
  return trimmed || fallback;
}

function getTimestamp(now: () => Date | string | number) {
  return normalizeTimestamp(now());
}

function isConversationSummary(value: unknown): value is ConversationSummary {
  return typeof value === 'object'
    && value !== null
    && typeof (value as ConversationSummary).id === 'string'
    && typeof (value as ConversationSummary).title === 'string'
    && typeof (value as ConversationSummary).createdAt === 'string'
    && typeof (value as ConversationSummary).updatedAt === 'string';
}

function sanitizeConversation(value: ConversationSummary): ConversationSummary {
  return {
    id: value.id,
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.pinned !== undefined ? { pinned: Boolean(value.pinned) } : {}),
  };
}

function chooseActiveId(conversations: ConversationSummary[], preferredId?: string | null) {
  if (preferredId && conversations.some(conversation => conversation.id === preferredId)) return preferredId;
  return conversations[0]?.id ?? null;
}

function parseConversationIndex(raw: string | null, preferredActiveId?: string | null): ConversationIndexPayload {
  if (!raw) return { conversations: [], activeId: null };

  try {
    const parsed = JSON.parse(raw) as unknown;
    const source = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { conversations?: unknown }).conversations)
        ? (parsed as { conversations: unknown[] }).conversations
        : [];
    const conversations = source.filter(isConversationSummary).map(sanitizeConversation);
    const storedActiveId = typeof parsed === 'object'
      && parsed !== null
      && typeof (parsed as { activeId?: unknown }).activeId === 'string'
      ? (parsed as { activeId: string }).activeId
      : null;

    return {
      conversations,
      activeId: chooseActiveId(conversations, preferredActiveId ?? storedActiveId),
    };
  } catch {
    return { conversations: [], activeId: null };
  }
}

function serializeConversationIndex(conversations: ConversationSummary[], activeId: string | null) {
  return JSON.stringify({ conversations, activeId });
}

function emptyState(): ConversationsState {
  return { conversations: [], activeId: null, loaded: true };
}

function stateFromRaw(raw: string | null, preferredActiveId?: string | null): ConversationsState {
  const index = parseConversationIndex(raw, preferredActiveId);
  return { conversations: index.conversations, activeId: index.activeId, loaded: true };
}

function getConversationIdFromKey(key: string, prefix: string) {
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

export function useConversations(options: UseConversationsOptions = {}): UseConversationsResult {
  const storage = resolveStorage(options);
  const indexKey = options.indexKey ?? DEFAULT_INDEX_KEY;
  const messageKeyPrefix = options.messageKeyPrefix ?? DEFAULT_MESSAGE_KEY_PREFIX;
  const defaultTitle = options.defaultTitle ?? DEFAULT_TITLE;
  const createId = options.createId ?? createDefaultConversationId;
  const now = options.now ?? (() => new Date());

  const versionRef = React.useRef(0);
  const initialAsyncReadRef = React.useRef<PendingIndexRead | null>(null);
  const storageRef = React.useRef(storage);
  storageRef.current = storage;
  const indexKeyRef = React.useRef(indexKey);
  indexKeyRef.current = indexKey;
  const messageKeyPrefixRef = React.useRef(messageKeyPrefix);
  messageKeyPrefixRef.current = messageKeyPrefix;
  const defaultTitleRef = useLatestRef(defaultTitle);
  const createIdRef = useLatestRef(createId);
  const nowRef = useLatestRef(now);

  const [state, setState] = React.useState<ConversationsState>(() => {
    if (!storage) return emptyState();

    try {
      const raw = storage.getItem(indexKey);
      if (isPromiseLike<string | null>(raw)) {
        const promise = Promise.resolve(raw);
        promise.catch(() => {});
        initialAsyncReadRef.current = { storage, indexKey, promise, version: versionRef.current };
        return { conversations: [], activeId: null, loaded: false };
      }
      return stateFromRaw(raw, options.initialActiveId);
    } catch {
      return emptyState();
    }
  });
  const stateRef = React.useRef(state);
  stateRef.current = state;

  const getPersistenceKey = React.useCallback((id: string) => `${messageKeyPrefixRef.current}${id}`, []);

  const persistIndex = React.useCallback((conversations: ConversationSummary[], activeId: string | null) => {
    const targetStorage = storageRef.current;
    if (!targetStorage) return;

    try {
      const result = targetStorage.setItem(indexKeyRef.current, serializeConversationIndex(conversations, activeId));
      if (isPromiseLike<void>(result)) Promise.resolve(result).catch(() => {});
    } catch {
      // Index persistence is best-effort; callers still get the in-memory state.
    }
  }, []);

  const commit = React.useCallback((conversations: ConversationSummary[], activeId: string | null) => {
    versionRef.current += 1;
    const nextActiveId = chooseActiveId(conversations, activeId);
    const nextState = { conversations, activeId: nextActiveId, loaded: true };
    stateRef.current = nextState;
    setState(nextState);
    persistIndex(conversations, nextActiveId);
  }, [persistIndex]);

  const touchConversation = React.useCallback((id: string) => {
    const current = stateRef.current;
    if (!current.conversations.some(conversation => conversation.id === id)) return;

    const timestamp = getTimestamp(nowRef.current);
    const conversations = current.conversations.map(conversation => (
      conversation.id === id ? { ...conversation, updatedAt: timestamp } : conversation
    ));
    commit(conversations, current.activeId);
  }, [commit, nowRef, stateRef]);

  const conversationStorage = React.useMemo<StorageAdapter | null>(() => {
    if (!storage) return storage;

    const touchAfterWrite = (key: string, result: void | Promise<void>) => {
      const conversationId = getConversationIdFromKey(key, messageKeyPrefix);
      if (!conversationId) return;

      if (isPromiseLike<void>(result)) {
        Promise.resolve(result).then(() => touchConversation(conversationId)).catch(() => {});
      } else {
        touchConversation(conversationId);
      }
    };

    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => {
        const result = storage.setItem(key, value);
        touchAfterWrite(key, result);
        return result;
      },
      ...(storage.removeItem ? {
        removeItem: (key: string) => {
          const result = storage.removeItem?.(key);
          touchAfterWrite(key, result);
          return result;
        },
      } : {}),
    };
  }, [messageKeyPrefix, storage, touchConversation]);

  const removeConversationMessages = React.useCallback((id: string) => {
    const targetStorage = storageRef.current;
    if (!targetStorage) return;

    const messageKey = `${messageKeyPrefixRef.current}${id}`;
    try {
      const result = targetStorage.removeItem
        ? targetStorage.removeItem(messageKey)
        : targetStorage.setItem(messageKey, '[]');
      if (isPromiseLike<void>(result)) Promise.resolve(result).catch(() => {});
    } catch {
      // Message deletion is best-effort so the index can still update.
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const applyRead = (raw: string | null, version: number) => {
      if (!cancelled && versionRef.current === version) {
        const nextState = stateFromRaw(raw, options.initialActiveId);
        stateRef.current = nextState;
        setState(nextState);
      }
    };

    const applyReadError = (version: number) => {
      if (!cancelled && versionRef.current === version) {
        const nextState = emptyState();
        stateRef.current = nextState;
        setState(nextState);
      }
    };

    if (!storage) {
      const nextState = emptyState();
      stateRef.current = nextState;
      setState(nextState);
      return () => { cancelled = true; };
    }

    const pendingInitialRead = initialAsyncReadRef.current;
    if (pendingInitialRead?.storage === storage && pendingInitialRead.indexKey === indexKey) {
      initialAsyncReadRef.current = null;
      setState(prev => {
        if (versionRef.current !== pendingInitialRead.version) return prev;
        const nextState = { conversations: [], activeId: null, loaded: false };
        stateRef.current = nextState;
        return nextState;
      });
      pendingInitialRead.promise
        .then(raw => applyRead(raw, pendingInitialRead.version))
        .catch(() => applyReadError(pendingInitialRead.version));
      return () => { cancelled = true; };
    }

    const version = versionRef.current;
    try {
      const raw = storage.getItem(indexKey);
      if (isPromiseLike<string | null>(raw)) {
        const promise = Promise.resolve(raw);
        promise.catch(() => {});
        setState(prev => {
          if (versionRef.current !== version) return prev;
          const nextState = { conversations: [], activeId: null, loaded: false };
          stateRef.current = nextState;
          return nextState;
        });
        promise
          .then(str => applyRead(str, version))
          .catch(() => applyReadError(version));
      } else {
        applyRead(raw, version);
      }
    } catch {
      applyReadError(version);
    }

    return () => { cancelled = true; };
  }, [indexKey, options.initialActiveId, storage]);

  const createConversation = React.useCallback((title?: string) => {
    const id = createIdRef.current();
    const timestamp = getTimestamp(nowRef.current);
    const conversation: ConversationSummary = {
      id,
      title: normalizeTitle(title, defaultTitleRef.current),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const conversations = [
      conversation,
      ...stateRef.current.conversations.filter(existing => existing.id !== id),
    ];
    commit(conversations, id);
    return id;
  }, [commit, createIdRef, defaultTitleRef, nowRef, stateRef]);

  const selectConversation = React.useCallback((id: string) => {
    const current = stateRef.current;
    if (!current.conversations.some(conversation => conversation.id === id)) return;
    commit(current.conversations, id);
  }, [commit, stateRef]);

  const renameConversation = React.useCallback((id: string, title: string) => {
    const current = stateRef.current;
    const trimmed = title.trim();
    if (!trimmed || !current.conversations.some(conversation => conversation.id === id)) return;

    const timestamp = getTimestamp(nowRef.current);
    const conversations = current.conversations.map(conversation => (
      conversation.id === id ? { ...conversation, title: trimmed, updatedAt: timestamp } : conversation
    ));
    commit(conversations, current.activeId);
  }, [commit, nowRef, stateRef]);

  const deleteConversation = React.useCallback((id: string) => {
    const current = stateRef.current;
    if (!current.conversations.some(conversation => conversation.id === id)) return;

    removeConversationMessages(id);
    const conversations = current.conversations.filter(conversation => conversation.id !== id);
    const activeId = current.activeId === id ? conversations[0]?.id ?? null : current.activeId;
    commit(conversations, activeId);
  }, [commit, removeConversationMessages, stateRef]);

  const pinConversation = React.useCallback((id: string, pinned = true) => {
    const current = stateRef.current;
    if (!current.conversations.some(conversation => conversation.id === id)) return;

    const timestamp = getTimestamp(nowRef.current);
    const conversations = current.conversations.map(conversation => (
      conversation.id === id ? { ...conversation, pinned, updatedAt: timestamp } : conversation
    ));
    commit(conversations, current.activeId);
  }, [commit, nowRef, stateRef]);

  const activeConversation = state.conversations.find(conversation => conversation.id === state.activeId) ?? null;

  return {
    conversations: state.conversations,
    activeId: state.activeId,
    activeConversation,
    activePersistenceKey: state.activeId ? getPersistenceKey(state.activeId) : '',
    storage: conversationStorage,
    loaded: state.loaded,
    getPersistenceKey,
    createConversation,
    selectConversation,
    renameConversation,
    deleteConversation,
    pinConversation,
  };
}
