import React from 'react';
import type { Message } from '../../types';
import { applyEditedUserHistory, createEditedUserHistory, createRegenerateHistory, regenerateHistoryThroughUser } from './sessionCommandTransforms';
import { isTransportPresent } from './transportResolver';
import type { ChorusOnSend, UpdateSessionMessages } from './types';

export interface EditRegenerateCommandDeps<TMeta> {
  messagesRef: React.MutableRefObject<Message<TMeta>[]>;
  transportRef: React.MutableRefObject<unknown>;
  onSendRef: React.MutableRefObject<ChorusOnSend<TMeta> | undefined>;
  streamError: string | null;
  isBusy: () => boolean;
  triggerAssistant: (text: string, history: Message<TMeta>[]) => void;
  updateSessionMessages: UpdateSessionMessages<TMeta>;
  warnMissingResponseHandler: () => void;
}

export interface EditRegenerateCommands {
  handleEdit: (id: string, newText: string) => void;
  handleRegenerate: (id: string) => void;
}

export function useEditRegenerateCommands<TMeta>({
  messagesRef,
  transportRef,
  onSendRef,
  streamError,
  isBusy,
  triggerAssistant,
  updateSessionMessages,
  warnMissingResponseHandler,
}: EditRegenerateCommandDeps<TMeta>): EditRegenerateCommands {
  // Mirror send()'s guard: with neither `transport` nor `onSend` configured
  // there is no response handler to dispatch the turn to. `triggerAssistant`
  // would resolve the path to `'missing'` and only warn — but by then the
  // edit/regenerate has already mutated the transcript. Check up front so the
  // transcript is left untouched when the turn cannot actually be sent.
  const hasResponseHandler = React.useCallback(
    () => isTransportPresent(transportRef.current) || Boolean(onSendRef.current),
    [onSendRef, transportRef],
  );

  const handleEdit = React.useCallback((id: string, newText: string) => {
    if (isBusy()) return;

    const edit = createEditedUserHistory(messagesRef.current, id, newText);
    if (!edit) return;

    if (!hasResponseHandler()) {
      warnMissingResponseHandler();
      return;
    }

    const next = updateSessionMessages(
      prev => applyEditedUserHistory(prev, edit.index, edit.message),
      { flushPersistence: true, reason: 'edit' },
    );
    triggerAssistant(edit.text, next);
  }, [hasResponseHandler, isBusy, messagesRef, triggerAssistant, updateSessionMessages, warnMissingResponseHandler]);

  const handleRegenerate = React.useCallback((id: string) => {
    if (isBusy()) return;

    const regeneration = createRegenerateHistory(messagesRef.current, id, Boolean(streamError));
    if (!regeneration) return;

    if (!hasResponseHandler()) {
      warnMissingResponseHandler();
      return;
    }

    const hasStreamError = Boolean(streamError);
    const next = updateSessionMessages(
      prev => regenerateHistoryThroughUser(prev, regeneration.userIndex, hasStreamError),
      { flushPersistence: true, reason: 'regenerate' },
    );
    triggerAssistant(regeneration.text, next);
  }, [hasResponseHandler, isBusy, messagesRef, streamError, triggerAssistant, updateSessionMessages, warnMissingResponseHandler]);

  return { handleEdit, handleRegenerate };
}
