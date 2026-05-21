import React from 'react';
import type { Message } from '../../types';
import { runConfirmationFlow } from './confirmationFlow';
import { deleteMessageById } from './sessionCommandTransforms';
import type { ChorusConfirmDeleteMessage, UpdateSessionMessages } from './types';

export interface DeleteCommandDeps<TMeta> {
  messagesRef: React.MutableRefObject<Message<TMeta>[]>;
  pendingDeleteIdsRef: React.MutableRefObject<Set<string>>;
  confirmDeleteMessageRef: React.MutableRefObject<ChorusConfirmDeleteMessage<TMeta> | undefined>;
  isBusy: () => boolean;
  updateSessionMessages: UpdateSessionMessages<TMeta>;
}

export function useDeleteCommand<TMeta>({
  messagesRef,
  pendingDeleteIdsRef,
  confirmDeleteMessageRef,
  isBusy,
  updateSessionMessages,
}: DeleteCommandDeps<TMeta>): (id: string) => void {
  return React.useCallback((id: string) => {
    if (isBusy()) return;
    if (pendingDeleteIdsRef.current.has(id)) return;

    const currentMessages = messagesRef.current;
    const message = currentMessages.find(m => m.id === id);
    if (!message) return;

    const commitDelete = () => {
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
  }, [confirmDeleteMessageRef, isBusy, messagesRef, pendingDeleteIdsRef, updateSessionMessages]);
}
