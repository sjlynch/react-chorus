import React from 'react';
import type { ConversationSummary } from '../hooks/useConversations';
import { styleVarsFromPalette, type Palette } from './ChorusTheme';

export interface ConversationListProps {
  conversations: ConversationSummary[];
  activeId?: string | null;
  createConversation?: (title?: string) => string | void;
  selectConversation?: (id: string) => void;
  renameConversation?: (id: string, title: string) => void;
  deleteConversation?: (id: string) => void;
  pinConversation?: (id: string, pinned?: boolean) => void;
  formatTimestamp?: (timestamp: string, conversation: ConversationSummary) => React.ReactNode;
  palette?: Palette;
  headless?: boolean;
  className?: string;
  style?: React.CSSProperties;
  newConversationLabel?: string;
  emptyLabel?: string;
}

function conversationClasses(active: boolean, pinned: boolean) {
  return [
    'chorus-conversation-item',
    active ? 'chorus-conversation-item--active' : undefined,
    pinned ? 'chorus-conversation-item--pinned' : undefined,
  ].filter(Boolean).join(' ');
}

function defaultFormatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function sortedConversations(conversations: ConversationSummary[]) {
  return conversations
    .map((conversation, index) => ({ conversation, index }))
    .sort((a, b) => {
      const pinnedDelta = Number(Boolean(b.conversation.pinned)) - Number(Boolean(a.conversation.pinned));
      if (pinnedDelta !== 0) return pinnedDelta;

      const aTime = Date.parse(a.conversation.updatedAt);
      const bTime = Date.parse(b.conversation.updatedAt);
      const recencyDelta = (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
      if (recencyDelta !== 0) return recencyDelta;

      return a.index - b.index;
    })
    .map(({ conversation }) => conversation);
}

export function ConversationList({
  conversations,
  activeId = null,
  createConversation,
  selectConversation,
  renameConversation,
  deleteConversation,
  pinConversation,
  formatTimestamp = defaultFormatTimestamp,
  palette,
  headless = false,
  className,
  style,
  newConversationLabel = 'New conversation',
  emptyLabel = 'No conversations yet',
}: ConversationListProps) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draftTitle, setDraftTitle] = React.useState('');
  const paletteVars = React.useMemo(() => (headless ? {} : styleVarsFromPalette(palette)), [headless, palette]);
  const orderedConversations = React.useMemo(() => sortedConversations(conversations), [conversations]);
  const rootClassName = [
    'chorus-conversation-list',
    headless ? 'chorus-conversation-list--headless' : undefined,
    className,
  ].filter(Boolean).join(' ');

  const startRename = (conversation: ConversationSummary) => {
    setEditingId(conversation.id);
    setDraftTitle(conversation.title);
  };

  const cancelRename = () => {
    setEditingId(null);
    setDraftTitle('');
  };

  const submitRename = (id: string) => {
    const trimmed = draftTitle.trim();
    if (trimmed) renameConversation?.(id, trimmed);
    cancelRename();
  };

  return (
    <nav className={rootClassName} style={{ ...paletteVars, ...style }} aria-label="Conversations">
      {createConversation && (
        <button type="button" className="chorus-conversation-new" onClick={() => createConversation()}>
          {newConversationLabel}
        </button>
      )}

      <div className="chorus-conversation-items" role="list">
        {conversations.length === 0 && <div className="chorus-conversation-empty">{emptyLabel}</div>}
        {orderedConversations.map(conversation => {
          const active = conversation.id === activeId;
          const editing = conversation.id === editingId;
          const pinned = Boolean(conversation.pinned);

          return (
            <div key={conversation.id} className={conversationClasses(active, pinned)} role="listitem" data-active={active || undefined} data-pinned={pinned || undefined}>
              {editing ? (
                <form
                  className="chorus-conversation-rename"
                  onSubmit={event => {
                    event.preventDefault();
                    submitRename(conversation.id);
                  }}
                >
                  <input
                    className="chorus-conversation-rename-input"
                    aria-label={`Rename ${conversation.title}`}
                    value={draftTitle}
                    onChange={event => setDraftTitle(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Escape') cancelRename();
                    }}
                  />
                  <button type="submit" className="chorus-conversation-action">Save</button>
                  <button type="button" className="chorus-conversation-action" onClick={cancelRename}>Cancel</button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="chorus-conversation-select"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => selectConversation?.(conversation.id)}
                  >
                    <span className="chorus-conversation-title">
                      {pinned && <span className="chorus-conversation-pin-indicator" aria-hidden="true">★</span>}
                      {conversation.title}
                    </span>
                    <time className="chorus-conversation-time" dateTime={conversation.updatedAt}>{formatTimestamp(conversation.updatedAt, conversation)}</time>
                  </button>
                  <div className="chorus-conversation-actions">
                    {pinConversation && (
                      <button
                        type="button"
                        className="chorus-conversation-action chorus-conversation-pin"
                        onClick={() => pinConversation(conversation.id, !pinned)}
                        aria-label={`${pinned ? 'Unpin' : 'Pin'} ${conversation.title}`}
                        aria-pressed={pinned}
                      >
                        {pinned ? 'Unpin' : 'Pin'}
                      </button>
                    )}
                    {renameConversation && (
                      <button type="button" className="chorus-conversation-action" onClick={() => startRename(conversation)} aria-label={`Rename ${conversation.title}`}>
                        Rename
                      </button>
                    )}
                    {deleteConversation && (
                      <button type="button" className="chorus-conversation-action" onClick={() => deleteConversation(conversation.id)} aria-label={`Delete ${conversation.title}`}>
                        Delete
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
