import React from 'react';
import { DEFAULT_COMPOSER_LABELS } from '../labels/composer';
import { DEFAULT_ATTACHMENT_LABELS } from '../labels/attachments';
import { AttachmentSection } from './chat-input/AttachmentSection';
import { ComposerInputRow } from './chat-input/ComposerInputRow';
import { DropOverlayPortal } from './chat-input/DropOverlayPortal';
import { useAttachmentQueue } from './chat-input/useAttachmentQueue';
import { useChatInputSend } from './chat-input/useChatInputSend';
import { useComposerTextarea } from './chat-input/useComposerTextarea';
import { useFileIngestionHandlers } from './chat-input/useFileIngestionHandlers';
import type { ChatInputHandle, ChatInputProps } from './chat-input/types';
import { joinClasses } from '../utils/className';
import { styleVarsFromPalette } from '../utils/paletteVars';

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
  palette,
  className,
  style,
  onPaste: onPasteProp,
  onDragEnter: onDragEnterProp,
  onDragOver: onDragOverProp,
  onDragLeave: onDragLeaveProp,
  onDrop: onDropProp,
  // `aria-disabled` and `title` are pulled out of `...rest` because the composer
  // derives its own values for them (from `disabled`/`readOnly`/`disabledReason`).
  // Leaving them in `rest` would spread a host value that the explicit attribute
  // below then immediately overrides — a confusing double-apply. A host value is
  // still honoured: it is used as the fallback when the composer is active.
  'aria-disabled': ariaDisabledProp,
  title: titleProp,
  ...rest
}: ChatInputProps, ref) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const reasonId = React.useId();
  const composerInactive = disabled || readOnly;
  // An empty / whitespace-only `accept` means "no attachments allowed" — treat
  // it the same as omitting `accept` rather than presenting an unfiltered picker.
  const showAttachBtn = typeof accept === 'string' && accept.trim().length > 0;
  const canIngestFiles = showAttachBtn && !composerInactive;
  const {
    rootRef,
    textareaRef,
    handleTextareaChange,
    handleCompositionStart,
    handleCompositionEnd,
    isComposingRef,
    composerGenerationRef,
    resetTextareaHeight,
  } = useComposerTextarea({
    value,
    onChange,
    composerInactive,
    forwardedRef: ref,
  });
  const {
    queuedAttachments,
    sendableAttachments,
    attachmentError,
    announcement,
    dismissAttachmentError,
    draggingFiles,
    hasPendingAttachments,
    hasSendableAttachment,
    clearAttachmentsAndPendingWork,
    clearDragState,
    handleFiles,
    surfaceDrag,
    composerDrag,
    removeAttachment,
    updateAttachmentAlt,
    retryAttachment,
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
    attachments: sendableAttachments,
    canSend,
    onSend,
    onAcceptedSend: resetAfterAcceptedSend,
    composerGenerationRef,
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
    rootRef,
    handleFiles,
    clearDragState,
    surfaceDrag,
    composerDrag,
    onPaste: onPasteProp,
    onDragEnter: onDragEnterProp,
    onDragOver: onDragOverProp,
    onDragLeave: onDragLeaveProp,
    onDrop: onDropProp,
  });

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    // Let the IME consume Enter while a composition is active (CJK / accented
    // input) instead of sending a half-composed message.
    if (isComposingRef.current || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (!sending && canSend) handleSend();
  };

  const handleClick = () => {
    if (sending) {
      onStop?.();
    } else if (canSend) {
      handleSend();
    }
  };

  const rootClassName = joinClasses(
    'chorus-input',
    draggingFiles && 'chorus-input--dragging',
    disabled && 'chorus-input--disabled',
    readOnly && 'chorus-input--readonly',
    className,
  );

  const paletteVars = React.useMemo(() => styleVarsFromPalette(palette), [palette]);

  return (
    <div
      // Any unrecognised props (`...rest`) — including event handlers such as
      // `onKeyDown` — attach to this root container, NOT the inner textarea.
      // The composer's own Enter-to-send `onKeyDown` lives on the textarea and
      // calls preventDefault(), so a host `onKeyDown` passed via `rest` will not
      // observe the textarea key events the composer consumes (notably Enter).
      {...rest}
      ref={rootRef}
      className={rootClassName}
      style={{ ...paletteVars, ...style }}
      onPaste={handleRootPaste}
      onDragEnter={handleRootDragEnter}
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
      aria-disabled={composerInactive ? true : ariaDisabledProp}
      title={inactiveReason ?? titleProp}
    >
      {inactiveReason && <span id={reasonId} className="chorus-sr-only">{inactiveReason}</span>}
      <AttachmentSection
        attachments={queuedAttachments}
        composerInactive={composerInactive}
        canIngestFiles={canIngestFiles}
        labels={attachmentLabels}
        onRemove={removeAttachment}
        onRetry={retryAttachment}
        onAltChange={updateAttachmentAlt}
        announcement={announcement}
        attachmentError={attachmentError}
        renderAttachmentError={renderAttachmentError}
        dismissAttachmentError={dismissAttachmentError}
      />
      <ComposerInputRow
        showAttachBtn={showAttachBtn}
        canIngestFiles={canIngestFiles}
        accept={accept}
        attachFileLabel={labels.attachFile}
        fileInputRef={fileInputRef}
        onFileInputChange={onFileInputChange}
        textareaRef={textareaRef}
        value={value}
        onTextareaChange={handleTextareaChange}
        onKeyDown={onKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        placeholder={placeholderText}
        textareaAriaLabel={textareaAriaLabel}
        reasonId={reasonId}
        hasInactiveReason={Boolean(inactiveReason)}
        disabled={disabled}
        readOnly={readOnly}
        onSendClick={handleClick}
        sendActionLabel={sendActionLabel}
        sending={sending}
        stopAvailable={stopAvailable}
        canSend={canSend}
      />
      <DropOverlayPortal
        active={draggingFiles && canIngestFiles}
        label={labels.dropToAttach}
        rootRef={rootRef}
      />
    </div>
  );
});
