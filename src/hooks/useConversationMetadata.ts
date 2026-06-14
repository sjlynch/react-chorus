import React from 'react';
import type { StorageAdapter } from '../types';
import { useLatestRef } from './useLatestRef';

/**
 * Free-form, conversation-scoped state. Used by `<Chorus conversationMetadata>`
 * for roleplay/multi-agent shells that need to persist a small object
 * alongside the transcript (active character id, persona id, lorebook id,
 * author's note, etc.) without round-tripping it through every message.
 */
export type ConversationMetadata = Record<string, unknown>;

export interface UseConversationMetadataOptions {
  /** Storage adapter. When null/undefined the hook is a no-op (host-owned state only). */
  storage?: StorageAdapter | null;
  /** Called when a load, parse, or write fails. */
  onError?: (error: Error) => void;
}

export interface UseConversationMetadataResult {
  /** Loaded metadata, or `null` when the stored slot is empty / parse fails. */
  value: ConversationMetadata | null;
  /** Persist a new value, or `null` to clear the slot. Updates local state synchronously. */
  setValue: (next: ConversationMetadata | null) => void;
  /** True once the initial read settles. Sync storage = true immediately; Promise-based storage flips after the read resolves. */
  loaded: boolean;
  /** Most recent load/write error, or null. */
  error: Error | null;
  /** True when both key and storage are set — persistence is actively wired. */
  canPersist: boolean;
}

function isMetadataObject(v: unknown): v is ConversationMetadata {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function safeParse(raw: string | null | undefined): ConversationMetadata | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isMetadataObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toError(raw: unknown): Error {
  return raw instanceof Error ? raw : new Error(String(raw));
}

interface PersistenceState {
  value: ConversationMetadata | null;
  loaded: boolean;
  error: Error | null;
  /** Stamped each time we re-seed from props (key/storage change) so the async loader can drop stale resolves. */
  readVersion: number;
}

interface InitialReadArgs {
  key: string;
  storage: StorageAdapter | null;
  readVersion: number;
}

function initialState({ key, storage, readVersion }: InitialReadArgs): PersistenceState {
  if (!key || !storage) {
    return { value: null, loaded: true, error: null, readVersion };
  }
  try {
    const raw = storage.getItem(key);
    if (raw instanceof Promise) {
      // Async storage: defer the read to the mount effect. Attach a noop catch
      // so an immediately-rejecting Promise (e.g. a backend that errors before
      // the effect re-issues the read) does not surface as an unhandled
      // rejection — the effect re-issues the call and routes the error
      // through `onError` properly.
      raw.catch(() => undefined);
      return { value: null, loaded: false, error: null, readVersion };
    }
    return { value: safeParse(raw), loaded: true, error: null, readVersion };
  } catch (error) {
    return { value: null, loaded: true, error: toError(error), readVersion };
  }
}

/**
 * Loads a small object from `storage[key]` on mount and persists it back when
 * `setValue` is called. JSON-serialized, sync- and Promise-based storage
 * adapters both supported. Used by `<Chorus conversationMetadata>` to round
 * trip conversation-scoped state (active character / persona / lorebook id,
 * author's note) alongside the transcript. Standalone consumers can wire it
 * directly when they want the persistence pattern without `<Chorus>`.
 *
 * Setting `null` clears the stored slot via the optional `removeItem` adapter
 * method (falling back to a `setItem(key, 'null')` write when not present).
 */
export function useConversationMetadata(
  key: string,
  options?: UseConversationMetadataOptions,
): UseConversationMetadataResult {
  const storage = options?.storage ?? null;
  const onErrorRef = useLatestRef(options?.onError);
  const canPersist = Boolean(key && storage);

  const [state, setState] = React.useState<PersistenceState>(() => (
    initialState({ key, storage, readVersion: 0 })
  ));

  // Re-seed when the key or storage source changes.
  const sourceFingerprint = `${key}|${storage ? 'set' : 'unset'}`;
  const lastSourceRef = React.useRef<string>(sourceFingerprint);
  if (lastSourceRef.current !== sourceFingerprint) {
    lastSourceRef.current = sourceFingerprint;
    // setState during render with derived initial state — React tolerates this
    // when the next state is a pure function of props, and it avoids a flicker
    // where the previous conversation's metadata briefly leaks through.
    const nextReadVersion = state.readVersion + 1;
    const next = initialState({ key, storage, readVersion: nextReadVersion });
    setState(next);
  }

  const stateRef = useLatestRef(state);

  React.useEffect(() => {
    if (state.loaded || !canPersist || !storage) return undefined;
    const currentVersion = state.readVersion;
    let cancelled = false;
    Promise.resolve()
      .then(() => storage.getItem(key))
      .then((raw) => {
        if (cancelled) return;
        if (stateRef.current.readVersion !== currentVersion) return;
        setState({ value: safeParse(raw ?? null), loaded: true, error: null, readVersion: currentVersion });
      })
      .catch((error) => {
        if (cancelled) return;
        if (stateRef.current.readVersion !== currentVersion) return;
        const err = toError(error);
        setState({ value: null, loaded: true, error: err, readVersion: currentVersion });
        onErrorRef.current?.(err);
      });
    return () => { cancelled = true; };
  }, [canPersist, key, onErrorRef, state.loaded, state.readVersion, stateRef, storage]);

  const setValue = React.useCallback((next: ConversationMetadata | null) => {
    const currentVersion = stateRef.current.readVersion;
    setState((prev) => (
      prev.readVersion === currentVersion
        ? { value: next, loaded: true, error: prev.error, readVersion: prev.readVersion }
        : prev
    ));
    if (!canPersist || !storage) return;
    Promise.resolve()
      .then(() => {
        if (stateRef.current.readVersion !== currentVersion) return;
        if (next === null) {
          if (typeof storage.removeItem === 'function') {
            return storage.removeItem(key);
          }
          return storage.setItem(key, 'null');
        }
        return storage.setItem(key, JSON.stringify(next));
      })
      .catch((error) => {
        if (stateRef.current.readVersion !== currentVersion) return;
        const err = toError(error);
        setState((prev) => ({ ...prev, error: err }));
        onErrorRef.current?.(err);
      });
  }, [canPersist, key, onErrorRef, stateRef, storage]);

  return {
    value: state.value,
    setValue,
    loaded: state.loaded,
    error: state.error,
    canPersist,
  };
}
