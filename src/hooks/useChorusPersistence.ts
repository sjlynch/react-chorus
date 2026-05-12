import React from 'react';
import type { Message, StorageAdapter } from '../types';

const defaultStorage: StorageAdapter | null =
  typeof window !== 'undefined' ? window.localStorage : null;

function parseStoredMessages<TMeta = Record<string, unknown>>(raw: string | null): Message<TMeta>[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Message<TMeta>[];
  } catch {
    return [];
  }
}

/**
 * Persists Chorus messages to a storage adapter (defaults to localStorage).
 * Returns { value, onChange } which can be spread directly onto <Chorus>.
 *
 * The storage adapter interface is pluggable — pass any object with
 * getItem/setItem to use sessionStorage, IndexedDB, a remote API, etc.
 *
 * @example — localStorage (default)
 * const persist = useChorusPersistence('my-chat');
 * return <Chorus {...persist} onSend={...} />;
 *
 * @example — sessionStorage
 * const persist = useChorusPersistence('my-chat', { storage: sessionStorage });
 *
 * @example — async adapter (IndexedDB wrapper, custom backend, etc.)
 * const persist = useChorusPersistence('my-chat', { storage: myAsyncAdapter });
 */
export function useChorusPersistence<TMeta = Record<string, unknown>>(
  key: string,
  options?: { storage?: StorageAdapter },
): { value: Message<TMeta>[]; onChange: (messages: Message<TMeta>[]) => void } {
  const storage = options?.storage ?? defaultStorage;

  // Stable refs so the onChange callback never needs to change
  const storageRef = React.useRef(storage);
  storageRef.current = storage;
  const keyRef = React.useRef(key);
  keyRef.current = key;

  const [value, setValue] = React.useState<Message<TMeta>[]>(() => {
    if (!key || !storage) return [];
    try {
      const raw = storage.getItem(key);
      // Synchronous adapter (localStorage / sessionStorage): init without a render
      if (raw instanceof Promise) {
        raw.catch(() => {});
        return [];
      }
      return parseStoredMessages<TMeta>(raw);
    } catch {}
    return [];
  });

  React.useEffect(() => {
    let cancelled = false;

    if (!key || !storage) {
      setValue([]);
      return () => { cancelled = true; };
    }

    // Reset before loading the new key so stale messages are not shown while
    // async adapters (IndexedDB etc.) resolve.
    setValue([]);

    try {
      const raw = storage.getItem(key);
      if (raw instanceof Promise) {
        raw
          .then(str => {
            if (!cancelled) setValue(parseStoredMessages<TMeta>(str));
          })
          .catch(() => {
            if (!cancelled) setValue([]);
          });
      } else {
        setValue(parseStoredMessages<TMeta>(raw));
      }
    } catch {
      setValue([]);
    }

    return () => { cancelled = true; };
  }, [key, storage]);

  const onChange = React.useCallback((messages: Message<TMeta>[]) => {
    setValue(messages);
    const k = keyRef.current;
    const s = storageRef.current;
    if (!k || !s) return;
    try {
      const result = s.setItem(k, JSON.stringify(messages));
      if (result instanceof Promise) result.catch(() => {});
    } catch {}
  }, []); // stable — reads key/storage from refs

  return { value, onChange };
}
