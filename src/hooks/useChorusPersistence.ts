import React from 'react';
import type { Message, StorageAdapter } from '../types';

export interface UseChorusPersistenceOptions {
  storage?: StorageAdapter | null;
}

export interface UseChorusPersistenceResult {
  value: Message[];
  onChange: (messages: Message[]) => void;
  /** True once the current key/storage pair has completed its initial read. */
  loaded: boolean;
  /** True when storage already had a value for the key, or this hook has written one. */
  hasStoredValue: boolean;
  /** False when the key is empty or storage is unavailable. */
  canPersist: boolean;
}

interface PersistenceState {
  key: string;
  storage: StorageAdapter | null;
  value: Message[];
  loaded: boolean;
  hasStoredValue: boolean;
}

interface PendingRead {
  key: string;
  storage: StorageAdapter;
  promise: Promise<string | null>;
  writeVersion: number;
}

function resolveDefaultStorage(): StorageAdapter | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function resolveStorage(options?: UseChorusPersistenceOptions): StorageAdapter | null {
  if (options?.storage !== undefined) return options.storage;
  return resolveDefaultStorage();
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof (value as { then?: unknown }).then === 'function';
}

function parseStoredMessages(raw: string | null): Message[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as Message[] : [];
  } catch {
    return [];
  }
}

function emptyState(key: string, storage: StorageAdapter | null, loaded: boolean): PersistenceState {
  return { key, storage, value: [], loaded, hasStoredValue: false };
}

function stateFromRaw(key: string, storage: StorageAdapter | null, raw: string | null): PersistenceState {
  return {
    key,
    storage,
    value: parseStoredMessages(raw),
    loaded: true,
    hasStoredValue: raw !== null,
  };
}

/**
 * Persists Chorus messages to a storage adapter (defaults to localStorage).
 * Returns { value, onChange } which can be spread directly onto <Chorus>.
 *
 * The storage adapter interface is pluggable — pass any object with
 * getItem/setItem to use sessionStorage, IndexedDB, a remote API, etc.
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
export function useChorusPersistence(
  key: string,
  options?: UseChorusPersistenceOptions,
): UseChorusPersistenceResult {
  const storage = resolveStorage(options);
  const writeVersionRef = React.useRef(0);
  const initialAsyncReadRef = React.useRef<PendingRead | null>(null);

  const [state, setState] = React.useState<PersistenceState>(() => {
    if (!key || !storage) return emptyState(key, storage, true);

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
        return emptyState(key, storage, false);
      }
      return stateFromRaw(key, storage, raw);
    } catch {
      return emptyState(key, storage, true);
    }
  });

  // Stable refs so the onChange callback never needs to change
  const storageRef = React.useRef(storage);
  storageRef.current = storage;
  const keyRef = React.useRef(key);
  keyRef.current = key;

  React.useEffect(() => {
    let cancelled = false;

    const applyRead = (raw: string | null, writeVersion: number) => {
      if (!cancelled && writeVersionRef.current === writeVersion) {
        setState(stateFromRaw(key, storage, raw));
      }
    };

    const applyReadError = (writeVersion: number) => {
      if (!cancelled && writeVersionRef.current === writeVersion) {
        setState(emptyState(key, storage, true));
      }
    };

    if (!key || !storage) {
      setState(emptyState(key, storage, true));
      return () => { cancelled = true; };
    }

    const pendingInitialRead = initialAsyncReadRef.current;
    if (pendingInitialRead?.key === key && pendingInitialRead.storage === storage) {
      initialAsyncReadRef.current = null;
      setState(prev => (
        writeVersionRef.current === pendingInitialRead.writeVersion
          ? emptyState(key, storage, false)
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
            ? emptyState(key, storage, false)
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
  }, [key, storage]);

  const onChange = React.useCallback((messages: Message[]) => {
    writeVersionRef.current += 1;

    const k = keyRef.current;
    const s = storageRef.current;
    setState({ key: k, storage: s, value: messages, loaded: true, hasStoredValue: true });

    if (!k || !s) return;
    try {
      const result = s.setItem(k, JSON.stringify(messages));
      if (isPromiseLike<void>(result)) Promise.resolve(result).catch(() => {});
    } catch {}
  }, []); // stable — reads key/storage from refs

  const stateMatchesCurrentSource = state.key === key && state.storage === storage;

  return {
    value: stateMatchesCurrentSource ? state.value : [],
    onChange,
    loaded: stateMatchesCurrentSource ? state.loaded : !key || !storage,
    hasStoredValue: stateMatchesCurrentSource ? state.hasStoredValue : false,
    canPersist: Boolean(key && storage),
  };
}
