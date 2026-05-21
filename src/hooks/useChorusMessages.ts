import React from 'react';
import type { Message } from '../types';
import { useLatestRef } from './useLatestRef';
import { isChorusDevMode } from '../utils/devMode';

export type ChorusMessagesChangeSource = 'controlled' | 'uncontrolled' | 'persistence';
export type ChorusMessagesChangeReason =
  | 'initial'
  | 'external'
  | 'persistence-load'
  | 'persistence-seed'
  | 'send'
  | 'assistant'
  | 'retry'
  | 'edit'
  | 'regenerate'
  | 'delete'
  | 'clear'
  | 'update';

export interface ChorusMessagesChangeContext {
  source: ChorusMessagesChangeSource;
  reason: ChorusMessagesChangeReason;
}

interface PersistedChangeOptions {
  flush?: boolean;
  removeIfEmpty?: boolean;
}

interface UpdateMessagesOptions {
  flushPersistence?: boolean;
  removePersistenceIfEmpty?: boolean;
  /**
   * Persistence-only update: write straight to the persistence store and skip
   * `onChange`/`setInternalMsgs` plus the `onMessagesChange` observer. The
   * `useRAFQueue` unmount flush uses this so a final buffered token still lands
   * in persistence without a host callback firing after teardown.
   */
  persistOnly?: boolean;
  reason?: ChorusMessagesChangeReason;
}

interface UseChorusMessagesOptions<TMeta = Record<string, unknown>> {
  value?: Message<TMeta>[];
  messages?: Message<TMeta>[];
  initialMessages?: Message<TMeta>[];
  onChange?: (messages: Message<TMeta>[]) => void;
  onMessagesChange?: (messages: Message<TMeta>[], context: ChorusMessagesChangeContext) => void;
  persistenceKey?: string;
  persistedMessages: Message<TMeta>[];
  persistenceLoaded?: boolean;
  hasPersistedValue?: boolean;
  canPersist?: boolean;
  onPersistedChange: (messages: Message<TMeta>[], options?: PersistedChangeOptions) => void;
  onChunk?: (chunk: string, messageId: string) => void;
}

function warnDuplicateMessageIds<TMeta>(next: Message<TMeta>[]) {
  if (!isChorusDevMode()) return;
  const seen = new Set<string>();
  let duplicates: string[] | null = null;
  for (const m of next) {
    if (seen.has(m.id)) {
      if (duplicates === null) duplicates = [];
      duplicates.push(m.id);
    } else {
      seen.add(m.id);
    }
  }
  if (duplicates !== null) {
    console.warn('[Chorus] Duplicate message IDs detected:', duplicates);
  }
}

function warnObserverError(error: unknown) {
  if (!isChorusDevMode()) return;
  console.warn('[Chorus] `onMessagesChange` callback threw and was ignored so it could not interrupt message rendering.', error);
}

/**
 * Shallow value-equality for message arrays: same length and identical element
 * references. A controlled host whose `onChange` clones/spreads the array Chorus
 * just emitted feeds back a NEW array that still holds the same message objects,
 * so this returns true for that round-trip echo while a genuine external change
 * (different messages) returns false.
 */
function messagesArraysEqual<TMeta>(a: Message<TMeta>[] | null, b: Message<TMeta>[]): boolean {
  if (a === b) return true;
  if (a === null || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function useChorusMessages<TMeta = Record<string, unknown>>({
  value,
  messages,
  initialMessages,
  onChange,
  onMessagesChange,
  persistenceKey,
  persistedMessages,
  persistenceLoaded = true,
  hasPersistedValue,
  canPersist = true,
  onPersistedChange,
  onChunk,
}: UseChorusMessagesOptions<TMeta>) {
  const [seedMessages] = React.useState<Message<TMeta>[]>(() => messages ?? initialMessages ?? []);
  const [internalMsgs, setInternalMsgs] = React.useState<Message<TMeta>[]>(() => seedMessages);
  const persistedStoreHasValue = hasPersistedValue ?? persistedMessages.length > 0;
  const shouldUsePersistenceSeed = Boolean(
    persistenceKey
      && persistenceLoaded
      && !persistedStoreHasValue
      && persistedMessages.length === 0
      && seedMessages.length > 0,
  );
  const persistenceMsgs = shouldUsePersistenceSeed ? seedMessages : persistedMessages;
  const msgs = value !== undefined ? value : persistenceKey ? persistenceMsgs : internalMsgs;
  const source: ChorusMessagesChangeSource = value !== undefined ? 'controlled' : persistenceKey ? 'persistence' : 'uncontrolled';

  const msgsRef = useLatestRef(msgs);
  const sourceRef = useLatestRef(source);
  const onChangeRef = useLatestRef(onChange);
  const onChunkRef = useLatestRef(onChunk);
  const onMessagesChangeRef = useLatestRef(onMessagesChange);
  const onPersistedChangeRef = useLatestRef(onPersistedChange);
  const lastEmittedMessagesRef = React.useRef<Message<TMeta>[] | null>(null);
  const lastEmittedCallbackRef = React.useRef<typeof onMessagesChange | null>(null);

  const emitMessagesChange = React.useCallback((next: Message<TMeta>[], reason: ChorusMessagesChangeReason) => {
    const callback = onMessagesChangeRef.current;
    if (!callback) return;
    if (lastEmittedCallbackRef.current === callback) {
      if (lastEmittedMessagesRef.current === next) return;
      // Controlled round-trip: a host whose `onChange` clones/spreads the array
      // Chorus just emitted feeds back a value-equal copy, so the 'external'
      // effect re-fires with msgs !== next. Suppress that echo instead of
      // reporting the same logical change a second time (mislabeled 'external').
      if (reason === 'external' && messagesArraysEqual(lastEmittedMessagesRef.current, next)) return;
    }

    lastEmittedMessagesRef.current = next;
    lastEmittedCallbackRef.current = callback;

    try {
      callback(next, { source: sourceRef.current, reason });
    } catch (error) {
      warnObserverError(error);
    }
  }, [onMessagesChangeRef, sourceRef]);

  const observedReason: ChorusMessagesChangeReason = persistenceKey
    ? shouldUsePersistenceSeed
      ? 'persistence-seed'
      : persistenceLoaded
        ? 'persistence-load'
        : 'initial'
    : value !== undefined
      ? 'external'
      : 'initial';

  React.useEffect(() => {
    emitMessagesChange(msgs, observedReason);
  }, [emitMessagesChange, msgs, observedReason, onMessagesChange]);

  React.useEffect(() => {
    if (
      value !== undefined
      || !persistenceKey
      || !canPersist
      || !persistenceLoaded
      || persistedStoreHasValue
      || seedMessages.length === 0
    ) return;

    onPersistedChangeRef.current(seedMessages);
  }, [canPersist, persistedStoreHasValue, persistenceKey, persistenceLoaded, seedMessages, value, onPersistedChangeRef]);

  const updateMsgs = React.useCallback((updater: (prev: Message<TMeta>[]) => Message<TMeta>[], options?: UpdateMessagesOptions) => {
    const next = updater(msgsRef.current);
    warnDuplicateMessageIds(next);
    msgsRef.current = next;

    if (options?.persistOnly) {
      // Unmount flush: a buffered token was completed as the component tore
      // down. Persist it (when this conversation is persistence-backed) but
      // never call the controlled host's `onChange`, the uncontrolled
      // `setInternalMsgs`, or the `onMessagesChange` observer — the host and
      // its router are already gone. Controlled/uncontrolled conversations
      // have nowhere to persist, so they simply drop the trailing token rather
      // than surface a post-teardown callback.
      if (value === undefined && persistenceKey) onPersistedChangeRef.current(next, { flush: true });
      return next;
    }

    if (value !== undefined) onChangeRef.current?.(next);
    else if (persistenceKey) onPersistedChangeRef.current(next, { flush: options?.flushPersistence, removeIfEmpty: options?.removePersistenceIfEmpty });
    else setInternalMsgs(next);

    emitMessagesChange(next, options?.reason ?? 'update');

    return next;
  }, [emitMessagesChange, msgsRef, onChangeRef, onPersistedChangeRef, persistenceKey, value]);

  return { msgs, messagesRef: msgsRef, updateMsgs, onChangeRef, onChunkRef, seedMessages };
}
