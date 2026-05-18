import React from 'react';
import type { ConversationSummary } from '../../hooks/useConversations';
import type { ConfirmDeleteConversation } from './types';

// Inlined — importing `utils/async` would put ConversationList on a shared
// chunk with the assistant-session hook tree and inflate the ConversationList
// bundle-size number tracked in the README "Current numbers" table.
function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof (value as { then?: unknown }).then === 'function';
}

function warnDeleteConfirmationError(callbackName: string, error: unknown) {
  // Inlined dev-mode gate: importing the shared helper would pull the heavy chorus-session
  // chunk into ConversationList's initial graph, blowing the bundle budget.
  if (typeof process === 'undefined' || process.env?.NODE_ENV === 'production') return;
  console.warn(`[Chorus] \`${callbackName}\` callback threw/rejected; delete was cancelled.`, error);
}

interface UseDeleteConversationConfirmationOptions {
  conversations: ConversationSummary[];
  activeId: string | null;
  deleteConversation?: (id: string) => void;
  confirmDeleteConversation?: ConfirmDeleteConversation;
  interactionsDisabled: boolean;
}

export function useDeleteConversationConfirmation({
  conversations,
  activeId,
  deleteConversation,
  confirmDeleteConversation,
  interactionsDisabled,
}: UseDeleteConversationConfirmationOptions) {
  const [pendingDeleteIds, setPendingDeleteIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setDeletePending = React.useCallback((id: string, pending: boolean) => {
    if (!mountedRef.current) return;
    setPendingDeleteIds(prev => {
      const next = new Set(prev);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleDeleteConversation = React.useCallback((conversation: ConversationSummary) => {
    if (!deleteConversation || interactionsDisabled || pendingDeleteIds.has(conversation.id)) return;

    const commitDelete = () => deleteConversation(conversation.id);
    let confirmation: boolean | void | Promise<boolean | void>;
    try {
      confirmation = confirmDeleteConversation?.({ conversation, conversations: conversations.slice(), activeId });
    } catch (error) {
      warnDeleteConfirmationError('confirmDeleteConversation', error);
      return;
    }

    if (isPromiseLike<boolean | void>(confirmation)) {
      setDeletePending(conversation.id, true);
      Promise.resolve(confirmation)
        .then(confirmed => {
          if (confirmed === false) return;
          commitDelete();
        })
        .catch(error => warnDeleteConfirmationError('confirmDeleteConversation', error))
        .finally(() => setDeletePending(conversation.id, false));
      return;
    }

    if (confirmation === false) return;
    commitDelete();
  }, [activeId, confirmDeleteConversation, conversations, deleteConversation, interactionsDisabled, pendingDeleteIds, setDeletePending]);

  return { pendingDeleteIds, handleDeleteConversation };
}
