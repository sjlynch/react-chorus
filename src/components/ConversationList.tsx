import React from 'react';
import { DEFAULT_CONVERSATION_LIST_LABELS } from '../labels/conversationList';
import { styleVarsFromPalette } from './conversation-list/styleVars';
import { ConversationListItem } from './conversation-list/ConversationListItem';
import { defaultFormatTimestamp } from './conversation-list/formatTimestamp';
import { sortedConversations } from './conversation-list/sorting';
import { ConversationRenameProvider, type ConversationRenameContextValue } from './conversation-list/renameContext';
import type { ConversationListProps } from './conversation-list/types';
import { useConversationRename } from './conversation-list/useConversationRename';
import { useDeleteConversationConfirmation } from './conversation-list/useDeleteConversationConfirmation';
import type { ConversationSummary } from '../hooks/useConversations';
import { joinClasses } from '../utils/className';

export type { ConfirmDeleteConversation, ConfirmDeleteConversationContext, ConversationListProps } from './conversation-list/types';

function findRow(container: HTMLElement, conversationId: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-conversation-id]'))
    .find(node => node.dataset.conversationId === conversationId);
}

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

  // Container for the conversation rows; focus is moved here as a last resort
  // after a delete (e.g. the deleted row was the only one left).
  const itemsRef = React.useRef<HTMLDivElement>(null);
  // Latest display order, read inside the (otherwise stable) delete callback so
  // it can pick the deleted row's neighbour without re-creating the callback.
  const orderedConversationsRef = React.useRef(orderedConversations);
  orderedConversationsRef.current = orderedConversations;

  // Polite live-region message announced after a row is deleted.
  const [announcement, setAnnouncement] = React.useState('');
  // Pending post-delete focus move: `neighbourId` is the row to focus, or null
  // to fall back to the list container when no rows remain.
  const [pendingDeleteFocus, setPendingDeleteFocus] = React.useState<{ neighbourId: string | null } | null>(null);

  const {
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
  } = useConversationRename(conversations, renameConversation);

  // Rename-form state for the single editing row, provided once around the
  // list so each row consumes it via context instead of prop-drilling.
  const renameContextValue = React.useMemo<ConversationRenameContextValue>(() => ({
    editingId,
    draftTitle,
    setDraftTitle,
    renameInputRef,
    isDraftEmpty,
    isDraftTooLong,
    startRename,
    cancelRename,
    submitRename,
  }), [editingId, draftTitle, setDraftTitle, renameInputRef, isDraftEmpty, isDraftTooLong, startRename, cancelRename, submitRename]);

  const handleConversationDeleted = React.useCallback((conversation: ConversationSummary) => {
    const order = orderedConversationsRef.current;
    const index = order.findIndex(c => c.id === conversation.id);
    const neighbour = index >= 0 ? (order[index + 1] ?? order[index - 1]) : undefined;
    setPendingDeleteFocus({ neighbourId: neighbour?.id ?? null });
    setAnnouncement(labels.deletedAnnouncement(conversation.title));
  }, [labels]);

  const { pendingDeleteIds, handleDeleteConversation } = useDeleteConversationConfirmation({
    conversations,
    activeId,
    deleteConversation,
    confirmDeleteConversation,
    interactionsDisabled,
    onConversationDeleted: handleConversationDeleted,
  });

  // After rename mode exits (cancel or successful submit), return focus to the
  // row's rename trigger so keyboard focus never lands on <body>.
  React.useEffect(() => {
    if (!restoreFocusId) return;
    const container = itemsRef.current;
    if (container) {
      findRow(container, restoreFocusId)
        ?.querySelector<HTMLElement>('.chorus-conversation-rename-trigger')
        ?.focus();
    }
    clearRestoreFocus();
  }, [restoreFocusId, clearRestoreFocus]);

  // After a delete, the deleted row is gone from the DOM — move focus to a
  // sibling row's select control, or the list container if none remain.
  React.useEffect(() => {
    if (!pendingDeleteFocus) return;
    const container = itemsRef.current;
    let target: HTMLElement | null = container;
    const { neighbourId } = pendingDeleteFocus;
    if (neighbourId && container) {
      const select = findRow(container, neighbourId)?.querySelector<HTMLElement>('.chorus-conversation-select');
      if (select) target = select;
    }
    target?.focus();
    setPendingDeleteFocus(null);
  }, [pendingDeleteFocus]);

  const rootClassName = joinClasses(
    'chorus-conversation-list',
    headless ? 'chorus-conversation-list--headless' : undefined,
    interactionsDisabled ? 'chorus-conversation-list--loading' : undefined,
    className,
  );

  return (
    <nav className={rootClassName} style={{ ...paletteVars, ...style }} aria-label={labels.navAriaLabel}>
      {createConversation && (
        <button type="button" className="chorus-conversation-new" onClick={() => createConversation()} disabled={interactionsDisabled} aria-disabled={interactionsDisabled || undefined}>
          {resolvedNewConversation}
        </button>
      )}

      {/* `aria-label` is stable across empty/non-empty: when the list empties
          after a delete, `role` drops to `undefined` and the post-delete focus
          effect moves focus onto this container — without a label a screen
          reader would announce a bare, role-less <div>. */}
      <div className="chorus-conversation-items" role={conversations.length === 0 ? undefined : 'list'} aria-label={labels.navAriaLabel} ref={itemsRef} tabIndex={-1}>
        {conversations.length === 0 && <div className="chorus-conversation-empty">{resolvedEmpty}</div>}
        <ConversationRenameProvider value={renameContextValue}>
          {orderedConversations.map(conversation => {
            const active = conversation.id === activeId;
            const pinned = Boolean(conversation.pinned);
            return (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                active={active}
                pinned={pinned}
                pending={pendingDeleteIds.has(conversation.id)}
                disabled={interactionsDisabled}
                labels={labels}
                formatTime={formatTimestamp}
                selectConversation={selectConversation}
                renameConversation={renameConversation}
                deleteConversation={deleteConversation}
                pinConversation={pinConversation}
                onDelete={handleDeleteConversation}
              />
            );
          })}
        </ConversationRenameProvider>
      </div>

      <div className="chorus-sr-only" role="status" aria-live="polite">{announcement}</div>
    </nav>
  );
}
