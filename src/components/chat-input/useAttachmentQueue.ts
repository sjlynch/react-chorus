import React from 'react';
import type { Attachment, AttachmentError, AttachmentSource, UploadAttachment } from '../../types';
import { DEFAULT_ATTACHMENT_LABELS } from '../../labels/attachments';
import type { ChorusAttachmentLabels } from '../../labels/types';
import { getPendingAttachmentId, isPendingAttachment, listFiles } from './attachmentUtils';
import { useAttachmentDragState } from './useAttachmentDragState';
import { usePendingAttachmentWork, type AttachmentAnnouncement } from './attachmentPendingWork';
import { validateAttachmentBatch } from './attachmentValidation';

export type { AttachmentAnnouncement } from './attachmentPendingWork';

export interface UseAttachmentQueueOptions {
  resetKey?: unknown;
  accept?: string;
  maxAttachmentBytes?: number;
  maxAttachments?: number;
  onAttachmentError?: (error: AttachmentError) => void;
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
  uploadAttachment,
  canIngestFiles,
  composerInactive,
  labels = DEFAULT_ATTACHMENT_LABELS,
}: UseAttachmentQueueOptions) {
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = React.useState<AttachmentError | null>(null);
  const [announcement, setAnnouncement] = React.useState<AttachmentAnnouncement | null>(null);
  const attachmentsRef = React.useRef(attachments);
  const previousResetKeyRef = React.useRef(resetKey);
  const {
    draggingFiles,
    clearDragState,
    markDragEnter,
    markDragLeave,
    markDragOver,
  } = useAttachmentDragState();

  React.useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const dismissAttachmentError = React.useCallback(() => {
    setAttachmentError(null);
  }, []);

  const reportAttachmentError = React.useCallback((error: AttachmentError) => {
    setAttachmentError(error);
    onAttachmentError?.(error);
  }, [onAttachmentError]);

  const {
    startPendingAttachmentWork,
    abortPendingAttachment,
    abortAllPendingAttachments,
  } = usePendingAttachmentWork({
    uploadAttachment,
    labels,
    accept,
    maxAttachmentBytes,
    maxAttachments,
    setAttachments,
    setAnnouncement,
    reportAttachmentError,
  });

  const clearAttachmentsAndPendingWork = React.useCallback(() => {
    abortAllPendingAttachments();
    setAttachments([]);
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
    setAttachments(prev => prev.filter(att => !isPendingAttachment(att)));
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
      currentAttachmentCount: attachmentsRef.current.length,
      labels,
      accept,
      maxAttachmentBytes,
      maxAttachments,
    });

    for (const error of errors) reportAttachmentError(error);

    if (acceptedFiles.length === 0) return;

    await startPendingAttachmentWork(acceptedFiles, source);
  }, [accept, canIngestFiles, labels, maxAttachmentBytes, maxAttachments, reportAttachmentError, startPendingAttachmentWork]);

  const removeAttachment = React.useCallback((idx: number) => {
    if (composerInactive) return;
    const attachment = attachmentsRef.current[idx];
    const pendingId = attachment ? getPendingAttachmentId(attachment) : undefined;
    if (pendingId) abortPendingAttachment(pendingId);
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  }, [abortPendingAttachment, composerInactive]);

  const updateAttachmentAlt = React.useCallback((idx: number, alt: string) => {
    if (composerInactive) return;
    setAttachments(prev => prev.map((att, i) => {
      if (i !== idx) return att;
      const next: Attachment = alt.length > 0 ? { ...att, alt } : { ...att };
      if (alt.length === 0) delete next.alt;
      return next;
    }));
  }, [composerInactive]);

  return {
    attachments,
    attachmentError,
    announcement,
    dismissAttachmentError,
    draggingFiles,
    hasPendingAttachments: attachments.some(isPendingAttachment),
    hasSendableAttachment: attachments.some(att => !isPendingAttachment(att)),
    clearAttachmentsAndPendingWork,
    clearDragState,
    handleFiles,
    markDragEnter,
    markDragLeave,
    markDragOver,
    removeAttachment,
    updateAttachmentAlt,
  };
}
