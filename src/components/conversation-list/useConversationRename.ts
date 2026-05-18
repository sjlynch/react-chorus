import React from 'react';
import type { ConversationSummary } from '../../hooks/useConversations';

export function useConversationRename(
  conversations: ConversationSummary[],
  renameConversation?: (id: string, title: string) => void,
) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draftTitle, setDraftTitle] = React.useState('');
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const isDraftEmpty = draftTitle.trim().length === 0;

  React.useEffect(() => {
    if (!editingId) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editingId]);

  React.useEffect(() => {
    if (editingId && !conversations.some(c => c.id === editingId)) {
      setEditingId(null);
      setDraftTitle('');
    }
  }, [conversations, editingId]);

  const startRename = React.useCallback((conversation: ConversationSummary) => {
    setEditingId(conversation.id);
    setDraftTitle(conversation.title);
  }, []);

  const cancelRename = React.useCallback(() => {
    setEditingId(null);
    setDraftTitle('');
  }, []);

  const submitRename = React.useCallback((id: string) => {
    const trimmed = draftTitle.trim();
    if (!trimmed) {
      renameInputRef.current?.focus();
      return;
    }
    renameConversation?.(id, trimmed);
    cancelRename();
  }, [cancelRename, draftTitle, renameConversation]);

  return {
    editingId,
    draftTitle,
    setDraftTitle,
    renameInputRef,
    isDraftEmpty,
    startRename,
    cancelRename,
    submitRename,
  };
}
