import React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { StorageAdapter } from '../../types';
import type { ChorusPersistenceError, DeserializeMessages, PersistenceOperation, SerializeMessages } from './types';
import { stateFromRaw, type PersistenceState } from './messageCodec';
import type { WriteCoordination } from './writeQueue';

interface MutableRef<T> {
  current: T;
}

export function useLocalStorageSync<TMeta = Record<string, unknown>>(
  key: string,
  storage: StorageAdapter | null,
  stateRef: MutableRef<PersistenceState<TMeta>>,
  setState: Dispatch<SetStateAction<PersistenceState<TMeta>>>,
  setError: Dispatch<SetStateAction<ChorusPersistenceError | null>>,
  writeVersionRef: MutableRef<number>,
  serializeMessagesRef: MutableRef<SerializeMessages<TMeta>>,
  deserializeMessagesRef: MutableRef<DeserializeMessages<TMeta>>,
  reportPersistenceError: (rawError: unknown, operation: PersistenceOperation, errorKey?: string) => void,
  writeCoordination: WriteCoordination,
) {
  // Cross-tab sync: pick up message writes from other tabs sharing the same
  // localStorage. Skipped for custom StorageAdapter values — async/remote
  // adapters are responsible for their own change notification.
  React.useEffect(() => {
    if (typeof window === 'undefined' || !key) return undefined;
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
      if (newValue !== null) {
        try {
          const currentSerialized = serializeMessagesRef.current(stateRef.current.value);
          if (newValue === currentSerialized) return;
        } catch {
          // fall through and apply the event
        }
      } else if (stateRef.current.value.length === 0 && !stateRef.current.hasStoredValue) {
        return;
      }

      const parsed = stateFromRaw<TMeta>(key, storage, newValue, deserializeMessagesRef.current);
      if (parsed.error) {
        reportPersistenceError(parsed.error, 'deserialize', key);
        return;
      }
      writeVersionRef.current += 1;
      stateRef.current = parsed.state;
      setState(parsed.state);
      setError(null);
    };

    // An external value must not be applied while a local write is still in
    // flight — doing so would clobber the pending write's value (lost update).
    // Queue the event behind the current write chain, then re-check on settle
    // in case another local write started while this one was waiting.
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
      if (event.key !== key) return;
      processExternalValue(event.newValue);
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', handleStorage);
    };
  }, [
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
  ]);
}
