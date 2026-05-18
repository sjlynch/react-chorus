import type React from 'react';
import type { ConversationSummary } from '../../hooks/useConversations';
import type { ChorusConversationListLabels } from '../../labels/types';
import { conversationClasses } from './classes';

interface ConversationListItemProps {
  conversation: ConversationSummary;
  active: boolean;
  editing: boolean;
  pinned: boolean;
  pending: boolean;
  disabled: boolean;
  labels: ChorusConversationListLabels;
  formatTime: (timestamp: string, conversation: ConversationSummary) => React.ReactNode;
  selectConversation?: (id: string) => void;
  renameConversation?: (id: string, title: string) => void;
  deleteConversation?: (id: string) => void;
  pinConversation?: (id: string, pinned?: boolean) => void;
  draftTitle: string;
  setDraftTitle: React.Dispatch<React.SetStateAction<string>>;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  isDraftEmpty: boolean;
  startRename: (conversation: ConversationSummary) => void;
  cancelRename: () => void;
  submitRename: (id: string) => void;
  onDelete: (conversation: ConversationSummary) => void;
}

export function ConversationListItem({
  conversation,
  active,
  editing,
  pinned,
  pending,
  disabled,
  labels,
  formatTime,
  selectConversation,
  renameConversation,
  deleteConversation,
  pinConversation,
  draftTitle,
  setDraftTitle,
  renameInputRef,
  isDraftEmpty,
  startRename,
  cancelRename,
  submitRename,
  onDelete,
}: ConversationListItemProps) {
  return (
    <div className={conversationClasses(active, pinned)} role="listitem" data-active={active || undefined} data-pinned={pinned || undefined}>
      {editing ? (
        <form
          className="chorus-conversation-rename"
          onSubmit={event => {
            event.preventDefault();
            submitRename(conversation.id);
          }}
        >
          <input
            ref={renameInputRef}
            className="chorus-conversation-rename-input"
            aria-label={labels.renameAriaLabel(conversation.title)}
            aria-invalid={isDraftEmpty || undefined}
            value={draftTitle}
            onChange={event => setDraftTitle(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') cancelRename();
            }}
          />
          <button
            type="submit"
            className="chorus-conversation-action"
            disabled={isDraftEmpty}
            aria-disabled={isDraftEmpty || undefined}
          >
            {labels.save}
          </button>
          <button type="button" className="chorus-conversation-action" onClick={cancelRename}>{labels.cancel}</button>
        </form>
      ) : (
        <>
          <button
            type="button"
            className="chorus-conversation-select"
            aria-current={active ? 'true' : undefined}
            onClick={() => { if (!disabled) selectConversation?.(conversation.id); }}
            disabled={disabled}
            aria-disabled={disabled || undefined}
          >
            <span className="chorus-conversation-title">
              {pinned && <span className="chorus-conversation-pin-indicator" aria-hidden="true">★</span>}
              {conversation.title}
            </span>
            <time className="chorus-conversation-time" dateTime={conversation.updatedAt}>{formatTime(conversation.updatedAt, conversation)}</time>
          </button>
          <div className="chorus-conversation-actions">
            {pinConversation && (
              <button
                type="button"
                className="chorus-conversation-action chorus-conversation-pin"
                onClick={() => pinConversation(conversation.id, !pinned)}
                aria-label={labels.pinAriaLabel(conversation.title, pinned)}
                aria-pressed={pinned}
                disabled={disabled}
                aria-disabled={disabled || undefined}
              >
                {pinned ? labels.unpin : labels.pin}
              </button>
            )}
            {renameConversation && (
              <button type="button" className="chorus-conversation-action" onClick={() => startRename(conversation)} aria-label={labels.renameAriaLabel(conversation.title)} disabled={disabled} aria-disabled={disabled || undefined}>
                {labels.rename}
              </button>
            )}
            {deleteConversation && (
              <button type="button" className="chorus-conversation-action" onClick={() => onDelete(conversation)} aria-label={labels.deleteAriaLabel(conversation.title)} disabled={disabled || pending} aria-disabled={disabled || pending || undefined}>
                {labels.delete}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
