import React from 'react';
import type { Message } from '../types';
import { useLatestRef } from './useLatestRef';
import { createPersistenceError, isPersistenceError, warnPersistenceError } from './persistence/errors';
import { useLocalStorageSync } from './persistence/localStorageSync';
import { defaultDeserializeMessages, defaultSerializeMessages, type PersistenceState } from './persistence/messageCodec';
import { usePageLifecycleFlush } from './persistence/pageLifecycle';
import { type PendingPreloadChange } from './persistence/preloadReplay';
import {
  initializePersistenceState,
  resolveStorage,
  usePersistenceReadLifecycle,
  type InitialSyncRead,
  type PendingRead,
} from './persistence/readLifecycle';
import type {
  ChorusPersistenceError,
  DeserializeMessages,
  PersistenceOperation,
  PersistenceWriteOptions,
  SerializeMessages,
  UseChorusPersistenceOptions,
  UseChorusPersistenceResult,
} from './persistence/types';
import { usePersistenceWriteQueue } from './persistence/writeQueue';

export type {
  ChorusPersistenceError,
  DeserializeMessages,
  PersistenceOperation,
  PersistenceWriteOptions,
  SerializeMessages,
  UseChorusPersistenceOptions,
  UseChorusPersistenceResult,
} from './persistence/types';

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

  const [state, setState] = React.useState<PersistenceState<TMeta>>(() => initializePersistenceState<TMeta>(
    key,
    storage,
    deserializeMessages,
    writeVersionRef,
    initialAsyncReadRef,
    initialSyncReadRef,
    initialErrorRef,
  ));
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

  const { flush, flushForPageLifecycle, queueWrite, writeCoordination } = usePersistenceWriteQueue<TMeta>({
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

  usePageLifecycleFlush(flushForPageLifecycle);

  useLocalStorageSync(
    key,
    storage,
    stateRef,
    setState,
    setError,
    writeVersionRef,
    serializeMessagesRef,
    deserializeMessagesRef,
    reportPersistenceError,
    writeCoordination,
  );

  usePersistenceReadLifecycle(
    key,
    storage,
    writeVersionRef,
    stateRef,
    setState,
    setError,
    initialAsyncReadRef,
    initialSyncReadRef,
    pendingPreloadChangeRef,
    deserializeMessagesRef,
    queueWrite,
    reportPersistenceError,
  );

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
