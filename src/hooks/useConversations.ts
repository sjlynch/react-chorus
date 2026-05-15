import React from 'react';
import type { Message, StorageAdapter } from '../types';
import { useLatestRef } from './useLatestRef';
import { isChorusDevMode } from '../utils/devMode';

const DEFAULT_INDEX_KEY = 'chorus-conversations-index';
const DEFAULT_MESSAGE_KEY_PREFIX = 'chorus-conversation:';
const DEFAULT_TITLE = 'New conversation';
const DEFAULT_FIRST_MESSAGE_TITLE_MAX_LENGTH = 48;
const INDEX_TOUCH_WRITE_DEBOUNCE_MS = 300;
let fallbackConversationIdCounter = 0;

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  /** True until the title is user-modified or auto-renamed from the first message. */
  pristine?: boolean;
}

export type ConversationStorageOperation = 'read' | 'write' | 'delete';

type IndexPersistMode = 'immediate' | 'debounced';

export interface ConversationStorageError extends Error {
  key: string;
  operation: ConversationStorageOperation;
  conversationId?: string;
  cause?: unknown;
}

export interface RenameFromFirstMessageOptions {
  /** Rename even when the conversation is no longer pristine. Defaults to false. */
  overwrite?: boolean;
  /** Maximum generated title length before adding an ellipsis. Defaults to 48. */
  maxLength?: number;
  /** Used when no non-empty user message text exists. */
  fallbackTitle?: string;
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
  /** Called when the index or a transcript delete fails to read/write/delete. */
  onError?: (error: ConversationStorageError) => void;
}

export interface UseConversationsResult {
  conversations: ConversationSummary[];
  activeId: string | null;
  activeConversation: ConversationSummary | null;
  /** Persistence key for the active conversation, suitable for <Chorus persistenceKey>. */
  activePersistenceKey: string;
  /** Storage wrapper suitable for <Chorus persistenceStorage>; message writes update conversation timestamps. */
  storage: StorageAdapter | null;
  /** False while an async conversation index read is pending; gate custom sidebars on this. */
  loaded: boolean;
  /** Last conversation storage error, if any. */
  error: ConversationStorageError | null;
  getPersistenceKey: (id: string) => string;
  /** Creates immediately once loaded; pre-load creates are queued and merged after the index read. */
  createConversation: (title?: string) => string;
  selectConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  renameFromFirstMessage: (id: string, messages: Pick<Message, 'role' | 'text'>[], options?: RenameFromFirstMessageOptions) => void;
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

interface PendingConversationCreate {
  storage: StorageAdapter;
  indexKey: string;
  conversation: ConversationSummary;
}

interface PendingIndexWrite {
  storage: StorageAdapter;
  indexKey: string;
  serialized: string;
}

interface InitialSyncRead {
  storage: StorageAdapter;
  indexKey: string;
}

interface ParsedConversationState {
  state: ConversationsState;
  error: ConversationStorageError | null;
  shouldPersist: boolean;
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

interface ConversationSummaryCandidate {
  id: string;
  title: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  pinned?: unknown;
  pristine?: unknown;
}

interface SanitizedConversation {
  conversation: ConversationSummary;
  migrated: boolean;
}

interface ParsedConversationIndex extends ConversationIndexPayload {
  shouldPersist: boolean;
}

function isConversationSummary(value: unknown): value is ConversationSummaryCandidate {
  return typeof value === 'object'
    && value !== null
    && typeof (value as ConversationSummaryCandidate).id === 'string'
    && typeof (value as ConversationSummaryCandidate).title === 'string';
}

function warnTimestampBackfill(id: string, fields: string[]) {
  if (!isChorusDevMode()) return;
  console.warn(`[Chorus] Migrated conversation index entry "${id}" by backfilling missing ${fields.join(' and ')}.`);
}

function sanitizeConversation(
  value: ConversationSummaryCandidate,
  defaultTitle: string,
  now: () => Date | string | number,
): SanitizedConversation {
  const hasCreatedAt = typeof value.createdAt === 'string';
  const hasUpdatedAt = typeof value.updatedAt === 'string';
  const timestamp = hasCreatedAt || hasUpdatedAt ? null : getTimestamp(now);
  const createdAt = hasCreatedAt
    ? value.createdAt as string
    : hasUpdatedAt
      ? value.updatedAt as string
      : timestamp as string;
  const updatedAt = hasUpdatedAt
    ? value.updatedAt as string
    : hasCreatedAt
      ? value.createdAt as string
      : timestamp as string;
  const missingTimestampFields = [
    ...(!hasCreatedAt ? ['createdAt'] : []),
    ...(!hasUpdatedAt ? ['updatedAt'] : []),
  ];

  if (missingTimestampFields.length > 0) warnTimestampBackfill(value.id, missingTimestampFields);

  const hasPristine = typeof value.pristine === 'boolean';
  const pristine = hasPristine ? value.pristine as boolean : value.title.trim() === defaultTitle.trim();

  return {
    conversation: {
      id: value.id,
      title: value.title,
      createdAt,
      updatedAt,
      ...(value.pinned !== undefined ? { pinned: Boolean(value.pinned) } : {}),
      pristine,
    },
    migrated: missingTimestampFields.length > 0 || !hasPristine,
  };
}

function chooseActiveId(conversations: ConversationSummary[], preferredId?: string | null) {
  if (preferredId && conversations.some(conversation => conversation.id === preferredId)) return preferredId;
  return conversations[0]?.id ?? null;
}

function parseConversationIndex(
  raw: string | null,
  preferredActiveId: string | null | undefined,
  defaultTitle: string,
  now: () => Date | string | number,
): ParsedConversationIndex {
  if (!raw) return { conversations: [], activeId: null, shouldPersist: false };

  const parsed = JSON.parse(raw) as unknown;
  const source = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { conversations?: unknown }).conversations)
      ? (parsed as { conversations: unknown[] }).conversations
      : [];
  const sanitized = source.filter(isConversationSummary).map(conversation => sanitizeConversation(conversation, defaultTitle, now));
  const conversations = sanitized.map(result => result.conversation);
  const storedActiveId = typeof parsed === 'object'
    && parsed !== null
    && typeof (parsed as { activeId?: unknown }).activeId === 'string'
    ? (parsed as { activeId: string }).activeId
    : null;

  return {
    conversations,
    activeId: chooseActiveId(conversations, preferredActiveId ?? storedActiveId),
    shouldPersist: sanitized.some(result => result.migrated),
  };
}

function serializeConversationIndex(conversations: ConversationSummary[], activeId: string | null) {
  return JSON.stringify({ conversations, activeId });
}

function emptyState(): ConversationsState {
  return { conversations: [], activeId: null, loaded: true };
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) return error as Error;
  return new Error(String(error));
}

function createConversationStorageError(
  key: string,
  operation: ConversationStorageOperation,
  error: unknown,
  conversationId?: string,
): ConversationStorageError {
  const nextError = toError(error) as ConversationStorageError;
  nextError.key = key;
  nextError.operation = operation;
  nextError.conversationId = conversationId;
  nextError.cause = error;
  return nextError;
}

function stateFromRaw(
  raw: string | null,
  preferredActiveId: string | null | undefined,
  indexKey: string,
  defaultTitle: string,
  now: () => Date | string | number,
): ParsedConversationState {
  try {
    const index = parseConversationIndex(raw, preferredActiveId, defaultTitle, now);
    return {
      state: { conversations: index.conversations, activeId: index.activeId, loaded: true },
      error: null,
      shouldPersist: index.shouldPersist,
    };
  } catch (error) {
    return {
      state: emptyState(),
      error: createConversationStorageError(indexKey, 'read', error),
      shouldPersist: false,
    };
  }
}

function mergePendingCreates(state: ConversationsState, pendingCreates: PendingConversationCreate[]): ConversationsState {
  if (pendingCreates.length === 0) return state;

  const pendingConversations = pendingCreates.map(create => create.conversation);
  const pendingIds = new Set(pendingConversations.map(conversation => conversation.id));
  return {
    conversations: [
      ...pendingConversations.slice().reverse(),
      ...state.conversations.filter(conversation => !pendingIds.has(conversation.id)),
    ],
    activeId: pendingConversations[pendingConversations.length - 1]?.id ?? state.activeId,
    loaded: true,
  };
}

function getConversationIdFromKey(key: string, prefix: string) {
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

function titleFromFirstMessage(
  messages: Pick<Message, 'role' | 'text'>[],
  { fallbackTitle, maxLength = DEFAULT_FIRST_MESSAGE_TITLE_MAX_LENGTH }: Pick<RenameFromFirstMessageOptions, 'fallbackTitle' | 'maxLength'> = {},
) {
  const firstUserText = messages.find(message => message.role === 'user' && (message.text ?? '').trim().length > 0)?.text;
  const normalized = (firstUserText ?? fallbackTitle ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const limit = Math.max(1, maxLength);
  if (normalized.length <= limit) return normalized;
  if (limit === 1) return '…';
  return `${normalized.slice(0, limit - 1).trimEnd()}…`;
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
  const initialSyncReadRef = React.useRef<InitialSyncRead | null>(null);
  const pendingCreatesRef = React.useRef<PendingConversationCreate[]>([]);
  const initialCleanIndexStateRef = React.useRef<ConversationsState | null>(null);
  const pendingIndexWriteRef = React.useRef<PendingIndexWrite | null>(null);
  const indexWriteTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const indexWriteChainRef = React.useRef(Promise.resolve());
  const indexWriteInFlightRef = React.useRef(false);
  const initialErrorRef = React.useRef<ConversationStorageError | null>(null);
  const storageRef = React.useRef(storage);
  storageRef.current = storage;
  const indexKeyRef = React.useRef(indexKey);
  indexKeyRef.current = indexKey;
  const messageKeyPrefixRef = React.useRef(messageKeyPrefix);
  messageKeyPrefixRef.current = messageKeyPrefix;
  const defaultTitleRef = useLatestRef(defaultTitle);
  const createIdRef = useLatestRef(createId);
  const nowRef = useLatestRef(now);
  const onErrorRef = useLatestRef(options.onError);

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
      initialSyncReadRef.current = { storage, indexKey };
      const parsed = stateFromRaw(raw, options.initialActiveId, indexKey, defaultTitle, now);
      initialErrorRef.current = parsed.error;
      if (!parsed.error && parsed.shouldPersist) initialCleanIndexStateRef.current = parsed.state;
      return parsed.state;
    } catch (readError) {
      initialSyncReadRef.current = { storage, indexKey };
      initialErrorRef.current = createConversationStorageError(indexKey, 'read', readError);
      return emptyState();
    }
  });
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
    const nextError = rawError && typeof rawError === 'object' && 'operation' in rawError && 'key' in rawError
      ? rawError as ConversationStorageError
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
      indexWriteTimerRef.current = setTimeout(flushPendingIndexWrite, INDEX_TOUCH_WRITE_DEBOUNCE_MS);
      return;
    }

    flushPendingIndexWrite();
  }, [flushPendingIndexWrite, reportError]);

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

  const touchConversation = React.useCallback((id: string) => {
    const current = stateRef.current;
    if (!current.loaded || !current.conversations.some(conversation => conversation.id === id)) return;

    const timestamp = getTimestamp(nowRef.current);
    const conversations = current.conversations.map(conversation => (
      conversation.id === id ? { ...conversation, updatedAt: timestamp } : conversation
    ));
    commit(conversations, current.activeId, 'debounced');
  }, [commit, nowRef]);

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
      if (isPromiseLike<void>(result)) Promise.resolve(result).catch(deleteError => reportError(deleteError, 'delete', messageKey, id));
    } catch (deleteError) {
      reportError(deleteError, 'delete', messageKey, id);
    }
  }, [reportError]);

  React.useEffect(() => () => {
    flushPendingIndexWrite();
  }, [flushPendingIndexWrite, indexKey, storage]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    const handlePageHide = () => flushPendingIndexWrite();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushPendingIndexWrite();
    };

    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [flushPendingIndexWrite]);

  React.useEffect(() => {
    let cancelled = false;
    pendingCreatesRef.current = pendingCreatesRef.current.filter(pendingCreate => (
      pendingCreate.storage === storage && pendingCreate.indexKey === indexKey
    ));

    const takePendingCreatesForSource = () => {
      const matching: PendingConversationCreate[] = [];
      const remaining: PendingConversationCreate[] = [];
      for (const pendingCreate of pendingCreatesRef.current) {
        if (pendingCreate.storage === storage && pendingCreate.indexKey === indexKey) matching.push(pendingCreate);
        else remaining.push(pendingCreate);
      }
      pendingCreatesRef.current = remaining;
      return matching;
    };

    const applyRead = (raw: string | null, version: number) => {
      if (!cancelled && versionRef.current === version) {
        const parsed = stateFromRaw(raw, options.initialActiveId, indexKey, defaultTitleRef.current, nowRef.current);
        const pendingCreates = takePendingCreatesForSource();

        if (!parsed.error && pendingCreates.length > 0) {
          const mergedState = mergePendingCreates(parsed.state, pendingCreates);
          setError(null);
          commit(mergedState.conversations, mergedState.activeId);
          return;
        }

        stateRef.current = parsed.state;
        setState(parsed.state);
        if (parsed.error) reportError(parsed.error, 'read', indexKey);
        else {
          setError(null);
          if (parsed.shouldPersist) persistIndex(parsed.state.conversations, parsed.state.activeId);
        }
      }
    };

    const applyReadError = (readError: unknown, version: number) => {
      if (!cancelled && versionRef.current === version) {
        takePendingCreatesForSource();
        const nextState = emptyState();
        stateRef.current = nextState;
        setState(nextState);
        reportError(readError, 'read', indexKey);
      }
    };

    if (!storage) {
      const nextState = emptyState();
      stateRef.current = nextState;
      setState(nextState);
      return () => { cancelled = true; };
    }

    const initialSyncRead = initialSyncReadRef.current;
    if (initialSyncRead?.storage === storage && initialSyncRead.indexKey === indexKey) {
      initialSyncReadRef.current = null;
      const cleanState = initialCleanIndexStateRef.current;
      initialCleanIndexStateRef.current = null;
      if (cleanState) persistIndex(cleanState.conversations, cleanState.activeId);
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
        .catch(readError => applyReadError(readError, pendingInitialRead.version));
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
          .catch(readError => applyReadError(readError, version));
      } else {
        applyRead(raw, version);
      }
    } catch (readError) {
      applyReadError(readError, version);
    }

    return () => { cancelled = true; };
  }, [commit, defaultTitleRef, indexKey, nowRef, options.initialActiveId, persistIndex, reportError, storage]);

  const createConversation = React.useCallback((title?: string) => {
    const id = createIdRef.current();
    const timestamp = getTimestamp(nowRef.current);
    const normalizedTitle = normalizeTitle(title, defaultTitleRef.current);
    const conversation: ConversationSummary = {
      id,
      title: normalizedTitle,
      createdAt: timestamp,
      updatedAt: timestamp,
      pristine: normalizedTitle.trim() === defaultTitleRef.current.trim(),
    };

    const current = stateRef.current;
    const targetStorage = storageRef.current;
    if (!current.loaded && targetStorage) {
      pendingCreatesRef.current = pendingCreatesRef.current
        .filter(pendingCreate => !(pendingCreate.storage === targetStorage && pendingCreate.indexKey === indexKeyRef.current && pendingCreate.conversation.id === id))
        .concat({ storage: targetStorage, indexKey: indexKeyRef.current, conversation });
      return id;
    }

    const conversations = [
      conversation,
      ...current.conversations.filter(existing => existing.id !== id),
    ];
    commit(conversations, id);
    return id;
  }, [commit, createIdRef, defaultTitleRef, nowRef, stateRef]);

  const selectConversation = React.useCallback((id: string) => {
    const current = stateRef.current;
    if (!current.loaded || !current.conversations.some(conversation => conversation.id === id)) return;

    const timestamp = getTimestamp(nowRef.current);
    const conversations = current.conversations.map(conversation => (
      conversation.id === id ? { ...conversation, updatedAt: timestamp } : conversation
    ));
    commit(conversations, id);
  }, [commit, nowRef]);

  const renameConversation = React.useCallback((id: string, title: string) => {
    const current = stateRef.current;
    const trimmed = title.trim();
    if (!current.loaded || !trimmed || !current.conversations.some(conversation => conversation.id === id)) return;

    const timestamp = getTimestamp(nowRef.current);
    const conversations = current.conversations.map(conversation => (
      conversation.id === id ? { ...conversation, title: trimmed, updatedAt: timestamp, pristine: false } : conversation
    ));
    commit(conversations, current.activeId);
  }, [commit, nowRef]);

  const renameFromFirstMessage = React.useCallback((id: string, messages: Pick<Message, 'role' | 'text'>[], renameOptions: RenameFromFirstMessageOptions = {}) => {
    const current = stateRef.current;
    if (!current.loaded) return;
    const conversation = current.conversations.find(existing => existing.id === id);
    if (!conversation) return;
    if (!renameOptions.overwrite && conversation.pristine === false) return;

    const generatedTitle = titleFromFirstMessage(messages, renameOptions);
    if (!generatedTitle || generatedTitle === conversation.title) return;

    const timestamp = getTimestamp(nowRef.current);
    const conversations = current.conversations.map(existing => (
      existing.id === id ? { ...existing, title: generatedTitle, updatedAt: timestamp, pristine: false } : existing
    ));
    commit(conversations, current.activeId);
  }, [commit, nowRef]);

  const deleteConversation = React.useCallback((id: string) => {
    const current = stateRef.current;
    if (!current.loaded || !current.conversations.some(conversation => conversation.id === id)) return;

    removeConversationMessages(id);
    const conversations = current.conversations.filter(conversation => conversation.id !== id);
    const activeId = current.activeId === id ? conversations[0]?.id ?? null : current.activeId;
    commit(conversations, activeId);
  }, [commit, removeConversationMessages, stateRef]);

  const pinConversation = React.useCallback((id: string, pinned = true) => {
    const current = stateRef.current;
    if (!current.loaded || !current.conversations.some(conversation => conversation.id === id)) return;

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
