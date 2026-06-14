import type React from 'react';
import { ArrowUp, Database, Paperclip } from 'lucide-react';
import type { Attachment } from '../../types';
import { joinClasses } from '../../utils/className';
import type { ChatInputModelPicker } from './types';

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
  /** Visible/aria/title label for the MCP resource attachment picker. */
  attachResourceLabel: string;
  /** Disabled placeholder option at the top of the resource picker. */
  resourcePickerPlaceholder: string;
  /** Fallback aria-label/title for the model picker when it supplies none. */
  modelPickerFallbackLabel: string;
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
  // Optional inline model/provider picker rendered next to the send button.
  modelPicker?: ChatInputModelPicker;
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
  attachResourceLabel,
  resourcePickerPlaceholder,
  modelPickerFallbackLabel,
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
  modelPicker,
}: ComposerInputRowProps) {
  const showResourcePicker = resourceAttachments.length > 0;
  const showModelPicker = Boolean(modelPicker && modelPicker.options.length > 0);

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
        <label className="chorus-resource-picker-wrap" title={attachResourceLabel}>
          <Database size={15} strokeWidth={2} aria-hidden="true" />
          <span className="chorus-sr-only">{attachResourceLabel}</span>
          <select className="chorus-resource-picker" aria-label={attachResourceLabel} defaultValue="" onChange={onResourceAttachmentChange} disabled={!canAttachResource}>
            <option value="" disabled>{resourcePickerPlaceholder}</option>
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
      {showModelPicker && modelPicker && (
        <label className="chorus-model-picker-wrap" title={modelPicker.ariaLabel ?? modelPickerFallbackLabel}>
          <span className="chorus-sr-only">{modelPicker.ariaLabel ?? modelPickerFallbackLabel}</span>
          <select
            className="chorus-model-picker"
            aria-label={modelPicker.ariaLabel ?? modelPickerFallbackLabel}
            value={modelPicker.value}
            onChange={(e) => modelPicker.onChange(e.currentTarget.value)}
            disabled={disabled || readOnly}
          >
            {modelPicker.options.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      )}
      <button type="button" className="chorus-send" onClick={onSendClick} aria-label={sendActionLabel} title={sendActionLabel} disabled={sending ? !stopAvailable : !canSend}>
        {stopAvailable ? <span className="chorus-stop-fill" /> : <ArrowUp size={18} strokeWidth={2} />}
      </button>
    </div>
  );
}
