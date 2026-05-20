import React from 'react';
import type { ConversationSummary } from '../../hooks/useConversations';

/**
 * Maximum number of characters allowed in a conversation rename draft.
 *
 * Enforced in two places: the rename `<input>` carries this as its native
 * `maxLength` attribute (blocking typed/pasted input past the limit) and
 * `submitRename` rejects an over-long trimmed draft so a pre-existing long
 * title can never be saved through the rename form.
 */
export const CONVERSATION_RENAME_MAX_LENGTH = 120;

export function useConversationRename(
  conversations: ConversationSummary[],
  renameConversation?: (id: string, title: string) => void,
) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draftTitle, setDraftTitle] = React.useState('');
  // Conversation id whose row trigger should regain focus after rename mode
  // exits (cancel or successful submit), so focus never falls back to <body>.
  const [restoreFocusId, setRestoreFocusId] = React.useState<string | null>(null);
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const trimmedDraftLength = draftTitle.trim().length;
  const isDraftEmpty = trimmedDraftLength === 0;
  const isDraftTooLong = trimmedDraftLength > CONVERSATION_RENAME_MAX_LENGTH;

  React.useEffect(() => {
    if (!editingId) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editingId]);

  React.useEffect(() => {
    if (editingId && !conversations.some(c => c.id === editingId)) {
      // The edited conversation vanished underneath us — there is no row
      // trigger left to restore focus to, so drop the pending request too.
      setEditingId(null);
      setDraftTitle('');
      setRestoreFocusId(null);
    }
  }, [conversations, editingId]);

  const startRename = React.useCallback((conversation: ConversationSummary) => {
    setEditingId(conversation.id);
    setDraftTitle(conversation.title);
    setRestoreFocusId(null);
  }, []);

  const cancelRename = React.useCallback(() => {
    if (editingId) setRestoreFocusId(editingId);
    setEditingId(null);
    setDraftTitle('');
  }, [editingId]);

  const submitRename = React.useCallback((id: string) => {
    const trimmed = draftTitle.trim();
    if (!trimmed || trimmed.length > CONVERSATION_RENAME_MAX_LENGTH) {
      // Keep focus in the input so the inline validation message is reachable.
      renameInputRef.current?.focus();
      return;
    }
    renameConversation?.(id, trimmed);
    cancelRename();
  }, [cancelRename, draftTitle, renameConversation]);

  const clearRestoreFocus = React.useCallback(() => setRestoreFocusId(null), []);

  return {
    editingId,
    draftTitle,
    setDraftTitle,
    renameInputRef,
    isDraftEmpty,
    isDraftTooLong,
    restoreFocusId,
    clearRestoreFocus,
    startRename,
    cancelRename,
    submitRename,
  };
}
