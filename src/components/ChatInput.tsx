import React from 'react';
import { ArrowUp, Paperclip } from 'lucide-react';
import { DEFAULT_COMPOSER_LABELS } from '../labels/composer';
import { DEFAULT_ATTACHMENT_LABELS } from '../labels/attachments';
import { AttachmentChips } from './chat-input/AttachmentChips';
import { AttachmentErrorRegion } from './chat-input/AttachmentErrorRegion';
import { useAttachmentQueue } from './chat-input/useAttachmentQueue';
import { useChatInputSend } from './chat-input/useChatInputSend';
import { useComposerTextarea } from './chat-input/useComposerTextarea';
import { useFileIngestionHandlers } from './chat-input/useFileIngestionHandlers';
import type { ChatInputHandle, ChatInputProps } from './chat-input/types';

export type { ChatInputFocusOptions, ChatInputHandle, ChatInputProps, RenderAttachmentErrorContext } from './chat-input/types';

export const ChatInput = React.forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  placeholder,
  sending,
  disabled = false,
  readOnly = false,
  disabledReason,
  resetKey,
  accept,
  maxAttachmentBytes,
  maxAttachments,
  onAttachmentError,
  renderAttachmentError,
  uploadAttachment,
  labels = DEFAULT_COMPOSER_LABELS,
  attachmentLabels = DEFAULT_ATTACHMENT_LABELS,
  className,
  style,
  onPaste: onPasteProp,
  onDragEnter: onDragEnterProp,
  onDragOver: onDragOverProp,
  onDragLeave: onDragLeaveProp,
  onDrop: onDropProp,
  ...rest
}: ChatInputProps, ref) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const reasonId = React.useId();
  const composerInactive = disabled || readOnly;
  const showAttachBtn = accept !== undefined;
  const canIngestFiles = showAttachBtn && !composerInactive;
  const {
    rootRef,
    textareaRef,
    handleTextareaChange,
    resetTextareaHeight,
  } = useComposerTextarea({
    value,
    onChange,
    composerInactive,
    forwardedRef: ref,
  });
  const {
    attachments,
    attachmentError,
    announcement,
    dismissAttachmentError,
    draggingFiles,
    hasPendingAttachments,
    hasSendableAttachment,
    clearAttachmentsAndPendingWork,
    clearDragState,
    handleFiles,
    markDragEnter,
    markDragLeave,
    markDragOver,
    removeAttachment,
    updateAttachmentAlt,
  } = useAttachmentQueue({
    resetKey,
    accept,
    maxAttachmentBytes,
    maxAttachments,
    onAttachmentError,
    renderAttachmentError,
    uploadAttachment,
    canIngestFiles,
    composerInactive,
    labels: attachmentLabels,
  });

  const canSend = !composerInactive && (value.trim().length > 0 || hasSendableAttachment) && !hasPendingAttachments;
  const stopAvailable = Boolean(sending && onStop);
  const inactiveReason = disabledReason || (readOnly ? labels.readOnlyReason : disabled ? labels.disabledReason : undefined);
  const placeholderText = inactiveReason || placeholder || labels.placeholder;
  const textareaAriaLabel = placeholder || labels.ariaLabel;
  const sendActionLabel = sending ? labels.stop : labels.send;

  const resetAfterAcceptedSend = () => {
    clearAttachmentsAndPendingWork();
    resetTextareaHeight();
  };

  const { handleSend } = useChatInputSend({
    attachments,
    canSend,
    onSend,
    onAcceptedSend: resetAfterAcceptedSend,
  });

  const {
    onFileInputChange,
    handleRootPaste,
    handleRootDragEnter,
    handleRootDragOver,
    handleRootDragLeave,
    handleRootDrop,
  } = useFileIngestionHandlers({
    showAttachBtn,
    canIngestFiles,
    fileInputRef,
    handleFiles,
    clearDragState,
    markDragEnter,
    markDragLeave,
    markDragOver,
    onPaste: onPasteProp,
    onDragEnter: onDragEnterProp,
    onDragOver: onDragOverProp,
    onDragLeave: onDragLeaveProp,
    onDrop: onDropProp,
  });

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sending && canSend) handleSend();
    }
  };

  const handleClick = () => {
    if (sending) {
      onStop?.();
    } else if (canSend) {
      handleSend();
    }
  };

  const rootClassName = [
    `chorus-input${draggingFiles ? ' chorus-input--dragging' : ''}`,
    disabled && 'chorus-input--disabled',
    readOnly && 'chorus-input--readonly',
    className,
  ].filter(Boolean).join(' ');

  const attachmentErrorNode = attachmentError && renderAttachmentError !== null
    ? (renderAttachmentError
      ? renderAttachmentError({ error: attachmentError, dismiss: dismissAttachmentError })
      : (
        <AttachmentErrorRegion
          error={attachmentError}
          labels={attachmentLabels}
          onDismiss={dismissAttachmentError}
        />
      ))
    : null;

  return (
    <div
      {...rest}
      ref={rootRef}
      className={rootClassName}
      style={style}
      onPaste={handleRootPaste}
      onDragEnter={handleRootDragEnter}
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
      aria-disabled={composerInactive ? true : rest['aria-disabled']}
      title={inactiveReason ?? rest.title}
    >
      {inactiveReason && <span id={reasonId} className="chorus-sr-only">{inactiveReason}</span>}
      <AttachmentChips
        attachments={attachments}
        disabled={composerInactive}
        onRemove={removeAttachment}
        labels={attachmentLabels}
        onAltChange={canIngestFiles ? updateAttachmentAlt : undefined}
      />
      <span
        className="chorus-sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="chorus-attachment-announcer"
      >
        {announcement?.message ?? ''}
      </span>
      {attachmentErrorNode}
      <div className={`chorus-input-row${showAttachBtn ? ' chorus-input-row--has-attach' : ''}`}>
        {showAttachBtn && (
          <input ref={fileInputRef} type="file" accept={accept} multiple style={{ display: 'none' }} onChange={onFileInputChange} disabled={!canIngestFiles} />
        )}
        {showAttachBtn && (
          <button type="button" className="chorus-attach" onClick={() => { if (canIngestFiles) fileInputRef.current?.click(); }} aria-label={labels.attachFile} title={labels.attachFile} disabled={!canIngestFiles} aria-disabled={!canIngestFiles}>
            <Paperclip size={18} strokeWidth={2} />
          </button>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleTextareaChange}
          onKeyDown={onKeyDown}
          placeholder={placeholderText}
          aria-label={textareaAriaLabel}
          aria-describedby={inactiveReason ? reasonId : undefined}
          disabled={disabled}
          readOnly={readOnly || disabled}
          aria-readonly={readOnly || disabled ? true : undefined}
        />
        <button type="button" className="chorus-send" onClick={handleClick} aria-label={sendActionLabel} title={sendActionLabel} disabled={sending ? !stopAvailable : !canSend}>
          {sending ? <span className="chorus-stop-fill" /> : <ArrowUp size={18} strokeWidth={2} />}
        </button>
      </div>
    </div>
  );
});
