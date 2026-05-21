import type { Message, StorageAdapter } from '../../types';
import type { ChorusPersistenceError, PersistenceWriteOptions } from './types';
import type { PersistenceState } from './messageCodec';

export interface PendingPreloadChange<TMeta = Record<string, unknown>> {
  key: string;
  storage: StorageAdapter;
  messages: Message<TMeta>[];
  options?: PersistenceWriteOptions;
}

export interface PreloadReplayWrite<TMeta = Record<string, unknown>> {
  messages: Message<TMeta>[];
  version: number;
  flushNow: boolean;
  removeIfEmpty: boolean;
}

export type PreloadReplayPlan<TMeta = Record<string, unknown>> =
  | { kind: 'none' }
  | { kind: 'discard' }
  | { kind: 'replay'; state: PersistenceState<TMeta>; write: PreloadReplayWrite<TMeta> };

export function planPreloadChangeAfterRead<TMeta>(
  pendingPreloadChange: PendingPreloadChange<TMeta> | null,
  key: string,
  storage: StorageAdapter,
  raw: string | null,
  parsedError: ChorusPersistenceError | null,
  currentWriteVersion: number,
): PreloadReplayPlan<TMeta> {
  if (!pendingPreloadChange || pendingPreloadChange.key !== key || pendingPreloadChange.storage !== storage) {
    return { kind: 'none' };
  }

  // Only a successful getItem() that returns exactly null means the key was absent
  // and can safely accept writes queued before loaded=true. Empty/corrupt strings
  // are stored values and must not be clobbered by a pre-load onChange.
  if (parsedError || raw !== null) return { kind: 'discard' };

  const nextVersion = currentWriteVersion + 1;
  return {
    kind: 'replay',
    state: {
      key,
      storage,
      value: pendingPreloadChange.messages,
      loaded: true,
      hasStoredValue: true,
    },
    write: {
      messages: pendingPreloadChange.messages,
      version: nextVersion,
      flushNow: Boolean(pendingPreloadChange.options?.flush),
      removeIfEmpty: Boolean(pendingPreloadChange.options?.removeIfEmpty),
    },
  };
}
