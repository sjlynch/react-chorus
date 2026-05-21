import type { StorageAdapter } from '../../types';
import { emptyState, stateFromRaw, type PersistenceState } from './messageCodec';
import { planPreloadChangeAfterRead, type PendingPreloadChange, type PreloadReplayWrite } from './preloadReplay';
import type { ChorusPersistenceError, DeserializeMessages } from './types';

export interface MutableRef<T> {
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

export function shouldApplyRead(writeVersionRef: MutableRef<number>, writeVersion: number, cancelled: boolean): boolean {
  return !cancelled && writeVersionRef.current === writeVersion;
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
