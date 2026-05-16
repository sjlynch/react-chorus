import React from 'react';
import type { Message, StorageAdapter } from '../types';
import { useLatestRef } from './useLatestRef';
import { isPromiseLike } from '../utils/async';
import { createPersistenceError, isPersistenceError, warnPersistenceError } from './persistence/errors';
import { defaultDeserializeMessages, defaultSerializeMessages, emptyState, stateFromRaw, type PersistenceState } from './persistence/messageCodec';
import { usePersistenceWriteQueue } from './persistence/writeQueue';

export type SerializeMessages<TMeta = Record<string, unknown>> = (messages: Message<TMeta>[]) => string;
export type DeserializeMessages<TMeta = Record<string, unknown>> = (raw: string) => Message<TMeta>[];
export type PersistenceOperation = 'read' | 'deserialize' | 'write' | 'remove';

export interface ChorusPersistenceError extends Error {
  key: string;
  operation: PersistenceOperation;
  cause?: unknown;
}

export interface UseChorusPersistenceOptions<TMeta = Record<string, unknown>> {
  storage?: StorageAdapter | null;
  /** Debounce storage writes by this many milliseconds. Defaults to 0 for immediate writes. */
  writeDebounceMs?: number;
  /** Called when a persistence read, deserialization, write, or remove operation fails. */
  onError?: (error: ChorusPersistenceError) => void;
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
  /** Last persistence error, if any. Cleared after the latest successful read or write for the current source. */
  error: ChorusPersistenceError | null;
  /** True once the current key/storage pair has completed its initial read. */
  loaded: boolean;
  /** True when storage already had a value for the key, or this hook has written one. */
  hasStoredValue: boolean;
  /** False when the key is empty or storage is unavailable. */
  canPersist: boolean;
}

interface PendingRead {
  key: string;
  storage: StorageAdapter;
  promise: Promise<string | null>;
  writeVersion: number;
}

interface InitialSyncRead {
  key: string;
  storage: StorageAdapter;
}

interface PendingPreloadChange<TMeta = Record<string, unknown>> {
  key: string;
  storage: StorageAdapter;
  messages: Message<TMeta>[];
  options?: PersistenceWriteOptions;
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

/**
 * Persists Chorus messages to a storage adapter (defaults to localStorage).
 * Returns { value, onChange } which can be spread directly onto <Chorus>.
 *
 * The storage adapter interface is pluggable — pass any object with
 * getItem/setItem to use sessionStorage, IndexedDB, a remote API, etc. Adapters
 * may also implement removeItem so unseeded empty conversations can delete their key.
 *
 * Writes are serialized so async adapters cannot let an older save overwrite a
 * newer one. Pass writeDebounceMs to coalesce rapid updates (for example token
 * streams), and call flush() or pass { flush: true } for lifecycle boundaries.
 * When getItem() is Promise-based, loaded is false until the initial read
 * resolves; gate custom composers on loaded. Pre-load onChange calls are held
 * and only replayed after the read confirms the key was empty.
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
  const initialSyncReadRef = React.useRef<InitialSyncRead | null>(null);
  const pendingPreloadChangeRef = React.useRef<PendingPreloadChange<TMeta> | null>(null);
  const initialErrorRef = React.useRef<ChorusPersistenceError | null>(null);
  const mountedRef = React.useRef(false);
  const onErrorRef = useLatestRef(options?.onError);
  const writeDebounceMsRef = useLatestRef(Math.max(0, options?.writeDebounceMs ?? 0));
  const serializeMessagesRef = React.useRef<SerializeMessages<TMeta>>(options?.serializeMessages ?? defaultSerializeMessages<TMeta>);
  serializeMessagesRef.current = options?.serializeMessages ?? defaultSerializeMessages<TMeta>;
  const deserializeMessagesRef = React.useRef<DeserializeMessages<TMeta>>(deserializeMessages);
  deserializeMessagesRef.current = deserializeMessages;

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
      initialSyncReadRef.current = { key, storage };
      const parsed = stateFromRaw<TMeta>(key, storage, raw, deserializeMessages);
      initialErrorRef.current = parsed.error;
      return parsed.state;
    } catch (readError) {
      initialSyncReadRef.current = { key, storage };
      initialErrorRef.current = createPersistenceError(key, 'read', readError);
      return emptyState<TMeta>(key, storage, true);
    }
  });
  const [error, setError] = React.useState<ChorusPersistenceError | null>(() => initialErrorRef.current);
  const stateRef = React.useRef(state);
  stateRef.current = state;

  // Stable refs so the onChange callback never needs to change
  const storageRef = React.useRef(storage);
  storageRef.current = storage;
  const keyRef = React.useRef(key);
  keyRef.current = key;

  const notifyPersistenceError = React.useCallback((nextError: ChorusPersistenceError) => {
    warnPersistenceError(nextError);
    onErrorRef.current?.(nextError);
  }, [onErrorRef]);

  const reportPersistenceError = React.useCallback((rawError: unknown, operation: PersistenceOperation, errorKey = keyRef.current) => {
    const nextError = isPersistenceError(rawError)
      ? rawError
      : createPersistenceError(errorKey, operation, rawError);
    if (mountedRef.current) setError(nextError);
    notifyPersistenceError(nextError);
  }, [notifyPersistenceError]);

  const markWriteSuccess = React.useCallback((writeVersion: number) => {
    if (mountedRef.current && writeVersion === writeVersionRef.current) setError(null);
  }, []);

  const { flush, flushForPageLifecycle, queueWrite } = usePersistenceWriteQueue<TMeta>({
    keyRef,
    storageRef,
    serializeMessagesRef,
    writeDebounceMsRef,
    onWriteSuccess: markWriteSuccess,
    reportPersistenceError,
  });

  React.useEffect(() => {
    mountedRef.current = true;
    if (initialErrorRef.current) {
      notifyPersistenceError(initialErrorRef.current);
      initialErrorRef.current = null;
    }
    return () => {
      mountedRef.current = false;
      flush();
    };
  }, [flush, notifyPersistenceError]);

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
    const pendingPreloadChange = pendingPreloadChangeRef.current;
    if (pendingPreloadChange && (pendingPreloadChange.key !== key || pendingPreloadChange.storage !== storage)) {
      pendingPreloadChangeRef.current = null;
    }

    const applyRead = (raw: string | null, writeVersion: number) => {
      if (!cancelled && writeVersionRef.current === writeVersion) {
        const parsed = stateFromRaw<TMeta>(key, storage, raw, deserializeMessagesRef.current);
        const pendingPreloadChange = pendingPreloadChangeRef.current;

        if (pendingPreloadChange?.key === key && pendingPreloadChange.storage === storage) {
          pendingPreloadChangeRef.current = null;
          if (!parsed.error && raw === null) {
            const nextVersion = writeVersionRef.current + 1;
            writeVersionRef.current = nextVersion;
            const nextState = { key, storage, value: pendingPreloadChange.messages, loaded: true, hasStoredValue: true };
            stateRef.current = nextState;
            setState(nextState);
            setError(null);
            queueWrite(
              pendingPreloadChange.messages,
              nextVersion,
              Boolean(pendingPreloadChange.options?.flush),
              Boolean(pendingPreloadChange.options?.removeIfEmpty),
            );
            return;
          }
        }

        stateRef.current = parsed.state;
        setState(parsed.state);
        if (parsed.error) reportPersistenceError(parsed.error, 'deserialize', key);
        else setError(null);
      }
    };

    const applyReadError = (readError: unknown, writeVersion: number) => {
      if (!cancelled && writeVersionRef.current === writeVersion) {
        const pendingPreloadChange = pendingPreloadChangeRef.current;
        if (pendingPreloadChange?.key === key && pendingPreloadChange.storage === storage) pendingPreloadChangeRef.current = null;
        const nextState = emptyState<TMeta>(key, storage, true);
        stateRef.current = nextState;
        setState(nextState);
        reportPersistenceError(readError, 'read', key);
      }
    };

    if (!key || !storage) {
      const nextState = emptyState<TMeta>(key, storage, true);
      stateRef.current = nextState;
      setState(nextState);
      return () => { cancelled = true; };
    }

    const initialSyncRead = initialSyncReadRef.current;
    if (initialSyncRead?.key === key && initialSyncRead.storage === storage) {
      initialSyncReadRef.current = null;
      return () => { cancelled = true; };
    }

    const pendingInitialRead = initialAsyncReadRef.current;
    if (pendingInitialRead?.key === key && pendingInitialRead.storage === storage) {
      initialAsyncReadRef.current = null;
      setState(prev => {
        if (writeVersionRef.current !== pendingInitialRead.writeVersion) return prev;
        const nextState = emptyState<TMeta>(key, storage, false);
        stateRef.current = nextState;
        return nextState;
      });
      pendingInitialRead.promise
        .then(raw => applyRead(raw, pendingInitialRead.writeVersion))
        .catch(readError => applyReadError(readError, pendingInitialRead.writeVersion));
      return () => { cancelled = true; };
    }

    const writeVersion = writeVersionRef.current;
    try {
      const raw = storage.getItem(key);
      if (isPromiseLike<string | null>(raw)) {
        const promise = Promise.resolve(raw);
        promise.catch(() => {});
        setState(prev => {
          if (writeVersionRef.current !== writeVersion) return prev;
          const nextState = emptyState<TMeta>(key, storage, false);
          stateRef.current = nextState;
          return nextState;
        });
        promise
          .then(str => applyRead(str, writeVersion))
          .catch(readError => applyReadError(readError, writeVersion));
      } else {
        applyRead(raw, writeVersion);
      }
    } catch (readError) {
      applyReadError(readError, writeVersion);
    }

    return () => { cancelled = true; };
  }, [key, storage, deserializeMessagesRef, queueWrite, reportPersistenceError]);

  const onChange = React.useCallback((messages: Message<TMeta>[], writeOptions?: PersistenceWriteOptions) => {
    const k = keyRef.current;
    const s = storageRef.current;
    const currentState = stateRef.current;
    const stateMatchesSource = currentState.key === k && currentState.storage === s;

    if (k && s && (!stateMatchesSource || !currentState.loaded)) {
      pendingPreloadChangeRef.current = { key: k, storage: s, messages, options: writeOptions };
      return;
    }

    writeVersionRef.current += 1;
    const version = writeVersionRef.current;
    const nextState = { key: k, storage: s, value: messages, loaded: true, hasStoredValue: true };
    stateRef.current = nextState;
    setState(nextState);

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
