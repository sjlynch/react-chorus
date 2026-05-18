import type { Dispatch, SetStateAction } from 'react';
import type { Message, StorageAdapter } from '../../types';
import type { ChorusPersistenceError, PersistenceWriteOptions } from './types';
import type { PersistenceState } from './messageCodec';

interface MutableRef<T> {
  current: T;
}

export interface PendingPreloadChange<TMeta = Record<string, unknown>> {
  key: string;
  storage: StorageAdapter;
  messages: Message<TMeta>[];
  options?: PersistenceWriteOptions;
}

export function replayPreloadChangeAfterEmptyRead<TMeta>(
  pendingPreloadChangeRef: MutableRef<PendingPreloadChange<TMeta> | null>,
  key: string,
  storage: StorageAdapter,
  raw: string | null,
  parsedError: ChorusPersistenceError | null,
  writeVersionRef: MutableRef<number>,
  stateRef: MutableRef<PersistenceState<TMeta>>,
  setState: Dispatch<SetStateAction<PersistenceState<TMeta>>>,
  setError: Dispatch<SetStateAction<ChorusPersistenceError | null>>,
  queueWrite: (messages: Message<TMeta>[], version: number, flushNow: boolean, removeIfEmpty: boolean) => void,
): boolean {
  const pendingPreloadChange = pendingPreloadChangeRef.current;
  if (pendingPreloadChange?.key !== key || pendingPreloadChange.storage !== storage) return false;

  pendingPreloadChangeRef.current = null;

  // Only a successful getItem() that returns exactly null means the key was absent
  // and can safely accept writes queued before loaded=true. Empty/corrupt strings
  // are stored values and must not be clobbered by a pre-load onChange.
  if (parsedError || raw !== null) return false;

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
  return true;
}
