import React from 'react';
import type { StorageAdapter } from '../../types';
import { isPromiseLike } from '../../utils/async';
import { emptyState, mergePendingCreates, stateFromRaw, type ConversationsState, type PendingConversationCreate } from './indexCodec';
import type { InitialSyncRead, PendingIndexRead } from './storageSource';
import type { ConversationStorageError, ConversationStorageOperation, ConversationSummary } from './types';

type ReportConversationStorageError = (
  rawError: unknown,
  operation: ConversationStorageOperation,
  key: string,
  conversationId?: string,
) => void;

type CommitConversationIndex = (conversations: ConversationSummary[], activeId: string | null) => void;
type PersistConversationIndex = (conversations: ConversationSummary[], activeId: string | null) => void;

interface UseConversationIndexReadLifecycleOptions {
  storage: StorageAdapter | null;
  indexKey: string;
  initialActiveId?: string | null;
  defaultTitleRef: React.RefObject<string>;
  nowRef: React.RefObject<() => Date | string | number>;
  versionRef: React.RefObject<number>;
  initialAsyncReadRef: React.RefObject<PendingIndexRead | null>;
  initialSyncReadRef: React.RefObject<InitialSyncRead | null>;
  pendingCreatesRef: React.RefObject<PendingConversationCreate[]>;
  initialCleanIndexStateRef: React.RefObject<ConversationsState | null>;
  stateRef: React.RefObject<ConversationsState>;
  setState: React.Dispatch<React.SetStateAction<ConversationsState>>;
  setError: React.Dispatch<React.SetStateAction<ConversationStorageError | null>>;
  commit: CommitConversationIndex;
  persistIndex: PersistConversationIndex;
  reportError: ReportConversationStorageError;
}

export function useConversationIndexReadLifecycle({
  storage,
  indexKey,
  initialActiveId,
  defaultTitleRef,
  nowRef,
  versionRef,
  initialAsyncReadRef,
  initialSyncReadRef,
  pendingCreatesRef,
  initialCleanIndexStateRef,
  stateRef,
  setState,
  setError,
  commit,
  persistIndex,
  reportError,
}: UseConversationIndexReadLifecycleOptions) {
  React.useEffect(() => {
    let cancelled = false;
    pendingCreatesRef.current = pendingCreatesRef.current.filter(pendingCreate => (
      pendingCreate.storage === storage && pendingCreate.indexKey === indexKey
    ));

    const takePendingCreatesForSource = () => {
      const matching: PendingConversationCreate[] = [];
      const remaining: PendingConversationCreate[] = [];
      for (const pendingCreate of pendingCreatesRef.current) {
        if (pendingCreate.storage === storage && pendingCreate.indexKey === indexKey) matching.push(pendingCreate);
        else remaining.push(pendingCreate);
      }
      pendingCreatesRef.current = remaining;
      return matching;
    };

    const applyRead = (raw: string | null, version: number) => {
      if (!cancelled && versionRef.current === version) {
        const parsed = stateFromRaw(raw, initialActiveId, indexKey, defaultTitleRef.current, nowRef.current);
        const pendingCreates = takePendingCreatesForSource();

        if (!parsed.error && pendingCreates.length > 0) {
          const mergedState = mergePendingCreates(parsed.state, pendingCreates);
          setError(null);
          commit(mergedState.conversations, mergedState.activeId);
          return;
        }

        stateRef.current = parsed.state;
        setState(parsed.state);
        if (parsed.error) reportError(parsed.error, 'read', indexKey);
        else {
          setError(null);
          if (parsed.shouldPersist) persistIndex(parsed.state.conversations, parsed.state.activeId);
        }
      }
    };

    const applyReadError = (readError: unknown, version: number) => {
      if (!cancelled && versionRef.current === version) {
        takePendingCreatesForSource();
        const nextState = emptyState();
        stateRef.current = nextState;
        setState(nextState);
        reportError(readError, 'read', indexKey);
      }
    };

    if (!storage) {
      const nextState = emptyState();
      stateRef.current = nextState;
      setState(nextState);
      return () => { cancelled = true; };
    }

    const initialSyncRead = initialSyncReadRef.current;
    if (initialSyncRead?.storage === storage && initialSyncRead.indexKey === indexKey) {
      initialSyncReadRef.current = null;
      const cleanState = initialCleanIndexStateRef.current;
      initialCleanIndexStateRef.current = null;
      if (cleanState) persistIndex(cleanState.conversations, cleanState.activeId);
      return () => { cancelled = true; };
    }

    const pendingInitialRead = initialAsyncReadRef.current;
    if (pendingInitialRead?.storage === storage && pendingInitialRead.indexKey === indexKey) {
      initialAsyncReadRef.current = null;
      setState(prev => {
        if (versionRef.current !== pendingInitialRead.version) return prev;
        const nextState = { conversations: [], activeId: null, loaded: false };
        stateRef.current = nextState;
        return nextState;
      });
      pendingInitialRead.promise
        .then(raw => applyRead(raw, pendingInitialRead.version))
        .catch(readError => applyReadError(readError, pendingInitialRead.version));
      return () => { cancelled = true; };
    }

    const version = versionRef.current;
    try {
      const raw = storage.getItem(indexKey);
      if (isPromiseLike<string | null>(raw)) {
        const promise = Promise.resolve(raw);
        promise.catch(() => {});
        setState(prev => {
          if (versionRef.current !== version) return prev;
          const nextState = { conversations: [], activeId: null, loaded: false };
          stateRef.current = nextState;
          return nextState;
        });
        promise
          .then(str => applyRead(str, version))
          .catch(readError => applyReadError(readError, version));
      } else {
        applyRead(raw, version);
      }
    } catch (readError) {
      applyReadError(readError, version);
    }

    return () => { cancelled = true; };
  }, [
    commit,
    defaultTitleRef,
    indexKey,
    initialActiveId,
    initialAsyncReadRef,
    initialCleanIndexStateRef,
    initialSyncReadRef,
    nowRef,
    pendingCreatesRef,
    persistIndex,
    reportError,
    setError,
    setState,
    stateRef,
    storage,
    versionRef,
  ]);
}
