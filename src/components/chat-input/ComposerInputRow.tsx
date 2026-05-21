import type React from 'react';
import { ArrowUp, Paperclip } from 'lucide-react';
import { joinClasses } from '../../utils/className';

interface ComposerInputRowProps {
  // Attach button + hidden file input.
  showAttachBtn: boolean;
  canIngestFiles: boolean;
  accept?: string;
  attachFileLabel: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  // Textarea.
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onTextareaChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  placeholder: string;
  textareaAriaLabel: string;
  reasonId: string;
  /** Whether a disabled/read-only reason exists (drives `aria-describedby`). */
  hasInactiveReason: boolean;
  disabled: boolean;
  readOnly: boolean;
  // Send / stop button.
  onSendClick: () => void;
  sendActionLabel: string;
  sending?: boolean;
  stopAvailable: boolean;
  canSend: boolean;
}

/**
 * The composer input row: optional file picker + attach button, the textarea,
 * and the send/stop button.
 */
export function ComposerInputRow({
  showAttachBtn,
  canIngestFiles,
  accept,
  attachFileLabel,
  fileInputRef,
  onFileInputChange,
  textareaRef,
  value,
  onTextareaChange,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  placeholder,
  textareaAriaLabel,
  reasonId,
  hasInactiveReason,
  disabled,
  readOnly,
  onSendClick,
  sendActionLabel,
  sending,
  stopAvailable,
  canSend,
}: ComposerInputRowProps) {
  return (
    <div className={joinClasses('chorus-input-row', showAttachBtn && 'chorus-input-row--has-attach')}>
      {showAttachBtn && (
        <input ref={fileInputRef} type="file" accept={accept} multiple style={{ display: 'none' }} onChange={onFileInputChange} disabled={!canIngestFiles} />
      )}
      {showAttachBtn && (
        <button type="button" className="chorus-attach" onClick={() => { if (canIngestFiles) fileInputRef.current?.click(); }} aria-label={attachFileLabel} title={attachFileLabel} disabled={!canIngestFiles} aria-disabled={!canIngestFiles}>
          <Paperclip size={18} strokeWidth={2} />
        </button>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={onTextareaChange}
        onKeyDown={onKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        placeholder={placeholder}
        aria-label={textareaAriaLabel}
        aria-describedby={hasInactiveReason ? reasonId : undefined}
        disabled={disabled}
        readOnly={readOnly || disabled}
        // A natively disabled control must not also advertise aria-readonly:
        // the two ARIA states are mutually exclusive, so only expose it for
        // a purely read-only (not disabled) textarea.
        aria-readonly={readOnly && !disabled ? true : undefined}
      />
      <button type="button" className="chorus-send" onClick={onSendClick} aria-label={sendActionLabel} title={sendActionLabel} disabled={sending ? !stopAvailable : !canSend}>
        {sending ? <span className="chorus-stop-fill" /> : <ArrowUp size={18} strokeWidth={2} />}
      </button>
    </div>
  );
}
