import React from 'react';
import type { Attachment, AttachmentError, AttachmentSource, UploadAttachment } from '../../types';
import { DEFAULT_ATTACHMENT_LABELS } from '../../labels/attachments';
import type { ChorusAttachmentLabels } from '../../labels/types';
import { listFiles, updateQueuedAttachment, type QueuedAttachment } from './attachmentUtils';
import { useAttachmentDragState } from './useAttachmentDragState';
import { usePendingAttachmentWork, type AttachmentAnnouncement } from './attachmentPendingWork';
import { validateAttachmentBatch } from './attachmentValidation';
import type { RenderAttachmentErrorContext } from './types';

export type { AttachmentAnnouncement } from './attachmentPendingWork';
export type { QueuedAttachment } from './attachmentUtils';

export interface UseAttachmentQueueOptions {
  resetKey?: unknown;
  accept?: string;
  maxAttachmentBytes?: number;
  maxAttachments?: number;
  onAttachmentError?: (error: AttachmentError) => void;
  /**
   * The host's attachment-error render override, used only to decide whether an
   * error region is rendered for failures: `null` opts out of any error surface,
   * `undefined` keeps the default `AttachmentErrorRegion`, and a function renders
   * a custom node. When a region is rendered it announces failures itself, so the
   * pending-work hook skips the separate `failed` announcement to avoid a double
   * screen-reader announcement.
   */
  renderAttachmentError?: ((context: RenderAttachmentErrorContext) => React.ReactNode) | null;
  uploadAttachment?: UploadAttachment;
  canIngestFiles: boolean;
  composerInactive: boolean;
  labels?: ChorusAttachmentLabels;
}

export function useAttachmentQueue({
  resetKey,
  accept,
  maxAttachmentBytes,
  maxAttachments,
  onAttachmentError,
  renderAttachmentError,
  uploadAttachment,
  canIngestFiles,
  composerInactive,
  labels = DEFAULT_ATTACHMENT_LABELS,
}: UseAttachmentQueueOptions) {
  const [queuedAttachments, setQueuedAttachments] = React.useState<QueuedAttachment[]>([]);
  const [attachmentError, setAttachmentError] = React.useState<AttachmentError | null>(null);
  const [announcement, setAnnouncement] = React.useState<AttachmentAnnouncement | null>(null);
  const queuedAttachmentsRef = React.useRef(queuedAttachments);
  const previousResetKeyRef = React.useRef(resetKey);
  const {
    draggingFiles,
    clearDragState,
    markDragEnter,
    markDragLeave,
    markDragOver,
  } = useAttachmentDragState();

  React.useEffect(() => {
    queuedAttachmentsRef.current = queuedAttachments;
  }, [queuedAttachments]);

  const dismissAttachmentError = React.useCallback(() => {
    setAttachmentError(null);
  }, []);

  const reportAttachmentError = React.useCallback((error: AttachmentError) => {
    setAttachmentError(error);
    onAttachmentError?.(error);
  }, [onAttachmentError]);

  const {
    startPendingAttachmentWork,
    retryAttachmentWork,
    abortPendingAttachment,
    abortAllPendingAttachments,
  } = usePendingAttachmentWork({
    uploadAttachment,
    labels,
    accept,
    maxAttachmentBytes,
    maxAttachments,
    setQueuedAttachments,
    setAnnouncement,
    reportAttachmentError,
    // A `null` override means the host opted out of any error surface; anything
    // else (default region or a custom node) renders a region that announces
    // failures itself.
    errorRegionRendered: renderAttachmentError !== null,
  });

  const clearAttachmentsAndPendingWork = React.useCallback(() => {
    abortAllPendingAttachments();
    setQueuedAttachments([]);
    setAttachmentError(null);
    setAnnouncement(null);
  }, [abortAllPendingAttachments]);

  React.useEffect(() => () => abortAllPendingAttachments(), [abortAllPendingAttachments]);

  React.useEffect(() => {
    if (Object.is(previousResetKeyRef.current, resetKey)) return;
    previousResetKeyRef.current = resetKey;
    clearAttachmentsAndPendingWork();
  }, [clearAttachmentsAndPendingWork, resetKey]);

  React.useEffect(() => {
    if (!composerInactive) return;
    abortAllPendingAttachments();
    clearDragState();
    // Clear ALL staged attachments, not just pending ones: keeping completed
    // attachments here while dropping pending ones is an internally inconsistent
    // half-clear that carries stale files into the next, unrelated send once the
    // composer is re-enabled.
    setQueuedAttachments([]);
    setAttachmentError(null);
  }, [abortAllPendingAttachments, clearDragState, composerInactive]);

  const handleFiles = React.useCallback(async (incomingFiles: FileList | File[] | null, source: AttachmentSource) => {
    if (!canIngestFiles) return;

    const files = listFiles(incomingFiles);
    if (files.length === 0) return;

    // Start of a fresh user batch — clear any prior error so this batch's outcome
    // (success or new error) is the one surfaced.
    setAttachmentError(null);

    const { acceptedFiles, errors } = validateAttachmentBatch({
      files,
      source,
      currentAttachmentCount: queuedAttachmentsRef.current.length,
      labels,
      accept,
      maxAttachmentBytes,
      maxAttachments,
    });

    for (const error of errors) reportAttachmentError(error);

    if (acceptedFiles.length === 0) return;

    await startPendingAttachmentWork(acceptedFiles, source);
  }, [accept, canIngestFiles, labels, maxAttachmentBytes, maxAttachments, reportAttachmentError, startPendingAttachmentWork]);

  const removeAttachment = React.useCallback((uid: string) => {
    if (composerInactive) return;
    // Aborts in-flight work when the chip is pending; a no-op for ready/failed chips.
    abortPendingAttachment(uid);
    setQueuedAttachments(prev => prev.filter(item => item.uid !== uid));
  }, [abortPendingAttachment, composerInactive]);

  const updateAttachmentAlt = React.useCallback((uid: string, alt: string) => {
    if (composerInactive) return;
    setQueuedAttachments(prev => updateQueuedAttachment(prev, uid, item => {
      const next: Attachment = alt.length > 0 ? { ...item.attachment, alt } : { ...item.attachment };
      if (alt.length === 0) delete next.alt;
      return { ...item, attachment: next };
    }));
  }, [composerInactive]);

  const retryAttachment = React.useCallback((uid: string) => {
    if (composerInactive) return;
    const item = queuedAttachmentsRef.current.find(entry => entry.uid === uid);
    if (!item || item.status !== 'failed') return;
    // Fresh attempt — drop the prior failure so this retry's outcome is surfaced.
    setAttachmentError(null);
    void retryAttachmentWork(uid, item.file, item.source);
  }, [composerInactive, retryAttachmentWork]);

  const sendableAttachments = React.useMemo(
    () => queuedAttachments.filter(item => item.status === 'ready').map(item => item.attachment),
    [queuedAttachments],
  );

  return {
    queuedAttachments,
    sendableAttachments,
    attachmentError,
    announcement,
    dismissAttachmentError,
    draggingFiles,
    hasPendingAttachments: queuedAttachments.some(item => item.status === 'pending'),
    hasSendableAttachment: sendableAttachments.length > 0,
    clearAttachmentsAndPendingWork,
    clearDragState,
    handleFiles,
    markDragEnter,
    markDragLeave,
    markDragOver,
    removeAttachment,
    updateAttachmentAlt,
    retryAttachment,
  };
}
