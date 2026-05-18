import React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Message, StorageAdapter } from '../../types';
import { isPromiseLike } from '../../utils/async';
import { createPersistenceError } from './errors';
import { emptyState, stateFromRaw, type PersistenceState } from './messageCodec';
import { replayPreloadChangeAfterEmptyRead, type PendingPreloadChange } from './preloadReplay';
import type {
  ChorusPersistenceError,
  DeserializeMessages,
  PersistenceOperation,
  UseChorusPersistenceOptions,
} from './types';

interface MutableRef<T> {
  current: T;
}

export interface PendingRead {
  key: string;
  storage: StorageAdapter;
  promise: Promise<string | null>;
  writeVersion: number;
}

export interface InitialSyncRead {
  key: string;
  storage: StorageAdapter;
}

export function resolveDefaultStorage(): StorageAdapter | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function resolveStorage<TMeta>(options?: UseChorusPersistenceOptions<TMeta>): StorageAdapter | null {
  if (options?.storage !== undefined) return options.storage;
  return resolveDefaultStorage();
}

export function initializePersistenceState<TMeta = Record<string, unknown>>(
  key: string,
  storage: StorageAdapter | null,
  deserializeMessages: DeserializeMessages<TMeta>,
  writeVersionRef: MutableRef<number>,
  initialAsyncReadRef: MutableRef<PendingRead | null>,
  initialSyncReadRef: MutableRef<InitialSyncRead | null>,
  initialErrorRef: MutableRef<ChorusPersistenceError | null>,
): PersistenceState<TMeta> {
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
}

export function usePersistenceReadLifecycle<TMeta = Record<string, unknown>>(
  key: string,
  storage: StorageAdapter | null,
  writeVersionRef: MutableRef<number>,
  stateRef: MutableRef<PersistenceState<TMeta>>,
  setState: Dispatch<SetStateAction<PersistenceState<TMeta>>>,
  setError: Dispatch<SetStateAction<ChorusPersistenceError | null>>,
  initialAsyncReadRef: MutableRef<PendingRead | null>,
  initialSyncReadRef: MutableRef<InitialSyncRead | null>,
  pendingPreloadChangeRef: MutableRef<PendingPreloadChange<TMeta> | null>,
  deserializeMessagesRef: MutableRef<DeserializeMessages<TMeta>>,
  queueWrite: (messages: Message<TMeta>[], version: number, flushNow: boolean, removeIfEmpty: boolean) => void,
  reportPersistenceError: (rawError: unknown, operation: PersistenceOperation, errorKey?: string) => void,
) {
  React.useEffect(() => {
    let cancelled = false;
    const pendingPreloadChange = pendingPreloadChangeRef.current;
    if (pendingPreloadChange && (pendingPreloadChange.key !== key || pendingPreloadChange.storage !== storage)) {
      pendingPreloadChangeRef.current = null;
    }

    const applyRead = (raw: string | null, writeVersion: number) => {
      if (!storage) return;
      if (!cancelled && writeVersionRef.current === writeVersion) {
        const parsed = stateFromRaw<TMeta>(key, storage, raw, deserializeMessagesRef.current);

        if (replayPreloadChangeAfterEmptyRead(
          pendingPreloadChangeRef,
          key,
          storage,
          raw,
          parsed.error,
          writeVersionRef,
          stateRef,
          setState,
          setError,
          queueWrite,
        )) return;

        stateRef.current = parsed.state;
        setState(parsed.state);
        if (parsed.error) reportPersistenceError(parsed.error, 'deserialize', key);
        else setError(null);
      }
    };

    const applyReadError = (readError: unknown, writeVersion: number) => {
      if (!storage) return;
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
  }, [
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
  ]);
}
