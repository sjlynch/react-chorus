import React from 'react';
import type { ConversationSummary } from '../../hooks/useConversations';

/**
 * Rename-form state for the single conversation row currently being edited.
 *
 * `ConversationList` owns this state via `useConversationRename` and provides
 * it once around the list; each `ConversationListItem` consumes it and derives
 * its own `editing` flag from `conversation.id === editingId`. Moving it into
 * context keeps the per-row props focused on conversation data, selection, and
 * delete handling instead of drilling a dozen rename fields through every row.
 *
 * `restoreFocusId`/`clearRestoreFocus` stay on the hook return rather than the
 * context — they drive `ConversationList`'s post-rename focus effect and are
 * never read by a row.
 */
export interface ConversationRenameContextValue {
  /** Id of the conversation whose row is in rename mode, or null when none is. */
  editingId: string | null;
  draftTitle: string;
  setDraftTitle: React.Dispatch<React.SetStateAction<string>>;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  isDraftEmpty: boolean;
  isDraftTooLong: boolean;
  startRename: (conversation: ConversationSummary) => void;
  cancelRename: () => void;
  submitRename: (id: string) => void;
}

const ConversationRenameContext = React.createContext<ConversationRenameContextValue | null>(null);

/** Provides the active row's rename-form state to every `ConversationListItem`. */
export const ConversationRenameProvider = ConversationRenameContext.Provider;

/**
 * Reads the rename-form state for the enclosing `ConversationList`. Throws when
 * used outside a `ConversationRenameProvider` so a missing provider surfaces as
 * a clear error instead of silently disabling rename in every row.
 */
export function useConversationRenameContext(): ConversationRenameContextValue {
  const value = React.useContext(ConversationRenameContext);
  if (!value) {
    throw new Error('useConversationRenameContext must be used within a ConversationRenameProvider');
  }
  return value;
}
