import type React from 'react';
import { ArrowUp, Database, Paperclip } from 'lucide-react';
import type { Attachment } from '../../types';
import { joinClasses } from '../../utils/className';

interface ComposerInputRowProps {
  // Attach button + hidden file input.
  showAttachBtn: boolean;
  canIngestFiles: boolean;
  accept?: string;
  attachFileLabel: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  resourceAttachments: Attachment[];
  onResourceAttachmentChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  canAttachResource: boolean;
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
  resourceAttachments,
  onResourceAttachmentChange,
  canAttachResource,
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
  const showResourcePicker = resourceAttachments.length > 0;

  return (
    <div className={joinClasses('chorus-input-row', (showAttachBtn || showResourcePicker) && 'chorus-input-row--has-attach', showResourcePicker && 'chorus-input-row--has-resource-picker')}>
      {showAttachBtn && (
        <input ref={fileInputRef} type="file" accept={accept} multiple style={{ display: 'none' }} onChange={onFileInputChange} disabled={!canIngestFiles} />
      )}
      {showAttachBtn && (
        <button type="button" className="chorus-attach" onClick={() => { if (canIngestFiles) fileInputRef.current?.click(); }} aria-label={attachFileLabel} title={attachFileLabel} disabled={!canIngestFiles} aria-disabled={!canIngestFiles}>
          <Paperclip size={18} strokeWidth={2} />
        </button>
      )}
      {showResourcePicker && (
        <label className="chorus-resource-picker-wrap" title="Attach MCP resource">
          <Database size={15} strokeWidth={2} aria-hidden="true" />
          <span className="chorus-sr-only">Attach MCP resource</span>
          <select className="chorus-resource-picker" aria-label="Attach MCP resource" defaultValue="" onChange={onResourceAttachmentChange} disabled={!canAttachResource}>
            <option value="" disabled>Resources</option>
            {resourceAttachments.map((attachment, index) => (
              <option key={attachment.id ?? attachment.data ?? `${attachment.name}-${index}`} value={index}>{attachment.name}</option>
            ))}
          </select>
        </label>
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
      {/*
       * Stop chrome (square icon + "Stop" label) appears only when
       * `stopAvailable` — i.e. a host `onStop` exists to action. While
       * `sending` without `onStop` the button stays disabled but keeps the
       * Send affordance, so assistive tech never hears an inert "Stop".
       */}
      <button type="button" className="chorus-send" onClick={onSendClick} aria-label={sendActionLabel} title={sendActionLabel} disabled={sending ? !stopAvailable : !canSend}>
        {stopAvailable ? <span className="chorus-stop-fill" /> : <ArrowUp size={18} strokeWidth={2} />}
      </button>
    </div>
  );
}
