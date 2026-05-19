import React from 'react';
import type { Attachment, Message } from '../../types';
import { isPromiseLike } from '../../utils/async';
import { cloneHistoryForRetry, createMessageId, dropTrailingAssistant } from './messageUtils';
import { warnObserverError } from './observer';
import type {
  ChorusAbortReason,
  ChorusAbortSource,
  ChorusClearConversationContext,
  ChorusConfirmClearConversation,
  ChorusConfirmDeleteMessage,
  ChorusOnSend,
  SubmittedUserTurn,
  UpdateSessionMessages,
} from './types';

export interface SessionCommandsDeps<TMeta> {
  messagesRef: React.MutableRefObject<Message<TMeta>[]>;
  transportRef: React.MutableRefObject<unknown>;
  onSendRef: React.MutableRefObject<ChorusOnSend<TMeta> | undefined>;
  lastSubmittedTurnRef: React.MutableRefObject<SubmittedUserTurn<TMeta> | null>;
  pendingDeleteIdsRef: React.MutableRefObject<Set<string>>;
  clearConfirmationActiveRef: React.MutableRefObject<boolean>;
  confirmDeleteMessageRef: React.MutableRefObject<ChorusConfirmDeleteMessage<TMeta> | undefined>;
  confirmClearConversationRef: React.MutableRefObject<ChorusConfirmClearConversation<TMeta> | undefined>;
  persistenceKeyRef: React.MutableRefObject<string | undefined>;
  resetToInitialMessagesRef: React.MutableRefObject<boolean>;
  seedMessagesRef: React.MutableRefObject<Message<TMeta>[]>;
  onClearRef: React.MutableRefObject<((messages: Message<TMeta>[]) => void) | undefined>;
  streamError: string | null;
  isBusy: () => boolean;
  abortActiveAssistant: (reason: ChorusAbortReason, source: ChorusAbortSource) => void;
  clearStreamError: () => void;
  triggerAssistant: (text: string, history: Message<TMeta>[]) => void;
  updateSessionMessages: UpdateSessionMessages<TMeta>;
  warnMissingResponseHandler: () => void;
  setClearConfirmationPending: React.Dispatch<React.SetStateAction<boolean>>;
}

export interface SessionCommands {
  send: (text: string, attachments?: Attachment[]) => boolean;
  retry: () => void;
  stop: (source?: ChorusAbortSource) => void;
  clear: (source?: ChorusAbortSource) => void;
  handleEdit: (id: string, newText: string) => void;
  handleRegenerate: (id: string) => void;
  handleDelete: (id: string) => void;
}

export function useSessionCommands<TMeta>(deps: SessionCommandsDeps<TMeta>): SessionCommands {
  const {
    messagesRef,
    transportRef,
    onSendRef,
    lastSubmittedTurnRef,
    pendingDeleteIdsRef,
    clearConfirmationActiveRef,
    confirmDeleteMessageRef,
    confirmClearConversationRef,
    persistenceKeyRef,
    resetToInitialMessagesRef,
    seedMessagesRef,
    onClearRef,
    streamError,
    isBusy,
    abortActiveAssistant,
    clearStreamError,
    triggerAssistant,
    updateSessionMessages,
    warnMissingResponseHandler,
    setClearConfirmationPending,
  } = deps;

  const send = React.useCallback((rawText: string, attachments: Attachment[] = []) => {
    if (isBusy()) return false;
    const text = rawText.trim();
    if (!text && !attachments.length) return false;
    if (!transportRef.current && !onSendRef.current) {
      warnMissingResponseHandler();
      return false;
    }

    const next = updateSessionMessages(prev => prev.concat({
      id: createMessageId(),
      role: 'user',
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
    }), { reason: 'send' });
    triggerAssistant(text, next);
    return true;
  }, [isBusy, onSendRef, transportRef, triggerAssistant, updateSessionMessages, warnMissingResponseHandler]);

  const retry = React.useCallback(() => {
    const submitted = lastSubmittedTurnRef.current;
    if (!submitted || isBusy()) return;
    const retryHistory = cloneHistoryForRetry(submitted.history);
    if (streamError) {
      updateSessionMessages(() => retryHistory, { flushPersistence: true, reason: 'retry' });
    }
    triggerAssistant(submitted.text, retryHistory);
  }, [isBusy, lastSubmittedTurnRef, streamError, triggerAssistant, updateSessionMessages]);

  const stop = React.useCallback((source: ChorusAbortSource = 'programmatic') => {
    if (!isBusy()) return;
    abortActiveAssistant('stop', source);
  }, [abortActiveAssistant, isBusy]);

  const commitClear = React.useCallback((source: ChorusAbortSource) => {
    if (isBusy()) abortActiveAssistant('clear', source);
    clearStreamError();
    lastSubmittedTurnRef.current = null;
    const reset = resetToInitialMessagesRef.current;
    const next = reset ? seedMessagesRef.current : [];
    updateSessionMessages(() => next, {
      flushPersistence: true,
      removePersistenceIfEmpty: !reset && seedMessagesRef.current.length === 0,
      reason: 'clear',
    });
    onClearRef.current?.(next);
  }, [abortActiveAssistant, clearStreamError, isBusy, lastSubmittedTurnRef, onClearRef, resetToInitialMessagesRef, seedMessagesRef, updateSessionMessages]);

  const clear = React.useCallback((source: ChorusAbortSource = 'programmatic') => {
    if (clearConfirmationActiveRef.current) return;

    const confirm = confirmClearConversationRef.current;
    if (!confirm) {
      commitClear(source);
      return;
    }

    const persistenceKeyForContext = persistenceKeyRef.current;
    const context: ChorusClearConversationContext<TMeta> = {
      messages: messagesRef.current.slice(),
      resetToInitialMessages: resetToInitialMessagesRef.current,
      source,
      ...(persistenceKeyForContext ? { persistenceKey: persistenceKeyForContext } : {}),
    };

    let confirmation: boolean | void | Promise<boolean | void>;
    try {
      confirmation = confirm(context);
    } catch (error) {
      warnObserverError('confirmClearConversation', error);
      return;
    }

    if (isPromiseLike<boolean | void>(confirmation)) {
      clearConfirmationActiveRef.current = true;
      setClearConfirmationPending(true);
      Promise.resolve(confirmation)
        .then(confirmed => {
          if (confirmed === false) return;
          commitClear(source);
        })
        .catch(error => warnObserverError('confirmClearConversation', error))
        .finally(() => {
          clearConfirmationActiveRef.current = false;
          setClearConfirmationPending(false);
        });
      return;
    }

    if (confirmation === false) return;
    commitClear(source);
  }, [clearConfirmationActiveRef, commitClear, confirmClearConversationRef, messagesRef, persistenceKeyRef, resetToInitialMessagesRef, setClearConfirmationPending]);

  const handleEdit = React.useCallback((id: string, newText: string) => {
    if (isBusy()) return;
    const trimmed = newText.trim();
    if (!trimmed) return;
    const currentMessages = messagesRef.current;
    const idx = currentMessages.findIndex(m => m.id === id);
    if (idx === -1) return;
    const currentMessage = currentMessages[idx];
    if (!currentMessage || currentMessage.role !== 'user') return;
    const edited: Message<TMeta> = { ...currentMessage, text: trimmed };
    const next = updateSessionMessages(prev => [...prev.slice(0, idx), edited], { flushPersistence: true, reason: 'edit' });
    triggerAssistant(trimmed, next);
  }, [isBusy, messagesRef, triggerAssistant, updateSessionMessages]);

  const handleRegenerate = React.useCallback((id: string) => {
    if (isBusy()) return;
    const currentMessages = messagesRef.current;
    const idx = currentMessages.findIndex(m => m.id === id);
    if (idx === -1) return;
    let userIdx = idx - 1;
    while (userIdx >= 0 && currentMessages[userIdx]?.role !== 'user') userIdx -= 1;
    if (userIdx < 0) return;
    const userMsg = currentMessages[userIdx];
    if (!userMsg || userMsg.role !== 'user') return;
    const next = updateSessionMessages(prev => {
      const history = streamError ? dropTrailingAssistant(prev) : prev;
      return history.slice(0, userIdx + 1);
    }, { flushPersistence: true, reason: 'regenerate' });
    triggerAssistant(userMsg.text, next);
  }, [isBusy, messagesRef, streamError, triggerAssistant, updateSessionMessages]);

  const handleDelete = React.useCallback((id: string) => {
    if (isBusy()) return;
    if (pendingDeleteIdsRef.current.has(id)) return;

    const currentMessages = messagesRef.current;
    const message = currentMessages.find(m => m.id === id);
    if (!message) return;

    const commitDelete = () => {
      updateSessionMessages(prev => prev.filter(m => m.id !== id), { flushPersistence: true, reason: 'delete' });
    };

    let confirmation: boolean | void | Promise<boolean | void>;
    try {
      confirmation = confirmDeleteMessageRef.current?.({ message, messages: currentMessages.slice() });
    } catch (error) {
      warnObserverError('confirmDeleteMessage', error);
      return;
    }

    if (isPromiseLike<boolean | void>(confirmation)) {
      pendingDeleteIdsRef.current.add(id);
      Promise.resolve(confirmation)
        .then(confirmed => {
          if (confirmed === false) return;
          // A send may have started while the confirmation was pending; deleting
          // the active streaming message (or its context) would orphan pending state.
          if (isBusy()) return;
          commitDelete();
        })
        .catch(error => warnObserverError('confirmDeleteMessage', error))
        .finally(() => {
          pendingDeleteIdsRef.current.delete(id);
        });
      return;
    }

    if (confirmation === false) return;
    commitDelete();
  }, [confirmDeleteMessageRef, isBusy, messagesRef, pendingDeleteIdsRef, updateSessionMessages]);

  return { send, retry, stop, clear, handleEdit, handleRegenerate, handleDelete };
}
