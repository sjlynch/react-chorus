import React from 'react';
import type { Message, StorageAdapter } from '../types';
import { useLatestRef } from './useLatestRef';

export type SerializeMessages<TMeta = Record<string, unknown>> = (messages: Message<TMeta>[]) => string;
export type DeserializeMessages<TMeta = Record<string, unknown>> = (raw: string) => Message<TMeta>[];

export interface UseChorusPersistenceOptions<TMeta = Record<string, unknown>> {
  storage?: StorageAdapter | null;
  /** Debounce storage writes by this many milliseconds. Defaults to 0 for immediate writes. */
  writeDebounceMs?: number;
  /** Called when a persistence write fails. */
  onError?: (error: Error) => void;
  /** Override message serialization. Defaults to JSON.stringify(messages). */
  serializeMessages?: SerializeMessages<TMeta>;
  /** Override message deserialization. Defaults to JSON.parse with an array guard. */
  deserializeMessages?: DeserializeMessages<TMeta>;
}

export interface PersistenceWriteOptions {
  /** Flush this update to storage immediately instead of waiting for the debounce window. */
  flush?: boolean;
  /** Remove the storage key when this write is an empty message list and removeItem is available. */
  removeIfEmpty?: boolean;
}

export interface UseChorusPersistenceResult<TMeta = Record<string, unknown>> {
  value: Message<TMeta>[];
  onChange: (messages: Message<TMeta>[], options?: PersistenceWriteOptions) => void;
  /** Flushes the latest debounced write, if one is pending. */
  flush: () => void;
  /** Last persistence write error, if any. Cleared after the latest write succeeds. */
  error: Error | null;
  /** True once the current key/storage pair has completed its initial read. */
  loaded: boolean;
  /** True when storage already had a value for the key, or this hook has written one. */
  hasStoredValue: boolean;
  /** False when the key is empty or storage is unavailable. */
  canPersist: boolean;
}

interface PersistenceState<TMeta = Record<string, unknown>> {
  key: string;
  storage: StorageAdapter | null;
  value: Message<TMeta>[];
  loaded: boolean;
  hasStoredValue: boolean;
}

interface PendingRead {
  key: string;
  storage: StorageAdapter;
  promise: Promise<string | null>;
  writeVersion: number;
}

interface PendingWrite {
  key: string;
  storage: StorageAdapter;
  serialized: string;
  version: number;
  remove: boolean;
}

function resolveDefaultStorage(): StorageAdapter | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function resolveStorage<TMeta>(options?: UseChorusPersistenceOptions<TMeta>): StorageAdapter | null {
  if (options?.storage !== undefined) return options.storage;
  return resolveDefaultStorage();
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof (value as { then?: unknown }).then === 'function';
}

function defaultSerializeMessages<TMeta>(messages: Message<TMeta>[]): string {
  const serialized = JSON.stringify(messages);
  if (serialized === undefined) throw new Error('Unable to serialize messages.');
  return serialized;
}

function defaultDeserializeMessages<TMeta>(raw: string): Message<TMeta>[] {
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed as Message<TMeta>[] : [];
}

function parseStoredMessages<TMeta = Record<string, unknown>>(
  raw: string | null,
  deserializeMessages: DeserializeMessages<TMeta>,
): Message<TMeta>[] {
  if (!raw) return [];
  try {
    const parsed = deserializeMessages(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function emptyState<TMeta>(key: string, storage: StorageAdapter | null, loaded: boolean): PersistenceState<TMeta> {
  return { key, storage, value: [], loaded, hasStoredValue: false };
}

function stateFromRaw<TMeta>(
  key: string,
  storage: StorageAdapter | null,
  raw: string | null,
  deserializeMessages: DeserializeMessages<TMeta>,
): PersistenceState<TMeta> {
  return {
    key,
    storage,
    value: parseStoredMessages<TMeta>(raw, deserializeMessages),
    loaded: true,
    hasStoredValue: raw !== null,
  };
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) return error as Error;
  return new Error(String(error));
}

function writeToStorage(write: PendingWrite): void | Promise<void> {
  if (write.remove && write.storage.removeItem) return write.storage.removeItem(write.key);
  return write.storage.setItem(write.key, write.serialized);
}

/**
 * Persists Chorus messages to a storage adapter (defaults to localStorage).
 * Returns { value, onChange } which can be spread directly onto <Chorus>.
 *
 * The storage adapter interface is pluggable — pass any object with
 * getItem/setItem to use sessionStorage, IndexedDB, a remote API, etc. Adapters
 * may also implement removeItem so cleared conversations can delete their key.
 *
 * Writes are serialized so async adapters cannot let an older save overwrite a
 * newer one. Pass writeDebounceMs to coalesce rapid updates (for example token
 * streams), and call flush() or pass { flush: true } for lifecycle boundaries.
 *
 * Message data is serialized with JSON by default. Pass serializeMessages and
 * deserializeMessages when you need custom validation or Date/class revival.
 *
 * @example — localStorage (default)
 * const persist = useChorusPersistence('my-chat');
 * return <Chorus {...persist} onSend={...} />;
 *
 * @example — sessionStorage
 * const persist = useChorusPersistence('my-chat', { storage: sessionStorage });
 *
 * @example — async adapter (IndexedDB wrapper, custom backend, etc.)
 * const persist = useChorusPersistence('my-chat', { storage: myAsyncAdapter });
 */
export function useChorusPersistence<TMeta = Record<string, unknown>>(
  key: string,
  options?: UseChorusPersistenceOptions<TMeta>,
): UseChorusPersistenceResult<TMeta> {
  const storage = resolveStorage(options);
  const deserializeMessages = options?.deserializeMessages ?? defaultDeserializeMessages<TMeta>;
  const writeVersionRef = React.useRef(0);
  const initialAsyncReadRef = React.useRef<PendingRead | null>(null);
  const pendingWriteRef = React.useRef<PendingWrite | null>(null);
  const writeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeChainRef = React.useRef(Promise.resolve());
  const writeInFlightRef = React.useRef(false);
  const asyncWriteInFlightRef = React.useRef(false);
  const mountedRef = React.useRef(false);
  const onErrorRef = useLatestRef(options?.onError);
  const writeDebounceMsRef = useLatestRef(Math.max(0, options?.writeDebounceMs ?? 0));
  const serializeMessagesRef = React.useRef<SerializeMessages<TMeta>>(options?.serializeMessages ?? defaultSerializeMessages<TMeta>);
  serializeMessagesRef.current = options?.serializeMessages ?? defaultSerializeMessages<TMeta>;
  const deserializeMessagesRef = React.useRef<DeserializeMessages<TMeta>>(deserializeMessages);
  deserializeMessagesRef.current = deserializeMessages;

  const [error, setError] = React.useState<Error | null>(null);
  const [state, setState] = React.useState<PersistenceState<TMeta>>(() => {
    if (!key || !storage) return emptyState<TMeta>(key, storage, true);

    try {
      const raw = storage.getItem(key);
      if (isPromiseLike<string | null>(raw)) {
        const promise = Promise.resolve(raw);
        promise.catch(() => {});
        initialAsyncReadRef.current = {
          key,
          storage,
          promise,
          writeVersion: writeVersionRef.current,
        };
        return emptyState<TMeta>(key, storage, false);
      }
      return stateFromRaw<TMeta>(key, storage, raw, deserializeMessages);
    } catch {
      return emptyState<TMeta>(key, storage, true);
    }
  });

  // Stable refs so the onChange callback never needs to change
  const storageRef = React.useRef(storage);
  storageRef.current = storage;
  const keyRef = React.useRef(key);
  keyRef.current = key;

  const reportWriteError = React.useCallback((rawError: unknown) => {
    const nextError = toError(rawError);
    if (mountedRef.current) setError(nextError);

    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Chorus] Failed to persist messages.', nextError);
    }

    onErrorRef.current?.(nextError);
  }, [onErrorRef]);

  const markWriteSuccess = React.useCallback((write: PendingWrite) => {
    if (mountedRef.current && write.version === writeVersionRef.current) setError(null);
  }, []);

  const runWrite = React.useCallback(async (write: PendingWrite) => {
    try {
      const result = writeToStorage(write);
      if (isPromiseLike<void>(result)) {
        asyncWriteInFlightRef.current = true;
        await result;
      }
      markWriteSuccess(write);
    } catch (writeError) {
      reportWriteError(writeError);
    }
  }, [markWriteSuccess, reportWriteError]);

  const runWriteImmediately = React.useCallback((write: PendingWrite) => {
    try {
      const result = writeToStorage(write);
      if (isPromiseLike<void>(result)) {
        writeInFlightRef.current = true;
        asyncWriteInFlightRef.current = true;
        const tracked = Promise.resolve(result)
          .then(() => { markWriteSuccess(write); }, reportWriteError)
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
      reportWriteError(writeError);
    }
  }, [markWriteSuccess, reportWriteError]);

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
        reportWriteError(serializationError);
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
  }, [flush, reportWriteError, serializeMessagesRef, writeDebounceMsRef]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      flush();
    };
  }, [flush]);

  React.useEffect(() => () => {
    flush();
  }, [key, storage, flush]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    const handlePageHide = () => flushForPageLifecycle();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushForPageLifecycle();
    };

    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [flushForPageLifecycle]);

  React.useEffect(() => {
    let cancelled = false;

    const applyRead = (raw: string | null, writeVersion: number) => {
      if (!cancelled && writeVersionRef.current === writeVersion) {
        setState(stateFromRaw<TMeta>(key, storage, raw, deserializeMessagesRef.current));
      }
    };

    const applyReadError = (writeVersion: number) => {
      if (!cancelled && writeVersionRef.current === writeVersion) {
        setState(emptyState<TMeta>(key, storage, true));
      }
    };

    if (!key || !storage) {
      setState(emptyState<TMeta>(key, storage, true));
      return () => { cancelled = true; };
    }

    const pendingInitialRead = initialAsyncReadRef.current;
    if (pendingInitialRead?.key === key && pendingInitialRead.storage === storage) {
      initialAsyncReadRef.current = null;
      setState(prev => (
        writeVersionRef.current === pendingInitialRead.writeVersion
          ? emptyState<TMeta>(key, storage, false)
          : prev
      ));
      pendingInitialRead.promise
        .then(raw => applyRead(raw, pendingInitialRead.writeVersion))
        .catch(() => applyReadError(pendingInitialRead.writeVersion));
      return () => { cancelled = true; };
    }

    const writeVersion = writeVersionRef.current;
    try {
      const raw = storage.getItem(key);
      if (isPromiseLike<string | null>(raw)) {
        const promise = Promise.resolve(raw);
        promise.catch(() => {});
        setState(prev => (
          writeVersionRef.current === writeVersion
            ? emptyState<TMeta>(key, storage, false)
            : prev
        ));
        promise
          .then(str => applyRead(str, writeVersion))
          .catch(() => applyReadError(writeVersion));
      } else {
        applyRead(raw, writeVersion);
      }
    } catch {
      applyReadError(writeVersion);
    }

    return () => { cancelled = true; };
  }, [key, storage, deserializeMessagesRef]);

  const onChange = React.useCallback((messages: Message<TMeta>[], writeOptions?: PersistenceWriteOptions) => {
    writeVersionRef.current += 1;
    const version = writeVersionRef.current;

    const k = keyRef.current;
    const s = storageRef.current;
    setState({ key: k, storage: s, value: messages, loaded: true, hasStoredValue: true });

    if (!k || !s) return;
    queueWrite(messages, version, Boolean(writeOptions?.flush), Boolean(writeOptions?.removeIfEmpty));
  }, [queueWrite]); // stable — reads key/storage from refs

  const stateMatchesCurrentSource = state.key === key && state.storage === storage;

  return {
    value: stateMatchesCurrentSource ? state.value : [],
    onChange,
    flush,
    error,
    loaded: stateMatchesCurrentSource ? state.loaded : !key || !storage,
    hasStoredValue: stateMatchesCurrentSource ? state.hasStoredValue : false,
    canPersist: Boolean(key && storage),
  };
}
