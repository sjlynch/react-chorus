import React from 'react';
import type { Message } from '../../types';
import { runConfirmationFlow } from './confirmationFlow';
import { deleteMessageById, deletionInvalidatesSubmittedTurn } from './sessionCommandTransforms';
import type { ChorusConfirmDeleteMessage, SubmittedUserTurn, UpdateSessionMessages } from './types';

export interface DeleteCommandDeps<TMeta> {
  messagesRef: React.MutableRefObject<Message<TMeta>[]>;
  pendingDeleteIdsRef: React.MutableRefObject<Set<string>>;
  confirmDeleteMessageRef: React.MutableRefObject<ChorusConfirmDeleteMessage<TMeta> | undefined>;
  lastSubmittedTurnRef: React.MutableRefObject<SubmittedUserTurn<TMeta> | null>;
  isBusy: () => boolean;
  clearStreamError: () => void;
  updateSessionMessages: UpdateSessionMessages<TMeta>;
}

export function useDeleteCommand<TMeta>({
  messagesRef,
  pendingDeleteIdsRef,
  confirmDeleteMessageRef,
  lastSubmittedTurnRef,
  isBusy,
  clearStreamError,
  updateSessionMessages,
}: DeleteCommandDeps<TMeta>): (id: string) => void {
  return React.useCallback((id: string) => {
    if (isBusy()) return;
    if (pendingDeleteIdsRef.current.has(id)) return;

    const currentMessages = messagesRef.current;
    const message = currentMessages.find(m => m.id === id);
    if (!message) return;

    const commitDelete = () => {
      // A stream error leaves the banner armed and `lastSubmittedTurnRef`
      // pointing at the still-visible turn. If this delete removes the last
      // user turn (or any message Retry would replay), disarm both so the
      // banner is dismissed and Retry can't resurrect the deleted message.
      if (deletionInvalidatesSubmittedTurn(messagesRef.current, lastSubmittedTurnRef.current, id)) {
        clearStreamError();
        lastSubmittedTurnRef.current = null;
      }
      updateSessionMessages(prev => deleteMessageById(prev, id), { flushPersistence: true, reason: 'delete' });
    };

    runConfirmationFlow({
      label: 'confirmDeleteMessage',
      requestConfirmation: () => confirmDeleteMessageRef.current?.({ message, messages: currentMessages.slice() }),
      onConfirmed: commitDelete,
      // A send may have started while the confirmation was pending; deleting
      // the active streaming message (or its context) would orphan pending state.
      shouldCommit: phase => phase === 'sync' || !isBusy(),
      onPendingChange: pending => {
        if (pending) pendingDeleteIdsRef.current.add(id);
        else pendingDeleteIdsRef.current.delete(id);
      },
    });
  }, [clearStreamError, confirmDeleteMessageRef, isBusy, lastSubmittedTurnRef, messagesRef, pendingDeleteIdsRef, updateSessionMessages]);
}
