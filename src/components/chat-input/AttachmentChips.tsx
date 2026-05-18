import React from 'react';
import { X } from 'lucide-react';
import type { Attachment } from '../../types';
import { DEFAULT_ATTACHMENT_LABELS } from '../../labels/attachments';
import type { ChorusAttachmentLabels } from '../../labels/types';
import { getAttachmentPreviewSource } from '../../utils/attachmentPreview';
import { getPendingAttachmentId, getPendingAttachmentOperation, isPendingAttachment } from './attachmentUtils';

export interface AttachmentChipsProps {
  attachments: Attachment[];
  disabled: boolean;
  onRemove: (index: number) => void;
  labels?: ChorusAttachmentLabels;
  /**
   * Called when the user edits the alt-text input for an image attachment.
   * Omit to hide the "describe this image" affordance.
   */
  onAltChange?: (index: number, alt: string) => void;
}

export function AttachmentChips({ attachments, disabled, onRemove, labels = DEFAULT_ATTACHMENT_LABELS, onAltChange }: AttachmentChipsProps) {
  const [openAltEditor, setOpenAltEditor] = React.useState<string | null>(null);
  if (attachments.length === 0) return null;

  return (
    <div className="chorus-attachments">
      {attachments.map((att, i) => {
        const previewSource = getAttachmentPreviewSource(att);
        const pending = isPendingAttachment(att);
        const pendingOperation = getPendingAttachmentOperation(att);
        const pendingLabel = pendingOperation === 'read' ? labels.readingStatus(att.name) : labels.uploadingStatus(att.name);
        const chipKey = getPendingAttachmentId(att) ?? att.id ?? `${att.name}-${i}`;
        const isImage = att.type.startsWith('image/');
        const allowAltEditor = !pending && isImage && !disabled && onAltChange;
        const altEditorOpen = openAltEditor === chipKey || (allowAltEditor && typeof att.alt === 'string' && att.alt.length > 0);
        const chipImageAlt = att.alt && att.alt.length > 0 ? att.alt : att.name;
        return (
          <div
            key={chipKey}
            className={`chorus-attachment-chip${pending ? ' chorus-attachment-chip--pending' : ''}`}
            aria-busy={pending || undefined}
          >
            {pending ? (
              <span className="chorus-attachment-spinner" aria-hidden="true" />
            ) : isImage && previewSource && (
              <img src={previewSource} alt={chipImageAlt} className="chorus-attachment-thumb" loading="lazy" decoding="async" />
            )}
            <span className="chorus-attachment-name">{att.name}</span>
            {pending && (
              <span className="chorus-sr-only" aria-live="polite">{pendingLabel}</span>
            )}
            {allowAltEditor && !altEditorOpen && (
              <button
                type="button"
                className="chorus-attachment-describe"
                onClick={() => setOpenAltEditor(chipKey)}
                aria-label={labels.describeImageInputAriaLabel(att.name)}
                title={labels.describeImage}
              >
                {labels.describeImage}
              </button>
            )}
            {allowAltEditor && altEditorOpen && (
              <input
                type="text"
                className="chorus-attachment-alt-input"
                value={att.alt ?? ''}
                onChange={(e) => onAltChange(i, e.target.value)}
                placeholder={labels.describeImagePlaceholder}
                aria-label={labels.describeImageInputAriaLabel(att.name)}
                autoFocus={openAltEditor === chipKey}
              />
            )}
            <button
              type="button"
              className="chorus-attachment-remove"
              onClick={() => onRemove(i)}
              aria-label={labels.removeAttachment(att.name)}
              disabled={disabled}
              aria-disabled={disabled || undefined}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
