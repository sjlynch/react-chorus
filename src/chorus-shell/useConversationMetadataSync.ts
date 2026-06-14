import React from 'react';
import type { StorageAdapter } from '../types';
import { useConversationMetadata, type ConversationMetadata } from '../hooks/useConversationMetadata';
import { useLatestRef } from '../hooks/useLatestRef';

interface UseConversationMetadataSyncArgs {
  /** Active conversation key. Empty string disables persistence. */
  persistenceKey: string;
  /** Optional storage adapter. When omitted with a key set, this is a no-op too. */
  persistenceStorage: StorageAdapter | null | undefined;
  /**
   * Host-supplied controlled value:
   * - `Record<string, unknown>` — persist this value.
   * - `null` — clear the persisted slot (uses `removeItem` when supported).
   * - `undefined` — uncontrolled; do not persist anything from this side.
   */
  conversationMetadata: ConversationMetadata | null | undefined;
  /**
   * Called once per persistenceKey when a stored value is loaded and differs
   * from the current prop. Hosts use this to lift the loaded metadata into
   * their controlled state so the prop matches storage on subsequent renders.
   * Only fired with non-null payloads (an empty/missing slot does not emit).
   */
  onConversationMetadataChange: ((next: ConversationMetadata) => void) | undefined;
  /** Forwarded to the underlying persistence hook. */
  onPersistenceError?: (error: Error) => void;
}

const META_KEY_SUFFIX = '::meta';

function stableStringify(value: ConversationMetadata | null | undefined): string {
  if (value === undefined) return '__undefined__';
  if (value === null) return '__null__';
  try {
    return JSON.stringify(value);
  } catch {
    return '__unstringifiable__';
  }
}

/**
 * Bridges the `<Chorus conversationMetadata>` prop to the underlying
 * `useConversationMetadata` hook persisted at `${persistenceKey}::meta`.
 *
 * Lifecycle:
 * 1. On mount (and on persistenceKey change), the hook reads storage.
 * 2. Once loaded, if a stored value exists and differs from the controlled
 *    prop, fire `onConversationMetadataChange(stored)` exactly once so the
 *    host can lift it into state.
 * 3. After the load-emit handshake, any subsequent prop change is forwarded
 *    to `setValue` (which writes through to storage). The JSON guard prevents
 *    the host's onChange echo from re-persisting the same content.
 *
 * Hosts that supply `conversationMetadata` but no `onConversationMetadataChange`
 * fall straight through to the persist path — the wired value is treated as
 * authoritative and overwrites whatever was in storage.
 */
export function useConversationMetadataSync({
  persistenceKey,
  persistenceStorage,
  conversationMetadata,
  onConversationMetadataChange,
  onPersistenceError,
}: UseConversationMetadataSyncArgs): void {
  const metaKey = persistenceKey ? `${persistenceKey}${META_KEY_SUFFIX}` : '';
  const storage = persistenceKey ? persistenceStorage ?? null : null;
  const metadata = useConversationMetadata(metaKey, {
    storage,
    onError: onPersistenceError,
  });

  const onConversationMetadataChangeRef = useLatestRef(onConversationMetadataChange);
  const hasLoadEmittedRef = React.useRef(false);
  const lastPersistedJsonRef = React.useRef<string>('__undefined__');

  // Reset the emit/persist gates whenever the conversation key changes so a
  // tab switch (useConversations) re-runs the load → emit → persist handshake
  // against the new slot.
  React.useEffect(() => {
    hasLoadEmittedRef.current = false;
    lastPersistedJsonRef.current = '__undefined__';
  }, [metaKey]);

  // Emit-on-load: fire onChange exactly once per key with the freshly-loaded
  // value when it differs from the controlled prop. Skip when no callback
  // exists — the prop wins as the authoritative value in that case.
  React.useEffect(() => {
    if (!metadata.loaded) return;
    if (hasLoadEmittedRef.current) return;
    hasLoadEmittedRef.current = true;
    if (metadata.value === null) return;
    const loadedJson = stableStringify(metadata.value);
    const propJson = stableStringify(conversationMetadata);
    lastPersistedJsonRef.current = loadedJson;
    if (loadedJson === propJson) return;
    onConversationMetadataChangeRef.current?.(metadata.value);
  }, [metadata.loaded, metadata.value, conversationMetadata, onConversationMetadataChangeRef]);

  // Persist-on-prop-change: write the host's prop through to storage once the
  // load-emit handshake settled. The JSON guard suppresses the round-trip
  // when the host echoes back the value Chorus just emitted.
  React.useEffect(() => {
    if (!metadata.loaded) return;
    if (!hasLoadEmittedRef.current) return;
    if (conversationMetadata === undefined) return;
    const json = stableStringify(conversationMetadata);
    if (json === lastPersistedJsonRef.current) return;
    lastPersistedJsonRef.current = json;
    metadata.setValue(conversationMetadata);
  }, [conversationMetadata, metadata]);
}
