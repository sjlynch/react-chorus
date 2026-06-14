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
import type { ChatInputHandle, ChatInputProps, ChatInputSlashCommand } from './chat-input/types';
import { joinClasses } from '../utils/className';
import { styleVarsFromPalette } from '../utils/paletteVars';

export type { ChatInputFocusOptions, ChatInputHandle, ChatInputModelPicker, ChatInputProps, ChatInputSlashCommand, RenderAttachmentErrorContext } from './chat-input/types';

// Inlined dev-mode gate + once-guard for the host-`onKeyDown` warning below.
// Importing the shared `utils/devMode`/`utils/warnings` helper here would drag
// the `dev-mode` chunk into the `chat-input` bundle graph; `ChatWindow.tsx` and
// `chat-window/rendering.tsx` inline the same gate for the same reason — see
// `src/utils/CLAUDE.md`.
function isChorusDevMode() {
  try {
    return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

let didWarnHostOnKeyDown = false;

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
  slashCommands = [],
  onSlashCommand,
  resourceAttachments = [],
  modelPicker,
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
    addReadyAttachment,
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

  const trimmedValue = value.trim();
  const filteredSlashCommands = React.useMemo(() => {
    if (!trimmedValue.startsWith('/') || slashCommands.length === 0) return [];
    return slashCommands.filter(command => command.name.toLowerCase().startsWith(trimmedValue.toLowerCase()));
  }, [slashCommands, trimmedValue]);
  // A command matches when the draft is exactly the command name OR the command
  // name followed by a space and arguments (`/srv:prompt key=value`). The whole
  // trimmed draft is forwarded to `onSlashCommand` so argument-taking commands
  // (e.g. MCP prompts) receive their `key=value` pairs.
  const exactSlashCommand = React.useMemo(() => (
    slashCommands.find(command => (
      command.name === trimmedValue || trimmedValue.startsWith(`${command.name} `)
    ))
  ), [slashCommands, trimmedValue]);
  const canSend = !composerInactive && (trimmedValue.length > 0 || hasSendableAttachment) && !hasPendingAttachments;
  const stopAvailable = Boolean(sending && onStop);
  const inactiveReason = disabledReason || (readOnly ? labels.readOnlyReason : disabled ? labels.disabledReason : undefined);
  const placeholderText = inactiveReason || placeholder || labels.placeholder;
  const textareaAriaLabel = placeholder || labels.ariaLabel;
  // Only advertise "Stop" when there is an `onStop` to action. A host that
  // streams without `onStop` keeps the accurate Send label/icon (a disabled
  // "Send" while `sending`) rather than presenting an inert "Stop" button.
  const sendActionLabel = stopAvailable ? labels.stop : labels.send;

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

  const runSlashCommand = React.useCallback((commandName: string) => {
    if (!onSlashCommand || composerInactive) return false;
    void onSlashCommand(commandName);
    return true;
  }, [composerInactive, onSlashCommand]);

  // Choosing a command from the palette. A command that requires arguments is
  // not run immediately — instead the draft is prefilled with the command name
  // and a trailing space so the user can type `key=value` arguments (the
  // command description advertises which ones). Argument-free commands run as
  // before.
  const selectSlashCommand = React.useCallback((command: ChatInputSlashCommand) => {
    if (composerInactive) return;
    if (command.requiresArguments) {
      onChange(`${command.name} `);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const caret = el.value.length;
        el.selectionStart = caret;
        el.selectionEnd = caret;
      });
      return;
    }
    runSlashCommand(command.name);
  }, [composerInactive, onChange, runSlashCommand, textareaRef]);

  const handleResourceAttachmentChange = React.useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const index = Number(e.currentTarget.value);
    e.currentTarget.value = '';
    const attachment = Number.isInteger(index) ? resourceAttachments[index] : undefined;
    if (!attachment || composerInactive) return;
    addReadyAttachment(attachment);
  }, [addReadyAttachment, composerInactive, resourceAttachments]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    // Let the IME consume Enter while a composition is active (CJK / accented
    // input) instead of sending a half-composed message.
    if (isComposingRef.current || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (!sending && exactSlashCommand && runSlashCommand(trimmedValue)) return;
    if (!sending && canSend) handleSend();
  };

  const handleClick = () => {
    if (sending) {
      onStop?.();
    } else if (exactSlashCommand && runSlashCommand(trimmedValue)) {
      return;
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

  // A host `onKeyDown` lands in `...rest` and is spread onto the root container
  // below, not the textarea — so it never sees the keys the composer's own
  // textarea handler consumes (notably Enter, which is `preventDefault()`d).
  // That is a documented but easily-missed footgun for hosts wiring keyboard
  // shortcuts, so flag it once in dev (mirrors the `showSystemMessages` and
  // non-host-message-root warnings elsewhere in this codebase).
  const hasHostOnKeyDown = 'onKeyDown' in rest;
  React.useEffect(() => {
    if (!hasHostOnKeyDown || didWarnHostOnKeyDown || !isChorusDevMode()) return;
    didWarnHostOnKeyDown = true;
    console.warn(
      '[Chorus] `onKeyDown` passed to `<ChatInput>` is attached to the composer container `<div>`, '
        + 'not the inner `<textarea>`. The textarea has its own Enter-to-send handler that calls '
        + '`preventDefault()`, so this handler will not observe Enter — nor other keys the composer '
        + 'consumes. To handle textarea keystrokes such as slash-commands or up-arrow-to-edit, compose '
        + 'a custom shell from the headless pieces or attach a capture-phase listener to the textarea.',
    );
  }, [hasHostOnKeyDown]);

  return (
    <div
      // Any unrecognised props (`...rest`) — including event handlers such as
      // `onKeyDown` — attach to this root container, NOT the inner textarea.
      // The composer's own Enter-to-send `onKeyDown` lives on the textarea and
      // calls preventDefault(), so a host `onKeyDown` passed via `rest` will not
      // observe the textarea key events the composer consumes (notably Enter).
      // A one-time dev-mode `console.warn` (above) flags this when a host wires
      // `onKeyDown`.
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
        resourceAttachments={resourceAttachments}
        onResourceAttachmentChange={handleResourceAttachmentChange}
        canAttachResource={resourceAttachments.length > 0 && !composerInactive}
        attachResourceLabel={labels.attachResource}
        resourcePickerPlaceholder={labels.resourcePickerPlaceholder}
        modelPickerFallbackLabel={labels.modelPicker}
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
        modelPicker={modelPicker}
      />
      {filteredSlashCommands.length > 0 && !composerInactive && (
        <div className="chorus-slash-palette" role="listbox" aria-label={labels.slashCommands}>
          {filteredSlashCommands.map(command => (
            <button
              key={command.name}
              type="button"
              className="chorus-slash-command"
              onClick={() => selectSlashCommand(command)}
              role="option"
            >
              <span className="chorus-slash-command-name">{command.name}</span>
              {command.description && <span className="chorus-slash-command-description">{command.description}</span>}
            </button>
          ))}
        </div>
      )}
      <DropOverlayPortal
        active={draggingFiles && canIngestFiles}
        label={labels.dropToAttach}
        rootRef={rootRef}
      />
    </div>
  );
});
