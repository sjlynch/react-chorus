import React from 'react';
import { ArrowUp, Paperclip } from 'lucide-react';
import type {
  Attachment,
  AttachmentError,
  UploadAttachment,
} from '../types';
import { AttachmentChips } from './chat-input/AttachmentChips';
import { filesFromTransfer, isPendingAttachment, transferHasFiles } from './chat-input/attachmentUtils';
import { useAttachmentQueue } from './chat-input/useAttachmentQueue';

const MAX_HEIGHT = 160;

// Local to keep shared hook/transport utility chunks out of the UI bundle graph.
function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof (value as { then?: unknown }).then === 'function';
}

export interface ChatInputProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value: string;
  onChange: (v: string) => void;
  onSend: (attachments: Attachment[]) => void | boolean | Promise<void | boolean>;
  onStop?: () => void;
  placeholder?: string;
  sending?: boolean;
  /** Disable every composer affordance except Stop while a send is active. */
  disabled?: boolean;
  /** Keep the composer visible but prevent changing text, attachments, or sending. */
  readOnly?: boolean;
  /** Optional explanation surfaced as placeholder/title/description when disabled or read-only. */
  disabledReason?: string;
  /** Increment or change to clear composer attachments and cancel pending file work. */
  resetKey?: unknown;
  accept?: string;
  maxAttachmentBytes?: number;
  maxAttachments?: number;
  onAttachmentError?: (error: AttachmentError) => void;
  uploadAttachment?: UploadAttachment;
}

export const ChatInput = React.forwardRef<HTMLDivElement, ChatInputProps>(function ChatInput({
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
  uploadAttachment,
  className,
  style,
  onPaste: onPasteProp,
  onDragEnter: onDragEnterProp,
  onDragOver: onDragOverProp,
  onDragLeave: onDragLeaveProp,
  onDrop: onDropProp,
  ...rest
}: ChatInputProps, ref) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const reasonId = React.useId();
  const composerInactive = disabled || readOnly;
  const showAttachBtn = accept !== undefined;
  const canIngestFiles = showAttachBtn && !composerInactive;
  const {
    attachments,
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
  } = useAttachmentQueue({
    resetKey,
    accept,
    maxAttachmentBytes,
    maxAttachments,
    onAttachmentError,
    uploadAttachment,
    canIngestFiles,
    composerInactive,
  });

  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
  }, [value]);

  React.useImperativeHandle(ref, () => {
    const root = rootRef.current!;
    const focusTextarea = () => textareaRef.current?.focus();
    try {
      Object.defineProperty(root, 'focus', { value: focusTextarea, configurable: true });
    } catch {
      root.focus = focusTextarea;
    }
    return root;
  });

  const canSend = !composerInactive && (value.trim().length > 0 || hasSendableAttachment) && !hasPendingAttachments;
  const stopAvailable = Boolean(sending && onStop);
  const inactiveReason = disabledReason || (readOnly ? 'Composer is read-only.' : disabled ? 'Composer is disabled.' : undefined);
  const placeholderText = inactiveReason || placeholder || 'Send a message';

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (composerInactive) return;
    onChange(e.target.value);
    resizeTextarea();
  };

  const resetAfterAcceptedSend = () => {
    clearAttachmentsAndPendingWork();
    const el = textareaRef.current;
    if (el) el.style.height = '';
  };

  const handleSend = () => {
    if (!canSend) return;
    const result = onSend(attachments.filter(att => !isPendingAttachment(att)));
    if (result === false) return;
    if (isPromiseLike<void | boolean>(result)) {
      void Promise.resolve(result).then(accepted => {
        if (accepted !== false) resetAfterAcceptedSend();
      }, () => undefined);
      return;
    }
    resetAfterAcceptedSend();
  };

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

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canIngestFiles) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    void handleFiles(e.target.files, 'picker');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!showAttachBtn) return;
    const files = filesFromTransfer(e.clipboardData);
    if (files.length === 0) return;
    if (!canIngestFiles) {
      e.preventDefault();
      return;
    }
    void handleFiles(files, 'paste');
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!showAttachBtn || !transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (!canIngestFiles) return;
    markDragEnter();
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!showAttachBtn || !transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (!canIngestFiles) return;
    e.dataTransfer.dropEffect = 'copy';
    markDragOver();
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!showAttachBtn || !transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (!canIngestFiles) return;
    markDragLeave();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!showAttachBtn || !transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    clearDragState();
    if (!canIngestFiles) return;
    void handleFiles(filesFromTransfer(e.dataTransfer), 'drop');
  };

  const handleRootPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    onPasteProp?.(e);
    if (!e.defaultPrevented) handlePaste(e);
  };

  const handleRootDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    onDragEnterProp?.(e);
    if (!e.defaultPrevented) handleDragEnter(e);
  };

  const handleRootDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    onDragOverProp?.(e);
    if (!e.defaultPrevented) handleDragOver(e);
  };

  const handleRootDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    onDragLeaveProp?.(e);
    if (!e.defaultPrevented) handleDragLeave(e);
  };

  const handleRootDrop = (e: React.DragEvent<HTMLDivElement>) => {
    onDropProp?.(e);
    if (!e.defaultPrevented) handleDrop(e);
  };

  const rootClassName = [
    `chorus-input${draggingFiles ? ' chorus-input--dragging' : ''}`,
    disabled && 'chorus-input--disabled',
    readOnly && 'chorus-input--readonly',
    className,
  ].filter(Boolean).join(' ');

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
      <AttachmentChips attachments={attachments} disabled={composerInactive} onRemove={removeAttachment} />
      <div className={`chorus-input-row${showAttachBtn ? ' chorus-input-row--has-attach' : ''}`}>
        {showAttachBtn && (
          <input ref={fileInputRef} type="file" accept={accept} multiple style={{ display: 'none' }} onChange={onFileInputChange} disabled={!canIngestFiles} />
        )}
        {showAttachBtn && (
          <button type="button" className="chorus-attach" onClick={() => { if (canIngestFiles) fileInputRef.current?.click(); }} aria-label="Attach file" title="Attach file" disabled={!canIngestFiles} aria-disabled={!canIngestFiles}>
            <Paperclip size={18} strokeWidth={2} />
          </button>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          placeholder={placeholderText}
          aria-label={placeholder || 'Send a message'}
          aria-describedby={inactiveReason ? reasonId : undefined}
          disabled={disabled}
          readOnly={readOnly || disabled}
          aria-readonly={readOnly || disabled ? true : undefined}
        />
        <button type="button" className="chorus-send" onClick={handleClick} aria-label={sending ? 'Stop' : 'Send'} title={sending ? 'Stop' : 'Send'} disabled={sending ? !stopAvailable : !canSend}>
          {sending ? <span className="chorus-stop-fill" /> : <ArrowUp size={18} strokeWidth={2} />}
        </button>
      </div>
    </div>
  );
});
