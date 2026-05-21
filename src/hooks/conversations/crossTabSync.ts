import React from 'react';
import type { StorageAdapter } from '../../types';
import { serializeConversationIndex, stateFromRaw, type ConversationsState } from './indexCodec';
import type { IndexWriteCoordination } from './indexWriteQueue';
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
  writeCoordination: IndexWriteCoordination;
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
  writeCoordination,
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

    let cancelled = false;

    // Apply an external value to local state. stateRef.current is re-read here
    // (rather than captured) so an event that was queued behind a local write
    // is rebased against the freshest in-memory snapshot before it lands.
    const applyExternalValue = (newValue: string | null) => {
      // Defensive against same-tab polyfills: skip if the event mirrors what
      // we already have in memory.
      try {
        const currentSerialized = serializeConversationIndex(stateRef.current.conversations, stateRef.current.activeId);
        if (newValue === currentSerialized) return;
      } catch {
        // fall through and apply the event
      }

      const parsed = stateFromRaw(newValue, stateRef.current.activeId, indexKey, defaultTitleRef.current, nowRef.current);
      if (parsed.error) {
        reportError(parsed.error, 'read', indexKey);
        return;
      }
      versionRef.current += 1;
      stateRef.current = parsed.state;
      setState(parsed.state);
      setError(null);
    };

    // An external value must not be applied while a local index write is still
    // in flight — doing so would clobber the pending write's value (lost
    // update): the in-flight write would later persist its stale snapshot over
    // the other tab's conversation. Queue the event behind the current write
    // chain, then re-check on settle in case another local write started while
    // this one was waiting.
    const processExternalValue = (newValue: string | null) => {
      if (cancelled) return;
      if (writeCoordination.isWritePending()) {
        const reprocess = () => processExternalValue(newValue);
        writeCoordination.whenWriteSettles().then(reprocess, reprocess);
        return;
      }
      applyExternalValue(newValue);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorageRef) return;
      if (event.key !== indexKey) return;
      processExternalValue(event.newValue);
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', handleStorage);
    };
  }, [defaultTitleRef, indexKey, nowRef, reportError, setError, setState, stateRef, storage, versionRef, writeCoordination]);
}
