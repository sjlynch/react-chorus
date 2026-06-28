import type { Attachment, Message } from '../../types';
import type { SubmittedUserTurn, UpdateMessagesOptions } from './types';
import { cloneHistoryForRetry, createMessageId, dropTrailingAssistant, findLastUserMessage } from './messageUtils';

export function appendUserTurn<TMeta>(history: Message<TMeta>[], text: string, attachments: Attachment[] = []): Message<TMeta>[] {
  return history.concat({
    id: createMessageId(),
    role: 'user',
    text,
    attachments: attachments.length > 0 ? attachments : undefined,
  });
}

export function createRetryHistory<TMeta>(history: Message<TMeta>[]): Message<TMeta>[] {
  return cloneHistoryForRetry(history);
}

export interface EditedUserHistory<TMeta> {
  text: string;
  index: number;
  message: Message<TMeta>;
  history: Message<TMeta>[];
}

export function applyEditedUserHistory<TMeta>(
  history: Message<TMeta>[],
  index: number,
  editedMessage: Message<TMeta>,
): Message<TMeta>[] {
  return [...history.slice(0, index), editedMessage];
}

export function createEditedUserHistory<TMeta>(
  currentMessages: Message<TMeta>[],
  id: string,
  newText: string,
): EditedUserHistory<TMeta> | null {
  const trimmed = newText.trim();
  if (!trimmed) return null;

  const idx = currentMessages.findIndex(m => m.id === id);
  if (idx === -1) return null;

  const currentMessage = currentMessages[idx];
  if (!currentMessage || currentMessage.role !== 'user') return null;

  const edited: Message<TMeta> = { ...currentMessage, text: trimmed };
  return {
    text: trimmed,
    index: idx,
    message: edited,
    history: applyEditedUserHistory(currentMessages, idx, edited),
  };
}

/**
 * Edit a non-user message's text IN PLACE: replace the text of the row with the
 * matching id and keep the rest of the transcript intact (no truncation, no
 * regeneration). Returns `null` when the edit is a no-op — empty/whitespace text,
 * an unknown id, or text identical to the current value — so callers can skip a
 * spurious persistence write. Used for assistant/system/tool edits, which (unlike
 * a user edit) are corrections rather than a new turn.
 */
export function applyInPlaceEdit<TMeta>(
  history: Message<TMeta>[],
  id: string,
  newText: string,
): Message<TMeta>[] | null {
  const trimmed = newText.trim();
  if (!trimmed) return null;

  const idx = history.findIndex(m => m.id === id);
  if (idx === -1) return null;

  const current = history[idx];
  if (!current || current.text === trimmed) return null;

  return [...history.slice(0, idx), { ...current, text: trimmed }, ...history.slice(idx + 1)];
}

export interface RegenerateHistory<TMeta> {
  text: string;
  userIndex: number;
  history: Message<TMeta>[];
}

export function regenerateHistoryThroughUser<TMeta>(
  history: Message<TMeta>[],
  userIndex: number,
  hasStreamError: boolean,
): Message<TMeta>[] {
  const baseHistory = hasStreamError ? dropTrailingAssistant(history) : history;
  return baseHistory.slice(0, userIndex + 1);
}

export function createRegenerateHistory<TMeta>(
  currentMessages: Message<TMeta>[],
  id: string,
  hasStreamError: boolean,
): RegenerateHistory<TMeta> | null {
  const idx = currentMessages.findIndex(m => m.id === id);
  if (idx === -1) return null;

  let userIdx = idx - 1;
  while (userIdx >= 0 && currentMessages[userIdx]?.role !== 'user') userIdx -= 1;
  if (userIdx < 0) return null;

  const userMsg = currentMessages[userIdx];
  if (!userMsg || userMsg.role !== 'user') return null;

  return {
    text: userMsg.text,
    userIndex: userIdx,
    history: regenerateHistoryThroughUser(currentMessages, userIdx, hasStreamError),
  };
}

export function deleteMessageById<TMeta>(history: Message<TMeta>[], id: string): Message<TMeta>[] {
  return history.filter(m => m.id !== id);
}

/**
 * True when deleting `id` invalidates the last submitted turn — either it is
 * the current last user turn, or it is one of the messages the still-armed
 * Retry would replay from `lastSubmittedTurnRef`'s history. Callers use this to
 * drop the stream-error banner and submitted-turn ref so a stale Retry cannot
 * resurrect a just-deleted message.
 */
export function deletionInvalidatesSubmittedTurn<TMeta>(
  currentMessages: Message<TMeta>[],
  submittedTurn: SubmittedUserTurn<TMeta> | null,
  id: string,
): boolean {
  if (findLastUserMessage(currentMessages)?.id === id) return true;
  return submittedTurn?.history.some(m => m.id === id) ?? false;
}

export function messagesAfterClear<TMeta>(seedMessages: Message<TMeta>[], resetToInitialMessages: boolean): Message<TMeta>[] {
  return resetToInitialMessages ? seedMessages : [];
}

export function clearUpdateOptions<TMeta>(
  seedMessages: Message<TMeta>[],
  resetToInitialMessages: boolean,
): UpdateMessagesOptions {
  return {
    flushPersistence: true,
    removePersistenceIfEmpty: !resetToInitialMessages && seedMessages.length === 0,
    reason: 'clear',
  };
}
