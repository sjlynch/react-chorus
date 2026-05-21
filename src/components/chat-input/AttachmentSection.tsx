import type React from 'react';
import type { AttachmentError } from '../../types';
import type { ChorusAttachmentLabels } from '../../labels/types';
import { AttachmentChips } from './AttachmentChips';
import { AttachmentErrorRegion } from './AttachmentErrorRegion';
import type { AttachmentAnnouncement } from './attachmentPendingWork';
import type { QueuedAttachment } from './attachmentUtils';
import type { RenderAttachmentErrorContext } from './types';

interface AttachmentSectionProps {
  attachments: QueuedAttachment[];
  /** Composer is disabled or read-only — attachment controls are inert. */
  composerInactive: boolean;
  /** Whether the composer currently accepts new file work (drives alt editing). */
  canIngestFiles: boolean;
  labels: ChorusAttachmentLabels;
  onRemove: (uid: string) => void;
  onRetry: (uid: string) => void;
  onAltChange: (uid: string, alt: string) => void;
  announcement: AttachmentAnnouncement | null;
  attachmentError: AttachmentError | null;
  renderAttachmentError?: ((context: RenderAttachmentErrorContext) => React.ReactNode) | null;
  dismissAttachmentError: () => void;
}

/**
 * Attachment UI composition rendered above the composer input row: the queued
 * attachment chips, the polite live-region announcer for read/upload status,
 * and the attachment error surface (default `AttachmentErrorRegion`, a custom
 * `renderAttachmentError` node, or nothing when the host opted out with `null`).
 */
export function AttachmentSection({
  attachments,
  composerInactive,
  canIngestFiles,
  labels,
  onRemove,
  onRetry,
  onAltChange,
  announcement,
  attachmentError,
  renderAttachmentError,
  dismissAttachmentError,
}: AttachmentSectionProps) {
  const attachmentErrorNode = attachmentError && renderAttachmentError !== null
    ? (renderAttachmentError
      ? renderAttachmentError({ error: attachmentError, dismiss: dismissAttachmentError })
      : (
        <AttachmentErrorRegion
          error={attachmentError}
          labels={labels}
          onDismiss={dismissAttachmentError}
        />
      ))
    : null;

  return (
    <>
      <AttachmentChips
        attachments={attachments}
        disabled={composerInactive}
        onRemove={onRemove}
        onRetry={onRetry}
        labels={labels}
        onAltChange={canIngestFiles ? onAltChange : undefined}
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
    </>
  );
}
