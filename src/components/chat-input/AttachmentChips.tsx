import React from 'react';
import { X } from 'lucide-react';
import { DEFAULT_ATTACHMENT_LABELS } from '../../labels/attachments';
import type { ChorusAttachmentLabels } from '../../labels/types';
import { getAttachmentPreviewSource } from '../../utils/attachmentPreview';
import type { QueuedAttachment } from './attachmentUtils';

export interface AttachmentChipsProps {
  attachments: QueuedAttachment[];
  disabled: boolean;
  /** Removes (or, for a pending chip, cancels) the attachment with this uid. */
  onRemove: (uid: string) => void;
  /** Re-runs the read/upload for a `failed` chip. */
  onRetry: (uid: string) => void;
  labels?: ChorusAttachmentLabels;
  /**
   * Called when the user edits the alt-text input for an image attachment.
   * Omit to hide the "describe this image" affordance.
   */
  onAltChange?: (uid: string, alt: string) => void;
}

export function AttachmentChips({ attachments, disabled, onRemove, onRetry, labels = DEFAULT_ATTACHMENT_LABELS, onAltChange }: AttachmentChipsProps) {
  const [openAltEditor, setOpenAltEditor] = React.useState<string | null>(null);
  if (attachments.length === 0) return null;

  return (
    <div className="chorus-attachments">
      {attachments.map(({ uid, attachment: att, status, operation }) => {
        const previewSource = getAttachmentPreviewSource(att);
        const pending = status === 'pending';
        const failed = status === 'failed';
        const ready = status === 'ready';
        const pendingLabel = operation === 'read' ? labels.readingStatus(att.name) : labels.uploadingStatus(att.name);
        const isImage = att.type.startsWith('image/');
        // Alt text is only meaningful for an attachment that actually resolved.
        const allowAltEditor = ready && isImage && !disabled && onAltChange;
        // Open via `openAltEditor` once the user interacts (see the input's `onFocus`);
        // the content-length clause only handles the first render of a pre-populated
        // alt (e.g. restored from a draft) so the editor isn't hidden behind the button.
        const altEditorOpen = openAltEditor === uid || (allowAltEditor && typeof att.alt === 'string' && att.alt.length > 0);
        const chipImageAlt = att.alt && att.alt.length > 0 ? att.alt : att.name;
        // Static `aria-describedby` target so a screen-reader user hears the
        // pending/failed status when they focus the chip's button. It is NOT a
        // live region — the status is announced (without needing focus) through
        // the always-mounted `chorus-attachment-announcer` span; see
        // `attachmentPendingWork.ts` for why a per-chip live region is unreliable.
        const statusId = `chorus-attachment-status-${uid}`;
        const hasStatusText = pending || failed;
        return (
          <div
            key={uid}
            className={`chorus-attachment-chip${pending ? ' chorus-attachment-chip--pending' : ''}${failed ? ' chorus-attachment-chip--failed' : ''}`}
            aria-busy={pending || undefined}
          >
            {pending ? (
              <span className="chorus-attachment-spinner" aria-hidden="true" />
            ) : failed ? (
              <span className="chorus-attachment-failed-icon" aria-hidden="true">!</span>
            ) : isImage && previewSource && (
              <img src={previewSource} alt={chipImageAlt} className="chorus-attachment-thumb" loading="lazy" decoding="async" />
            )}
            <span className="chorus-attachment-name">{att.name}</span>
            {hasStatusText && (
              <span id={statusId} className="chorus-sr-only">
                {pending ? pendingLabel : labels.failedAnnouncement(att.name)}
              </span>
            )}
            {allowAltEditor && !altEditorOpen && (
              <button
                type="button"
                className="chorus-attachment-describe"
                onClick={() => setOpenAltEditor(uid)}
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
                // Pin the editor to this uid as soon as the user starts editing so it
                // stays mounted even if they clear the field to empty mid-edit — the
                // content-length fallback in `altEditorOpen` would otherwise unmount it.
                onFocus={() => setOpenAltEditor(uid)}
                onChange={(e) => {
                  setOpenAltEditor(uid);
                  onAltChange(uid, e.target.value);
                }}
                placeholder={labels.describeImagePlaceholder}
                aria-label={labels.describeImageInputAriaLabel(att.name)}
                autoFocus={openAltEditor === uid}
              />
            )}
            {failed && (
              <button
                type="button"
                className="chorus-attachment-retry"
                onClick={() => onRetry(uid)}
                aria-label={labels.retryAttachment(att.name)}
                aria-describedby={statusId}
                title={labels.retry}
                disabled={disabled}
                aria-disabled={disabled || undefined}
              >
                {labels.retry}
              </button>
            )}
            <button
              type="button"
              className="chorus-attachment-remove"
              onClick={() => onRemove(uid)}
              aria-label={pending ? labels.cancelUpload(att.name) : labels.removeAttachment(att.name)}
              aria-describedby={hasStatusText ? statusId : undefined}
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
