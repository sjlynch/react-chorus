import React from 'react';
import { Copy, Pencil, RefreshCw, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import type { Message, MessageFeedback } from '../../types';
import { COPY_FAILED_LABEL, COPY_FEEDBACK_DURATION_MS, canWriteTextToClipboard, writeTextToClipboard } from '../../utils/messageCopy';
import { InlineMessageEditor } from './InlineMessageEditor';
import { useActionEditing } from './renderState';
import { MessageSpeakerLabel } from './speaker';
import type { MessageCopyResult, MessageRenderActions } from './types';

export function actionButtonClass(active?: boolean, extraClass?: string) {
  return ['chorus-action-btn', active && 'chorus-action-btn--active', extraClass].filter(Boolean).join(' ');
}

function hasRenderableActions(actions: MessageRenderActions) {
  return actions.canEdit || actions.canRegenerate || actions.canDelete || Boolean(actions.copy) || Boolean(actions.feedback);
}

export interface MessageActionsProps {
  actions: MessageRenderActions;
  onEditRequested: () => void;
}

export function MessageActions({ actions, onEditRequested }: MessageActionsProps) {
  const initialFeedback = actions.initialFeedback ?? null;
  const [selectedFeedback, setSelectedFeedback] = React.useState<MessageFeedback | null>(initialFeedback);
  const selectedFeedbackRef = React.useRef<MessageFeedback | null>(initialFeedback);
  const [copyFailed, setCopyFailed] = React.useState(false);
  const copyFailureTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasActions = hasRenderableActions(actions);

  React.useEffect(() => {
    selectedFeedbackRef.current = initialFeedback;
    setSelectedFeedback(initialFeedback);
  }, [initialFeedback]);

  React.useEffect(() => () => {
    if (copyFailureTimerRef.current) clearTimeout(copyFailureTimerRef.current);
  }, []);

  if (!hasActions) return null;

  const showCopyFailed = () => {
    if (copyFailureTimerRef.current) clearTimeout(copyFailureTimerRef.current);
    setCopyFailed(true);
    copyFailureTimerRef.current = setTimeout(() => {
      setCopyFailed(false);
      copyFailureTimerRef.current = null;
    }, COPY_FEEDBACK_DURATION_MS);
  };

  const handleCopy = async () => {
    try {
      const copied = await actions.copy?.();
      if (copied === false) showCopyFailed();
    } catch {
      showCopyFailed();
    }
  };

  const handleFeedback = (variant: MessageFeedback) => {
    if (selectedFeedbackRef.current === variant) return;
    selectedFeedbackRef.current = variant;
    setSelectedFeedback(variant);
    actions.feedback?.(variant);
  };

  return (
    <div className="chorus-actions">
      {actions.canEdit && actions.edit && (
        <button type="button" className="chorus-action-btn" onClick={onEditRequested} title="Edit" aria-label="Edit"><Pencil size={13} /></button>
      )}
      {actions.canRegenerate && actions.regenerate && (
        <button type="button" className="chorus-action-btn" onClick={actions.regenerate} title="Regenerate" aria-label="Regenerate"><RefreshCw size={13} /></button>
      )}
      {actions.copy && (
        <button type="button" className={actionButtonClass(copyFailed, copyFailed ? 'chorus-action-btn--copy-failed' : undefined)} onClick={handleCopy} title={copyFailed ? COPY_FAILED_LABEL : 'Copy'} aria-label={copyFailed ? COPY_FAILED_LABEL : 'Copy'}>{copyFailed ? COPY_FAILED_LABEL : <Copy size={13} />}</button>
      )}
      {actions.feedback && (
        <>
          <button type="button" className={actionButtonClass(selectedFeedback === 'up')} onClick={() => handleFeedback('up')} title="Thumbs up" aria-label="Thumbs up" aria-pressed={selectedFeedback === 'up'}><ThumbsUp size={13} /></button>
          <button type="button" className={actionButtonClass(selectedFeedback === 'down')} onClick={() => handleFeedback('down')} title="Thumbs down" aria-label="Thumbs down" aria-pressed={selectedFeedback === 'down'}><ThumbsDown size={13} /></button>
        </>
      )}
      {actions.canDelete && actions.delete && (
        <button type="button" className="chorus-action-btn" onClick={actions.delete} title="Delete" aria-label="Delete"><Trash2 size={13} /></button>
      )}
    </div>
  );
}

export function createCopyAction<TMeta>(message: Message<TMeta>, onCopy?: (message: Message<TMeta>) => MessageCopyResult) {
  if (onCopy) return () => onCopy(message);
  if (canWriteTextToClipboard()) return () => writeTextToClipboard(message.text ?? '');
  return undefined;
}

export function MessageActionControls<TMeta = Record<string, unknown>>({ message, actions }: { message: Message<TMeta>; actions: MessageRenderActions }) {
  const [editing, setEditing] = useActionEditing(message.id);
  const hasActions = hasRenderableActions(actions);

  if (!hasActions) return null;

  if (editing && actions.edit) {
    return (
      <div className={`chorus-msg chorus-${message.role}`} data-chorus-message-id={message.id}>
        <MessageSpeakerLabel role={message.role} />
        <InlineMessageEditor
          initialText={message.text ?? ''}
          onSubmit={(newText) => {
            actions.edit?.(newText);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className={`chorus-render-actions chorus-${message.role}`}>
      <div className="chorus-msg-content">
        <MessageActions actions={actions} onEditRequested={() => setEditing(true)} />
      </div>
    </div>
  );
}
