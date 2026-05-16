import { X } from 'lucide-react';
import type { Attachment } from '../../types';
import { getAttachmentPreviewSource } from '../../utils/attachmentPreview';
import { getPendingAttachmentId, getPendingAttachmentOperation, isPendingAttachment } from './attachmentUtils';

export interface AttachmentChipsProps {
  attachments: Attachment[];
  disabled: boolean;
  onRemove: (index: number) => void;
}

export function AttachmentChips({ attachments, disabled, onRemove }: AttachmentChipsProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="chorus-attachments">
      {attachments.map((att, i) => {
        const previewSource = getAttachmentPreviewSource(att);
        const pending = isPendingAttachment(att);
        const pendingOperation = getPendingAttachmentOperation(att);
        const pendingLabel = pendingOperation === 'read' ? 'Reading' : 'Uploading';
        return (
          <div key={getPendingAttachmentId(att) ?? `${att.name}-${i}`} className={`chorus-attachment-chip${pending ? ' chorus-attachment-chip--pending' : ''}`}>
            {pending ? (
              <span className="chorus-attachment-spinner" aria-hidden="true" />
            ) : att.type.startsWith('image/') && previewSource && (
              <img src={previewSource} alt={att.name} className="chorus-attachment-thumb" loading="lazy" decoding="async" />
            )}
            <span className="chorus-attachment-name">{att.name}</span>
            {pending && <span className="chorus-sr-only">{pendingLabel} {att.name}</span>}
            <button type="button" className="chorus-attachment-remove" onClick={() => onRemove(i)} aria-label={`Remove ${att.name}`} disabled={disabled} aria-disabled={disabled || undefined}>
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
