import React from 'react';
import type { Message } from '../types';
import { useLatestRef } from './useLatestRef';

interface UseChorusMessagesOptions<TMeta = Record<string, unknown>> {
  value?: Message<TMeta>[];
  messages?: Message<TMeta>[];
  initialMessages?: Message<TMeta>[];
  onChange?: (messages: Message<TMeta>[]) => void;
  persistenceKey?: string;
  persistedMessages: Message<TMeta>[];
  onPersistedChange: (messages: Message<TMeta>[]) => void;
  onChunk?: (chunk: string, messageId: string) => void;
}

function warnDuplicateMessageIds<TMeta>(next: Message<TMeta>[]) {
  if (process.env.NODE_ENV !== 'production') {
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
  onPersistedChange,
  onChunk,
}: UseChorusMessagesOptions<TMeta>) {
  const [internalMsgs, setInternalMsgs] = React.useState<Message<TMeta>[]>(() => messages ?? initialMessages ?? []);
  const msgs = value !== undefined ? value : persistenceKey ? persistedMessages : internalMsgs;

  const msgsRef = useLatestRef(msgs);
  const onChangeRef = useLatestRef(onChange);
  const onChunkRef = useLatestRef(onChunk);
  const onPersistedChangeRef = useLatestRef(onPersistedChange);

  const updateMsgs = React.useCallback((updater: (prev: Message<TMeta>[]) => Message<TMeta>[]) => {
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
