import React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Message, StorageAdapter } from '../../types';
import { isPromiseLike } from '../../utils/async';
import { createPersistenceError } from './errors';
import { emptyState, stateFromRaw, type PersistenceState } from './messageCodec';
import { planPreloadChangeAfterRead, type PendingPreloadChange, type PreloadReplayWrite } from './preloadReplay';
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

export type ReadSourcePlan<TMeta = Record<string, unknown>> =
  | { kind: 'disabled'; clearPendingPreload: boolean; state: PersistenceState<TMeta> }
  | { kind: 'use-initial-sync'; clearPendingPreload: boolean }
  | { kind: 'use-initial-async'; clearPendingPreload: boolean; pendingRead: PendingRead; loadingState: PersistenceState<TMeta> }
  | { kind: 'read-storage'; clearPendingPreload: boolean; key: string; storage: StorageAdapter; writeVersion: number };

export type ReadSuccessPlan<TMeta = Record<string, unknown>> =
  | { kind: 'apply-state'; clearPendingPreload: boolean; state: PersistenceState<TMeta>; error: ChorusPersistenceError | null }
  | { kind: 'replay-preload'; state: PersistenceState<TMeta>; write: PreloadReplayWrite<TMeta> };

export interface ReadFailurePlan<TMeta = Record<string, unknown>> {
  key: string;
  clearPendingPreload: boolean;
  state: PersistenceState<TMeta>;
  error: unknown;
}

interface ReadLifecycleEffectAdapter<TMeta = Record<string, unknown>> {
  writeVersionRef: MutableRef<number>;
  stateRef: MutableRef<PersistenceState<TMeta>>;
  setState: Dispatch<SetStateAction<PersistenceState<TMeta>>>;
  setError: Dispatch<SetStateAction<ChorusPersistenceError | null>>;
  initialAsyncReadRef: MutableRef<PendingRead | null>;
  initialSyncReadRef: MutableRef<InitialSyncRead | null>;
  pendingPreloadChangeRef: MutableRef<PendingPreloadChange<TMeta> | null>;
  queueWrite: (messages: Message<TMeta>[], version: number, flushNow: boolean, removeIfEmpty: boolean) => void;
  reportPersistenceError: (rawError: unknown, operation: PersistenceOperation, errorKey?: string) => void;
}

export interface PersistenceReadLifecycleArgs<TMeta = Record<string, unknown>> extends ReadLifecycleEffectAdapter<TMeta> {
  key: string;
  storage: StorageAdapter | null;
  deserializeMessagesRef: MutableRef<DeserializeMessages<TMeta>>;
}

function pendingPreloadMatchesSource<TMeta>(
  pendingPreloadChange: PendingPreloadChange<TMeta> | null,
  key: string,
  storage: StorageAdapter | null,
): boolean {
  return Boolean(pendingPreloadChange && pendingPreloadChange.key === key && pendingPreloadChange.storage === storage);
}

function shouldClearPendingPreload<TMeta>(
  pendingPreloadChange: PendingPreloadChange<TMeta> | null,
  key: string,
  storage: StorageAdapter | null,
): boolean {
  return Boolean(pendingPreloadChange && !pendingPreloadMatchesSource(pendingPreloadChange, key, storage));
}

function shouldApplyRead(writeVersionRef: MutableRef<number>, writeVersion: number, cancelled: boolean): boolean {
  return !cancelled && writeVersionRef.current === writeVersion;
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

export function planReadSourceChange<TMeta>(
  key: string,
  storage: StorageAdapter | null,
  writeVersion: number,
  initialAsyncRead: PendingRead | null,
  initialSyncRead: InitialSyncRead | null,
  pendingPreloadChange: PendingPreloadChange<TMeta> | null,
): ReadSourcePlan<TMeta> {
  const clearPendingPreload = shouldClearPendingPreload(pendingPreloadChange, key, storage);

  if (!key || !storage) {
    return {
      kind: 'disabled',
      clearPendingPreload,
      state: emptyState<TMeta>(key, storage, true),
    };
  }

  if (initialSyncRead?.key === key && initialSyncRead.storage === storage) {
    return { kind: 'use-initial-sync', clearPendingPreload };
  }

  if (initialAsyncRead?.key === key && initialAsyncRead.storage === storage) {
    return {
      kind: 'use-initial-async',
      clearPendingPreload,
      pendingRead: initialAsyncRead,
      loadingState: emptyState<TMeta>(key, storage, false),
    };
  }

  return {
    kind: 'read-storage',
    clearPendingPreload,
    key,
    storage,
    writeVersion,
  };
}

export function planReadSuccess<TMeta>(
  key: string,
  storage: StorageAdapter,
  raw: string | null,
  deserializeMessages: DeserializeMessages<TMeta>,
  pendingPreloadChange: PendingPreloadChange<TMeta> | null,
  currentWriteVersion: number,
): ReadSuccessPlan<TMeta> {
  const parsed = stateFromRaw<TMeta>(key, storage, raw, deserializeMessages);
  const preloadReplay = planPreloadChangeAfterRead(
    pendingPreloadChange,
    key,
    storage,
    raw,
    parsed.error,
    currentWriteVersion,
  );

  if (preloadReplay.kind === 'replay') {
    return {
      kind: 'replay-preload',
      state: preloadReplay.state,
      write: preloadReplay.write,
    };
  }

  return {
    kind: 'apply-state',
    clearPendingPreload: preloadReplay.kind === 'discard',
    state: parsed.state,
    error: parsed.error,
  };
}

export function planReadFailure<TMeta>(
  key: string,
  storage: StorageAdapter,
  readError: unknown,
  pendingPreloadChange: PendingPreloadChange<TMeta> | null,
): ReadFailurePlan<TMeta> {
  return {
    key,
    clearPendingPreload: pendingPreloadMatchesSource(pendingPreloadChange, key, storage),
    state: emptyState<TMeta>(key, storage, true),
    error: readError,
  };
}

function applyReadLoadingState<TMeta>(
  loadingState: PersistenceState<TMeta>,
  writeVersion: number,
  adapter: ReadLifecycleEffectAdapter<TMeta>,
) {
  adapter.setState(prev => {
    if (adapter.writeVersionRef.current !== writeVersion) return prev;
    adapter.stateRef.current = loadingState;
    return loadingState;
  });
}

function applyReadSourcePlan<TMeta>(
  plan: ReadSourcePlan<TMeta>,
  adapter: ReadLifecycleEffectAdapter<TMeta>,
) {
  if (plan.clearPendingPreload) adapter.pendingPreloadChangeRef.current = null;

  if (plan.kind === 'disabled') {
    adapter.stateRef.current = plan.state;
    adapter.setState(plan.state);
    return;
  }

  if (plan.kind === 'use-initial-sync') {
    adapter.initialSyncReadRef.current = null;
    return;
  }

  if (plan.kind === 'use-initial-async') {
    adapter.initialAsyncReadRef.current = null;
    applyReadLoadingState(plan.loadingState, plan.pendingRead.writeVersion, adapter);
  }
}

function applyReadSuccessPlan<TMeta>(
  plan: ReadSuccessPlan<TMeta>,
  adapter: ReadLifecycleEffectAdapter<TMeta>,
) {
  if (plan.kind === 'replay-preload') {
    adapter.pendingPreloadChangeRef.current = null;
    adapter.writeVersionRef.current = plan.write.version;
    adapter.stateRef.current = plan.state;
    adapter.setState(plan.state);
    adapter.setError(null);
    adapter.queueWrite(plan.write.messages, plan.write.version, plan.write.flushNow, plan.write.removeIfEmpty);
    return;
  }

  if (plan.clearPendingPreload) adapter.pendingPreloadChangeRef.current = null;
  adapter.stateRef.current = plan.state;
  adapter.setState(plan.state);
  if (plan.error) adapter.reportPersistenceError(plan.error, 'deserialize', plan.state.key);
  else adapter.setError(null);
}

function applyReadFailurePlan<TMeta>(
  plan: ReadFailurePlan<TMeta>,
  adapter: ReadLifecycleEffectAdapter<TMeta>,
) {
  if (plan.clearPendingPreload) adapter.pendingPreloadChangeRef.current = null;
  adapter.stateRef.current = plan.state;
  adapter.setState(plan.state);
  adapter.reportPersistenceError(plan.error, 'read', plan.key);
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
