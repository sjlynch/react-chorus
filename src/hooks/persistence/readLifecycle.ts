import React from 'react';
import type { StorageAdapter } from '../../types';
import { isPromiseLike } from '../../utils/async';
import { createPersistenceError } from './errors';
import { emptyState, stateFromRaw, type PersistenceState } from './messageCodec';
import {
  applyReadFailurePlan,
  applyReadLoadingState,
  applyReadSourcePlan,
  applyReadSuccessPlan,
  type ReadLifecycleEffectAdapter,
} from './readApply';
import {
  planReadFailure,
  planReadSourceChange,
  planReadSuccess,
  shouldApplyRead,
  type InitialSyncRead,
  type MutableRef,
  type PendingRead,
  type ReadFailurePlan,
  type ReadSourcePlan,
  type ReadSuccessPlan,
} from './readPlanning';
import type {
  ChorusPersistenceError,
  DeserializeMessages,
  UseChorusPersistenceOptions,
} from './types';

// Re-exported so `useChorusPersistence` and any other consumer can keep
// importing the planning surface from this module's path unchanged.
export { planReadFailure, planReadSourceChange, planReadSuccess };
export type { InitialSyncRead, PendingRead, ReadFailurePlan, ReadSourcePlan, ReadSuccessPlan };

export interface PersistenceReadLifecycleArgs<TMeta = Record<string, unknown>> extends ReadLifecycleEffectAdapter<TMeta> {
  key: string;
  storage: StorageAdapter | null;
  deserializeMessagesRef: MutableRef<DeserializeMessages<TMeta>>;
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

export function usePersistenceReadLifecycle<TMeta = Record<string, unknown>>({
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
}: PersistenceReadLifecycleArgs<TMeta>) {
  React.useEffect(() => {
    let cancelled = false;
    const adapter: ReadLifecycleEffectAdapter<TMeta> = {
      writeVersionRef,
      stateRef,
      setState,
      setError,
      initialAsyncReadRef,
      initialSyncReadRef,
      pendingPreloadChangeRef,
      queueWrite,
      reportPersistenceError,
    };

    const sourcePlan = planReadSourceChange<TMeta>(
      key,
      storage,
      writeVersionRef.current,
      initialAsyncReadRef.current,
      initialSyncReadRef.current,
      pendingPreloadChangeRef.current,
    );
    applyReadSourcePlan(sourcePlan, adapter);

    const applyRead = (raw: string | null, readKey: string, readStorage: StorageAdapter, writeVersion: number) => {
      if (!shouldApplyRead(writeVersionRef, writeVersion, cancelled)) return;
      const successPlan = planReadSuccess<TMeta>(
        readKey,
        readStorage,
        raw,
        deserializeMessagesRef.current,
        pendingPreloadChangeRef.current,
        writeVersionRef.current,
      );
      applyReadSuccessPlan(successPlan, adapter);
    };

    const applyReadError = (readError: unknown, readKey: string, readStorage: StorageAdapter, writeVersion: number) => {
      if (!shouldApplyRead(writeVersionRef, writeVersion, cancelled)) return;
      const failurePlan = planReadFailure<TMeta>(
        readKey,
        readStorage,
        readError,
        pendingPreloadChangeRef.current,
      );
      applyReadFailurePlan(failurePlan, adapter);
    };

    if (sourcePlan.kind === 'disabled' || sourcePlan.kind === 'use-initial-sync') {
      return () => { cancelled = true; };
    }

    if (sourcePlan.kind === 'use-initial-async') {
      const { pendingRead } = sourcePlan;
      pendingRead.promise
        .then(raw => applyRead(raw, pendingRead.key, pendingRead.storage, pendingRead.writeVersion))
        .catch(readError => applyReadError(readError, pendingRead.key, pendingRead.storage, pendingRead.writeVersion));
      return () => { cancelled = true; };
    }

    const { key: readKey, storage: readStorage, writeVersion } = sourcePlan;
    try {
      const raw = readStorage.getItem(readKey);
      if (isPromiseLike<string | null>(raw)) {
        const promise = Promise.resolve(raw);
        promise.catch(() => {});
        applyReadLoadingState(emptyState<TMeta>(readKey, readStorage, false), writeVersion, adapter);
        promise
          .then(str => applyRead(str, readKey, readStorage, writeVersion))
          .catch(readError => applyReadError(readError, readKey, readStorage, writeVersion));
      } else {
        applyRead(raw, readKey, readStorage, writeVersion);
      }
    } catch (readError) {
      applyReadError(readError, readKey, readStorage, writeVersion);
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
