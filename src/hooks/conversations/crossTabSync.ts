import React from 'react';
import type { StorageAdapter } from '../../types';
import { serializeConversationIndex, stateFromRaw, type ConversationsState } from './indexCodec';
import type { ConversationStorageError, ConversationStorageOperation } from './types';

type ReportConversationStorageError = (
  rawError: unknown,
  operation: ConversationStorageOperation,
  key: string,
  conversationId?: string,
) => void;

interface UseLocalStorageConversationIndexSyncOptions {
  storage: StorageAdapter | null;
  indexKey: string;
  defaultTitleRef: React.RefObject<string>;
  nowRef: React.RefObject<() => Date | string | number>;
  versionRef: React.RefObject<number>;
  stateRef: React.RefObject<ConversationsState>;
  setState: React.Dispatch<React.SetStateAction<ConversationsState>>;
  setError: React.Dispatch<React.SetStateAction<ConversationStorageError | null>>;
  reportError: ReportConversationStorageError;
}

export function useLocalStorageConversationIndexSync({
  storage,
  indexKey,
  defaultTitleRef,
  nowRef,
  versionRef,
  stateRef,
  setState,
  setError,
  reportError,
}: UseLocalStorageConversationIndexSyncOptions) {
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let localStorageRef: Storage | null;
    try {
      localStorageRef = window.localStorage;
    } catch {
      return undefined;
    }
    if (storage !== localStorageRef) return undefined;

    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorageRef) return;
      if (event.key !== indexKey) return;

      // Defensive against same-tab polyfills: skip if the event mirrors what
      // we already have in memory.
      try {
        const currentSerialized = serializeConversationIndex(stateRef.current.conversations, stateRef.current.activeId);
        if (event.newValue === currentSerialized) return;
      } catch {
        // fall through and apply the event
      }

      const parsed = stateFromRaw(event.newValue, stateRef.current.activeId, indexKey, defaultTitleRef.current, nowRef.current);
      if (parsed.error) {
        reportError(parsed.error, 'read', indexKey);
        return;
      }
      versionRef.current += 1;
      stateRef.current = parsed.state;
      setState(parsed.state);
      setError(null);
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [defaultTitleRef, indexKey, nowRef, reportError, setError, setState, stateRef, storage, versionRef]);
}
