import React from 'react';
import { DEFAULT_CONVERSATION_LIST_LABELS } from '../labels/conversationList';
import { styleVarsFromPalette } from './ChorusTheme';
import { ConversationListItem } from './conversation-list/ConversationListItem';
import { defaultFormatTimestamp } from './conversation-list/formatTimestamp';
import { sortedConversations } from './conversation-list/sorting';
import type { ConversationListProps } from './conversation-list/types';
import { useConversationRename } from './conversation-list/useConversationRename';
import { useDeleteConversationConfirmation } from './conversation-list/useDeleteConversationConfirmation';

export type { ConfirmDeleteConversation, ConfirmDeleteConversationContext, ConversationListProps } from './conversation-list/types';

export function ConversationList({
  conversations,
  activeId = null,
  createConversation,
  selectConversation,
  renameConversation,
  deleteConversation,
  confirmDeleteConversation,
  pinConversation,
  loaded = true,
  formatTimestamp = defaultFormatTimestamp,
  palette,
  headless = false,
  className,
  style,
  newConversationLabel,
  emptyLabel,
  labels = DEFAULT_CONVERSATION_LIST_LABELS,
}: ConversationListProps) {
  const resolvedNewConversation = newConversationLabel ?? labels.newConversation;
  const resolvedEmpty = emptyLabel ?? labels.empty;
  // Apply palette CSS variables regardless of `headless`, matching <Chorus>,
  // <ChatWindow>, and <ChatInput>. `palette` is a host-supplied theme, not
  // default styling, so headless renders honor it too.
  const paletteVars = React.useMemo(() => styleVarsFromPalette(palette), [palette]);
  const orderedConversations = React.useMemo(() => sortedConversations(conversations), [conversations]);
  const interactionsDisabled = !loaded;
  const {
    editingId,
    draftTitle,
    setDraftTitle,
    renameInputRef,
    isDraftEmpty,
    startRename,
    cancelRename,
    submitRename,
  } = useConversationRename(conversations, renameConversation);
  const { pendingDeleteIds, handleDeleteConversation } = useDeleteConversationConfirmation({
    conversations,
    activeId,
    deleteConversation,
    confirmDeleteConversation,
    interactionsDisabled,
  });
  const rootClassName = [
    'chorus-conversation-list',
    headless ? 'chorus-conversation-list--headless' : undefined,
    interactionsDisabled ? 'chorus-conversation-list--loading' : undefined,
    className,
  ].filter(Boolean).join(' ');

  return (
    <nav className={rootClassName} style={{ ...paletteVars, ...style }} aria-label={labels.navAriaLabel}>
      {createConversation && (
        <button type="button" className="chorus-conversation-new" onClick={() => createConversation()} disabled={interactionsDisabled} aria-disabled={interactionsDisabled || undefined}>
          {resolvedNewConversation}
        </button>
      )}

      <div className="chorus-conversation-items" role="list">
        {conversations.length === 0 && <div className="chorus-conversation-empty">{resolvedEmpty}</div>}
        {orderedConversations.map(conversation => {
          const active = conversation.id === activeId;
          const editing = conversation.id === editingId;
          const pinned = Boolean(conversation.pinned);
          return (
            <ConversationListItem
              key={conversation.id}
              conversation={conversation}
              active={active}
              editing={editing}
              pinned={pinned}
              pending={pendingDeleteIds.has(conversation.id)}
              disabled={interactionsDisabled}
              labels={labels}
              formatTime={formatTimestamp}
              selectConversation={selectConversation}
              renameConversation={renameConversation}
              deleteConversation={deleteConversation}
              pinConversation={pinConversation}
              draftTitle={draftTitle}
              setDraftTitle={setDraftTitle}
              renameInputRef={renameInputRef}
              isDraftEmpty={isDraftEmpty}
              startRename={startRename}
              cancelRename={cancelRename}
              submitRename={submitRename}
              onDelete={handleDeleteConversation}
            />
          );
        })}
      </div>
    </nav>
  );
}
