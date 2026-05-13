import React from 'react';
import type { Message } from '../types';
import { useLatestRef } from './useLatestRef';
import { isChorusDevMode } from '../utils/devMode';

interface PersistedChangeOptions {
  flush?: boolean;
}

interface UpdateMessagesOptions {
  flushPersistence?: boolean;
}

interface UseChorusMessagesOptions<TMeta = Record<string, unknown>> {
  value?: Message<TMeta>[];
  messages?: Message<TMeta>[];
  initialMessages?: Message<TMeta>[];
  onChange?: (messages: Message<TMeta>[]) => void;
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

export function useChorusMessages<TMeta = Record<string, unknown>>({
  value,
  messages,
  initialMessages,
  onChange,
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
      && !persistedStoreHasValue
      && persistedMessages.length === 0
      && seedMessages.length > 0,
  );
  const persistenceMsgs = shouldUsePersistenceSeed ? seedMessages : persistedMessages;
  const msgs = value !== undefined ? value : persistenceKey ? persistenceMsgs : internalMsgs;

  const msgsRef = useLatestRef(msgs);
  const onChangeRef = useLatestRef(onChange);
  const onChunkRef = useLatestRef(onChunk);
  const onPersistedChangeRef = useLatestRef(onPersistedChange);

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
    else if (persistenceKey) onPersistedChangeRef.current(next, { flush: options?.flushPersistence });
    else setInternalMsgs(next);

    return next;
  }, [msgsRef, onChangeRef, onPersistedChangeRef, persistenceKey, value]);

  return { msgs, updateMsgs, onChangeRef, onChunkRef, seedMessages };
}
