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
  if (isChorusDevMode()) {
    const ids = next.map(m => m.id);
    const uniq = new Set(ids);
    if (uniq.size !== ids.length) {
      console.warn('[Chorus] Duplicate message IDs detected:', ids.filter((id, i) => ids.indexOf(id) !== i));
    }
  }
}

function warnObserverError(error: unknown) {
  if (!isChorusDevMode()) return;
  console.warn('[Chorus] `onMessagesChange` callback threw and was ignored so it could not interrupt message rendering.', error);
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
    if (lastEmittedMessagesRef.current === next && lastEmittedCallbackRef.current === callback) return;

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

    if (value !== undefined) onChangeRef.current?.(next);
    else if (persistenceKey) onPersistedChangeRef.current(next, { flush: options?.flushPersistence, removeIfEmpty: options?.removePersistenceIfEmpty });
    else setInternalMsgs(next);

    emitMessagesChange(next, options?.reason ?? 'update');

    return next;
  }, [emitMessagesChange, msgsRef, onChangeRef, onPersistedChangeRef, persistenceKey, value]);

  return { msgs, messagesRef: msgsRef, updateMsgs, onChangeRef, onChunkRef, seedMessages };
}
