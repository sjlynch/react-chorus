import React from 'react';
import type { Message } from '../../types';
import { applyEditedUserHistory, createEditedUserHistory, createRegenerateHistory, regenerateHistoryThroughUser } from './sessionCommandTransforms';
import type { UpdateSessionMessages } from './types';

export interface EditRegenerateCommandDeps<TMeta> {
  messagesRef: React.MutableRefObject<Message<TMeta>[]>;
  streamError: string | null;
  isBusy: () => boolean;
  triggerAssistant: (text: string, history: Message<TMeta>[]) => void;
  updateSessionMessages: UpdateSessionMessages<TMeta>;
}

export interface EditRegenerateCommands {
  handleEdit: (id: string, newText: string) => void;
  handleRegenerate: (id: string) => void;
}

export function useEditRegenerateCommands<TMeta>({
  messagesRef,
  streamError,
  isBusy,
  triggerAssistant,
  updateSessionMessages,
}: EditRegenerateCommandDeps<TMeta>): EditRegenerateCommands {
  const handleEdit = React.useCallback((id: string, newText: string) => {
    if (isBusy()) return;

    const edit = createEditedUserHistory(messagesRef.current, id, newText);
    if (!edit) return;

    const next = updateSessionMessages(
      prev => applyEditedUserHistory(prev, edit.index, edit.message),
      { flushPersistence: true, reason: 'edit' },
    );
    triggerAssistant(edit.text, next);
  }, [isBusy, messagesRef, triggerAssistant, updateSessionMessages]);

  const handleRegenerate = React.useCallback((id: string) => {
    if (isBusy()) return;

    const regeneration = createRegenerateHistory(messagesRef.current, id, Boolean(streamError));
    if (!regeneration) return;

    const hasStreamError = Boolean(streamError);
    const next = updateSessionMessages(
      prev => regenerateHistoryThroughUser(prev, regeneration.userIndex, hasStreamError),
      { flushPersistence: true, reason: 'regenerate' },
    );
    triggerAssistant(regeneration.text, next);
  }, [isBusy, messagesRef, streamError, triggerAssistant, updateSessionMessages]);

  return { handleEdit, handleRegenerate };
}
