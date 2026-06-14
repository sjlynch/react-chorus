import React from 'react';
import { Copy, Pencil, RefreshCw, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import type { Message, MessageFeedback } from '../../types';
import { DEFAULT_MESSAGE_ACTION_LABELS } from '../../labels/messageActions';
import { formatMessageForClipboard } from '../../hooks/transcriptFormatters';
import type { ChorusMessageActionLabels, ChorusSpeakerLabels } from '../../labels/types';
import { canWriteTextToClipboard, writeTextToClipboard } from '../../utils/messageCopy';
import { joinClasses } from '../../utils/className';
import { InlineMessageEditor } from './InlineMessageEditor';
import { useActionEditing, useReturnFocusAfterEditing } from './renderState';
import { useCopyFeedback } from './useCopyFeedback';
import { MessageSpeakerLabel } from './speaker';
import type { MessageCopyResult, MessageRenderActions } from './types';

export function actionButtonClass(active?: boolean, extraClass?: string) {
  return joinClasses('chorus-action-btn', active && 'chorus-action-btn--active', extraClass);
}

function hasRenderableActions(actions: MessageRenderActions) {
  // Read-only feedback only counts as renderable when there is a recorded
  // reaction to show — an empty inert thumb is nothing worth a row.
  const hasReadOnlyFeedback = Boolean(actions.feedbackReadOnly && actions.initialFeedback);
  return actions.canEdit || actions.canRegenerate || actions.canDelete || Boolean(actions.copy) || Boolean(actions.feedback) || hasReadOnlyFeedback;
}

export interface MessageActionsProps {
  actions: MessageRenderActions;
  onEditRequested: () => void;
  labels?: ChorusMessageActionLabels;
  editButtonRef?: React.Ref<HTMLButtonElement>;
}

export function MessageActions({ actions, onEditRequested, labels = DEFAULT_MESSAGE_ACTION_LABELS, editButtonRef }: MessageActionsProps) {
  const initialFeedback = actions.initialFeedback ?? null;
  const [selectedFeedback, setSelectedFeedback] = React.useState<MessageFeedback | null>(initialFeedback);
  const selectedFeedbackRef = React.useRef<MessageFeedback | null>(initialFeedback);
  const { copyFailed, showCopyFailed, copyLabel } = useCopyFeedback(labels);
  const hasActions = hasRenderableActions(actions);

  React.useEffect(() => {
    selectedFeedbackRef.current = initialFeedback;
    setSelectedFeedback(initialFeedback);
  }, [initialFeedback]);

  if (!hasActions) return null;

  const handleCopy = async () => {
    try {
      const copied = await actions.copy?.();
      if (copied === false) showCopyFailed();
    } catch {
      showCopyFailed();
    }
  };

  const handleFeedback = (variant: MessageFeedback) => {
    // Clicking the already-active thumb toggles feedback back off so a
    // mis-click can be undone without forcing the opposite rating.
    const next = selectedFeedbackRef.current === variant ? null : variant;
    selectedFeedbackRef.current = next;
    setSelectedFeedback(next);
    actions.feedback?.(next);
  };

  return (
    <div className="chorus-actions">
      {actions.canEdit && actions.edit && (
        <button ref={editButtonRef} type="button" className="chorus-action-btn" onClick={onEditRequested} title={labels.edit} aria-label={labels.edit}><Pencil size={13} /></button>
      )}
      {actions.canRegenerate && actions.regenerate && (
        <button type="button" className="chorus-action-btn" onClick={actions.regenerate} title={labels.regenerate} aria-label={labels.regenerate}><RefreshCw size={13} /></button>
      )}
      {actions.copy && (
        <button type="button" className={actionButtonClass(copyFailed, copyFailed ? 'chorus-action-btn--copy-failed' : undefined)} onClick={handleCopy} title={copyLabel} aria-label={copyLabel}>{copyFailed ? labels.copyFailed : <Copy size={13} />}</button>
      )}
      {actions.feedback ? (
        <>
          <button type="button" className={actionButtonClass(selectedFeedback === 'up')} onClick={() => handleFeedback('up')} title={labels.thumbsUp} aria-label={labels.thumbsUp} aria-pressed={selectedFeedback === 'up'}><ThumbsUp size={13} /></button>
          <button type="button" className={actionButtonClass(selectedFeedback === 'down')} onClick={() => handleFeedback('down')} title={labels.thumbsDown} aria-label={labels.thumbsDown} aria-pressed={selectedFeedback === 'down'}><ThumbsDown size={13} /></button>
        </>
      ) : actions.feedbackReadOnly && selectedFeedback ? (
        // Read-only mode: surface the recorded reaction as an inert indicator
        // (no button, no feedback wiring) so historical feedback stays visible.
        <span
          className={actionButtonClass(true, 'chorus-action-btn--readonly')}
          role="img"
          aria-label={selectedFeedback === 'up' ? labels.thumbsUp : labels.thumbsDown}
          title={selectedFeedback === 'up' ? labels.thumbsUp : labels.thumbsDown}
        >
          {selectedFeedback === 'up' ? <ThumbsUp size={13} /> : <ThumbsDown size={13} />}
        </span>
      ) : null}
      {actions.canDelete && actions.delete && (
        <button type="button" className="chorus-action-btn" onClick={actions.delete} title={labels.delete} aria-label={labels.delete}><Trash2 size={13} /></button>
      )}
      {/* Polite live region: a Copy-button label change on an already-rendered,
          non-focused button is not announced, so mirror the code-block
          `chorus-copy-status` pattern and surface copy failures here. The text
          is written and cleared on the same timer that drives `copyFailed`. */}
      <span className="chorus-sr-only" role="status" aria-live="polite">{copyFailed ? labels.copyFailed : ''}</span>
    </div>
  );
}

export function createCopyAction<TMeta>(message: Message<TMeta>, onCopy?: (message: Message<TMeta>) => MessageCopyResult) {
  if (onCopy) return () => onCopy(message);
  if (canWriteTextToClipboard()) return () => writeTextToClipboard(formatMessageForClipboard(message));
  return undefined;
}

export interface MessageActionControlsProps<TMeta> {
  message: Message<TMeta>;
  actions: MessageRenderActions;
  labels?: ChorusMessageActionLabels;
  speakerLabels?: ChorusSpeakerLabels;
}

export function MessageActionControls<TMeta = Record<string, unknown>>({ message, actions, labels = DEFAULT_MESSAGE_ACTION_LABELS, speakerLabels }: MessageActionControlsProps<TMeta>) {
  const [editing, setEditing] = useActionEditing(message.id);
  const editButtonRef = useReturnFocusAfterEditing<HTMLButtonElement>(editing);
  const hasActions = hasRenderableActions(actions);

  if (!hasActions) return null;

  if (editing && actions.edit) {
    // No `data-chorus-message-id` here: the row root / MessageBubble already
    // carry it, and a second live element with the same id would surface as a
    // duplicate to host code querying `[data-chorus-message-id]`.
    return (
      <div className={`chorus-msg chorus-${message.role}`}>
        <MessageSpeakerLabel role={message.role} speakers={speakerLabels} speaker={message.speaker} />
        <InlineMessageEditor
          initialText={message.text ?? ''}
          onSubmit={(newText) => {
            actions.edit?.(newText);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          labels={labels}
        />
      </div>
    );
  }

  return (
    <div className={`chorus-render-actions chorus-${message.role}`}>
      <div className="chorus-msg-content">
        <MessageActions actions={actions} onEditRequested={() => setEditing(true)} labels={labels} editButtonRef={editButtonRef} />
      </div>
    </div>
  );
}
