import React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { StorageAdapter } from '../../types';
import type { ChorusPersistenceError, DeserializeMessages, PersistenceOperation, SerializeMessages } from './types';
import { stateFromRaw, type PersistenceState } from './messageCodec';

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

    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorageRef) return;
      if (event.key !== key) return;

      // Defensive against same-tab polyfills: skip if the event mirrors what
      // we already have in memory.
      if (event.newValue !== null) {
        try {
          const currentSerialized = serializeMessagesRef.current(stateRef.current.value);
          if (event.newValue === currentSerialized) return;
        } catch {
          // fall through and apply the event
        }
      } else if (stateRef.current.value.length === 0 && !stateRef.current.hasStoredValue) {
        return;
      }

      const parsed = stateFromRaw<TMeta>(key, storage, event.newValue, deserializeMessagesRef.current);
      if (parsed.error) {
        reportPersistenceError(parsed.error, 'deserialize', key);
        return;
      }
      writeVersionRef.current += 1;
      stateRef.current = parsed.state;
      setState(parsed.state);
      setError(null);
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
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
  ]);
}
