import React from 'react';
import { createPortal } from 'react-dom';
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
    markDragEnter,
    markDragLeave,
    markDragOver,
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

  const rootClassName = [
    `chorus-input${draggingFiles ? ' chorus-input--dragging' : ''}`,
    disabled && 'chorus-input--disabled',
    readOnly && 'chorus-input--readonly',
    className,
  ].filter(Boolean).join(' ');

  const paletteVars = React.useMemo(() => styleVarsFromPalette(palette), [palette]);

  // The "Drop to attach" overlay must blanket the whole widget so it always
  // renders under the cursor — `useChatSurfaceFileDrop` also accepts file drops
  // over the transcript, far above the composer. Portal it onto the surrounding
  // `.chorus` surface when one exists; a standalone ChatInput (no surface) keeps
  // the overlay inside its own composer-sized root. Resolved once on mount: the
  // `.chorus` ancestor of a mounted ChatInput does not change.
  const [dropOverlayHost, setDropOverlayHost] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    setDropOverlayHost(rootRef.current?.closest<HTMLElement>('.chorus') ?? null);
  }, [rootRef]);

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

  const dropOverlay = draggingFiles && canIngestFiles ? (
    <div className="chorus-drop-overlay" aria-hidden="true">
      <span className="chorus-drop-overlay-label">{labels.dropToAttach}</span>
    </div>
  ) : null;

  const root = (
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
      <AttachmentChips
        attachments={queuedAttachments}
        disabled={composerInactive}
        onRemove={removeAttachment}
        onRetry={retryAttachment}
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
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          placeholder={placeholderText}
          aria-label={textareaAriaLabel}
          aria-describedby={inactiveReason ? reasonId : undefined}
          disabled={disabled}
          readOnly={readOnly || disabled}
          // A natively disabled control must not also advertise aria-readonly:
          // the two ARIA states are mutually exclusive, so only expose it for
          // a purely read-only (not disabled) textarea.
          aria-readonly={readOnly && !disabled ? true : undefined}
        />
        <button type="button" className="chorus-send" onClick={handleClick} aria-label={sendActionLabel} title={sendActionLabel} disabled={sending ? !stopAvailable : !canSend}>
          {sending ? <span className="chorus-stop-fill" /> : <ArrowUp size={18} strokeWidth={2} />}
        </button>
      </div>
      {dropOverlay && !dropOverlayHost && dropOverlay}
    </div>
  );

  return dropOverlay && dropOverlayHost
    ? <>{root}{createPortal(dropOverlay, dropOverlayHost)}</>
    : root;
});
