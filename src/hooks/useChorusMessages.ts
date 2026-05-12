import React from 'react';
import type { Message } from '../types';
import { useLatestRef } from './useLatestRef';

interface UseChorusMessagesOptions {
  value?: Message[];
  messages?: Message[];
  initialMessages?: Message[];
  onChange?: (messages: Message[]) => void;
  persistenceKey?: string;
  persistedMessages: Message[];
  persistenceLoaded?: boolean;
  hasPersistedValue?: boolean;
  canPersist?: boolean;
  onPersistedChange: (messages: Message[]) => void;
  onChunk?: (chunk: string, messageId: string) => void;
}

function warnDuplicateMessageIds(next: Message[]) {
  if (process.env.NODE_ENV !== 'production') {
    const ids = next.map(m => m.id);
    const uniq = new Set(ids);
    if (uniq.size !== ids.length) {
      console.warn('[Chorus] Duplicate message IDs detected:', ids.filter((id, i) => ids.indexOf(id) !== i));
    }
  }
}

export function useChorusMessages({
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
}: UseChorusMessagesOptions) {
  const [seedMessages] = React.useState<Message[]>(() => messages ?? initialMessages ?? []);
  const [internalMsgs, setInternalMsgs] = React.useState<Message[]>(() => seedMessages);
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

  const updateMsgs = React.useCallback((updater: (prev: Message[]) => Message[]) => {
    const next = updater(msgsRef.current);
    warnDuplicateMessageIds(next);
    msgsRef.current = next;

    if (value !== undefined) onChangeRef.current?.(next);
    else if (persistenceKey) onPersistedChangeRef.current(next);
    else setInternalMsgs(next);

    return next;
  }, [msgsRef, onChangeRef, onPersistedChangeRef, persistenceKey, value]);

  return { msgs, updateMsgs, onChangeRef, onChunkRef };
}
