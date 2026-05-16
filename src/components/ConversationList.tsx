import React from 'react';
import type { ConversationSummary } from '../hooks/useConversations';
import { styleVarsFromPalette, type Palette } from './ChorusTheme';

export interface ConfirmDeleteConversationContext {
  conversation: ConversationSummary;
  conversations: ConversationSummary[];
  activeId: string | null;
}

export type ConfirmDeleteConversation = (context: ConfirmDeleteConversationContext) => boolean | void | Promise<boolean | void>;

export interface ConversationListProps {
  conversations: ConversationSummary[];
  activeId?: string | null;
  createConversation?: (title?: string) => string | void;
  selectConversation?: (id: string) => void;
  renameConversation?: (id: string, title: string) => void;
  deleteConversation?: (id: string) => void;
  /** Optional gate for built-in conversation deletes. Return or resolve false to cancel. */
  confirmDeleteConversation?: ConfirmDeleteConversation;
  pinConversation?: (id: string, pinned?: boolean) => void;
  /** Disable conversation mutations while async conversation storage is loading. */
  loaded?: boolean;
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

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof (value as { then?: unknown }).then === 'function';
}

function isConversationListDevMode() {
  // Kept local so the standalone ConversationList chunk does not import hook/widget chunks.
  try {
    return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

function warnDeleteConfirmationError(callbackName: string, error: unknown) {
  if (!isConversationListDevMode()) return;
  console.warn(`[Chorus] \`${callbackName}\` callback threw/rejected; delete was cancelled.`, error);
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
  confirmDeleteConversation,
  pinConversation,
  loaded = true,
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
  const [pendingDeleteIds, setPendingDeleteIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const mountedRef = React.useRef(true);
  const paletteVars = React.useMemo(() => (headless ? {} : styleVarsFromPalette(palette)), [headless, palette]);
  const orderedConversations = React.useMemo(() => sortedConversations(conversations), [conversations]);
  const interactionsDisabled = !loaded;
  const rootClassName = [
    'chorus-conversation-list',
    headless ? 'chorus-conversation-list--headless' : undefined,
    interactionsDisabled ? 'chorus-conversation-list--loading' : undefined,
    className,
  ].filter(Boolean).join(' ');

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setDeletePending = React.useCallback((id: string, pending: boolean) => {
    if (!mountedRef.current) return;
    setPendingDeleteIds(prev => {
      const next = new Set(prev);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

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

  const handleDeleteConversation = React.useCallback((conversation: ConversationSummary) => {
    if (!deleteConversation || interactionsDisabled || pendingDeleteIds.has(conversation.id)) return;

    const commitDelete = () => deleteConversation(conversation.id);
    let confirmation: boolean | void | Promise<boolean | void>;
    try {
      confirmation = confirmDeleteConversation?.({ conversation, conversations: conversations.slice(), activeId });
    } catch (error) {
      warnDeleteConfirmationError('confirmDeleteConversation', error);
      return;
    }

    if (isPromiseLike<boolean | void>(confirmation)) {
      setDeletePending(conversation.id, true);
      Promise.resolve(confirmation)
        .then(confirmed => {
          if (confirmed === false) return;
          commitDelete();
        })
        .catch(error => warnDeleteConfirmationError('confirmDeleteConversation', error))
        .finally(() => setDeletePending(conversation.id, false));
      return;
    }

    if (confirmation === false) return;
    commitDelete();
  }, [activeId, confirmDeleteConversation, conversations, deleteConversation, interactionsDisabled, pendingDeleteIds, setDeletePending]);

  return (
    <nav className={rootClassName} style={{ ...paletteVars, ...style }} aria-label="Conversations">
      {createConversation && (
        <button type="button" className="chorus-conversation-new" onClick={() => createConversation()} disabled={interactionsDisabled} aria-disabled={interactionsDisabled || undefined}>
          {newConversationLabel}
        </button>
      )}

      <div className="chorus-conversation-items" role="list">
        {conversations.length === 0 && <div className="chorus-conversation-empty">{emptyLabel}</div>}
        {orderedConversations.map(conversation => {
          const active = conversation.id === activeId;
          const editing = conversation.id === editingId;
          const pinned = Boolean(conversation.pinned);
          const deletePending = pendingDeleteIds.has(conversation.id);

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
                    onClick={() => { if (!interactionsDisabled) selectConversation?.(conversation.id); }}
                    disabled={interactionsDisabled}
                    aria-disabled={interactionsDisabled || undefined}
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
                        disabled={interactionsDisabled}
                        aria-disabled={interactionsDisabled || undefined}
                      >
                        {pinned ? 'Unpin' : 'Pin'}
                      </button>
                    )}
                    {renameConversation && (
                      <button type="button" className="chorus-conversation-action" onClick={() => startRename(conversation)} aria-label={`Rename ${conversation.title}`} disabled={interactionsDisabled} aria-disabled={interactionsDisabled || undefined}>
                        Rename
                      </button>
                    )}
                    {deleteConversation && (
                      <button type="button" className="chorus-conversation-action" onClick={() => handleDeleteConversation(conversation)} aria-label={`Delete ${conversation.title}`} disabled={interactionsDisabled || deletePending} aria-disabled={interactionsDisabled || deletePending || undefined}>
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
