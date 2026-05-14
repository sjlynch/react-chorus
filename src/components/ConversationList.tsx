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
  palette?: Palette;
  headless?: boolean;
  className?: string;
  style?: React.CSSProperties;
  newConversationLabel?: string;
  emptyLabel?: string;
}

function conversationClasses(active: boolean) {
  return [
    'chorus-conversation-item',
    active ? 'chorus-conversation-item--active' : undefined,
  ].filter(Boolean).join(' ');
}

export function ConversationList({
  conversations,
  activeId = null,
  createConversation,
  selectConversation,
  renameConversation,
  deleteConversation,
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
        {conversations.map(conversation => {
          const active = conversation.id === activeId;
          const editing = conversation.id === editingId;

          return (
            <div key={conversation.id} className={conversationClasses(active)} role="listitem" data-active={active || undefined}>
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
                    <span className="chorus-conversation-title">{conversation.title}</span>
                    <time className="chorus-conversation-time" dateTime={conversation.updatedAt}>{conversation.updatedAt}</time>
                  </button>
                  <div className="chorus-conversation-actions">
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
