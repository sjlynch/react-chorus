import React from 'react';
import type { Attachment, AttachmentError, AttachmentErrorReason, AttachmentSource, UploadAttachment } from '../../types';
import { DEFAULT_ATTACHMENT_LABELS } from '../../labels/attachments';
import type { ChorusAttachmentLabels } from '../../labels/types';
import { createPendingAttachment, createPendingAttachmentId, formatBytes, getPendingAttachmentId, isPendingAttachment, listFiles, matchesAccept, normalizeAttachment, readFileAsDataURL, type PendingAttachmentWork } from './attachmentUtils';

// Local to keep attachment UI from owning shared hook/transport utility chunks.
function isAbortError(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name?: unknown }).name === 'AbortError';
}

export interface AttachmentAnnouncement {
  /** Stable id used as the announcement key (mirrors pending chip ids when applicable). */
  id: string;
  /** Type of announcement so callers can vary tone/role if desired. */
  kind: 'completed' | 'failed';
  /** Localized text to render inside a polite live region. */
  message: string;
}

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
  const [draggingFiles, setDraggingFiles] = React.useState(false);
  const [attachmentError, setAttachmentError] = React.useState<AttachmentError | null>(null);
  const [announcement, setAnnouncement] = React.useState<AttachmentAnnouncement | null>(null);
  const attachmentsRef = React.useRef(attachments);
  const dragDepthRef = React.useRef(0);
  const pendingControllersRef = React.useRef<Map<string, AbortController>>(new Map());
  const previousResetKeyRef = React.useRef(resetKey);
  // Latest labels are tracked via a ref so async completion handlers always use the freshest
  // localized text without re-creating handleFiles each render.
  const labelsRef = React.useRef(labels);
  React.useEffect(() => { labelsRef.current = labels; }, [labels]);

  React.useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const dismissAttachmentError = React.useCallback(() => {
    setAttachmentError(null);
  }, []);

  const abortPendingAttachment = React.useCallback((pendingId: string) => {
    const controller = pendingControllersRef.current.get(pendingId);
    if (controller && !controller.signal.aborted) controller.abort();
    pendingControllersRef.current.delete(pendingId);
  }, []);

  const abortAllPendingAttachments = React.useCallback(() => {
    for (const controller of pendingControllersRef.current.values()) {
      if (!controller.signal.aborted) controller.abort();
    }
    pendingControllersRef.current.clear();
  }, []);

  const clearAttachmentsAndPendingWork = React.useCallback(() => {
    abortAllPendingAttachments();
    setAttachments([]);
    setAttachmentError(null);
    setAnnouncement(null);
  }, [abortAllPendingAttachments]);

  const clearDragState = React.useCallback(() => {
    dragDepthRef.current = 0;
    setDraggingFiles(false);
  }, []);

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

  React.useEffect(() => {
    if (!draggingFiles) return;

    window.addEventListener('dragend', clearDragState);
    window.addEventListener('blur', clearDragState);

    return () => {
      window.removeEventListener('dragend', clearDragState);
      window.removeEventListener('blur', clearDragState);
    };
  }, [clearDragState, draggingFiles]);

  const reportAttachmentError = React.useCallback((
    reason: AttachmentErrorReason,
    source: AttachmentSource,
    file: File | undefined,
    message: string,
  ) => {
    const error: AttachmentError = {
      reason,
      message,
      file,
      source,
      accept,
      maxAttachmentBytes,
      maxAttachments,
    };
    setAttachmentError(error);
    onAttachmentError?.(error);
  }, [accept, maxAttachmentBytes, maxAttachments, onAttachmentError]);

  const convertFile = React.useCallback(async (file: File, signal: AbortSignal): Promise<Attachment> => {
    if (uploadAttachment) return normalizeAttachment(file, await uploadAttachment(file, { signal }));

    return {
      name: file.name,
      type: file.type,
      data: await readFileAsDataURL(file, signal),
      size: file.size,
    };
  }, [uploadAttachment]);

  const handleFiles = React.useCallback(async (incomingFiles: FileList | File[] | null, source: AttachmentSource) => {
    if (!canIngestFiles) return;

    const files = listFiles(incomingFiles);
    if (files.length === 0) return;

    // Start of a fresh user batch — clear any prior error so this batch's outcome
    // (success or new error) is the one surfaced.
    setAttachmentError(null);

    const acceptedFiles: File[] = [];
    let nextCount = attachmentsRef.current.length;
    const activeLabels = labelsRef.current;

    for (const file of files) {
      if (!matchesAccept(file, accept ?? '')) {
        reportAttachmentError(
          'unsupported-type',
          source,
          file,
          activeLabels.unsupportedTypeError({ name: file.name, accept }),
        );
        continue;
      }

      if (maxAttachmentBytes !== undefined && file.size > maxAttachmentBytes) {
        reportAttachmentError(
          'too-large',
          source,
          file,
          activeLabels.tooLargeError({
            name: file.name,
            size: formatBytes(file.size),
            limit: formatBytes(maxAttachmentBytes),
          }),
        );
        continue;
      }

      if (maxAttachments !== undefined && nextCount >= maxAttachments) {
        reportAttachmentError(
          'too-many',
          source,
          file,
          activeLabels.tooManyError({ name: file.name, max: maxAttachments }),
        );
        continue;
      }

      nextCount += 1;
      acceptedFiles.push(file);
    }

    if (acceptedFiles.length === 0) return;

    const operation: PendingAttachmentWork['operation'] = uploadAttachment ? 'upload' : 'read';
    const pendingWork = acceptedFiles.map((file): PendingAttachmentWork => {
      const pendingId = createPendingAttachmentId();
      const controller = new AbortController();
      pendingControllersRef.current.set(pendingId, controller);
      return {
        file,
        pendingId,
        controller,
        operation,
        placeholder: createPendingAttachment(file, pendingId, operation),
      };
    });

    setAttachments(prev => [...prev, ...pendingWork.map(work => work.placeholder)]);

    await Promise.all(pendingWork.map(async ({ file, pendingId, controller }) => {
      try {
        const attachment = await convertFile(file, controller.signal);
        if (controller.signal.aborted) return;
        setAttachments(prev => {
          let replaced = false;
          const next = prev.map(att => {
            if (getPendingAttachmentId(att) !== pendingId) return att;
            replaced = true;
            return attachment;
          });
          return replaced ? next : prev;
        });
        setAnnouncement({
          id: pendingId,
          kind: 'completed',
          message: labelsRef.current.completedAnnouncement(file.name),
        });
      } catch (error) {
        const wasCancelled = controller.signal.aborted || isAbortError(error);
        if (!wasCancelled) {
          const detail = error instanceof Error ? error.message : String(error);
          const reason = uploadAttachment ? 'upload-failed' : 'read-failed';
          const errorLabels = labelsRef.current;
          const message = uploadAttachment
            ? errorLabels.uploadFailedError({ name: file.name, detail })
            : errorLabels.readFailedError({ name: file.name, detail });
          reportAttachmentError(reason, source, file, message);
          setAnnouncement({
            id: pendingId,
            kind: 'failed',
            message: errorLabels.failedAnnouncement(file.name),
          });
        }
        setAttachments(prev => prev.filter(att => getPendingAttachmentId(att) !== pendingId));
      } finally {
        pendingControllersRef.current.delete(pendingId);
      }
    }));
  }, [accept, canIngestFiles, convertFile, maxAttachmentBytes, maxAttachments, reportAttachmentError, uploadAttachment]);

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

  const markDragEnter = React.useCallback(() => {
    dragDepthRef.current += 1;
    setDraggingFiles(true);
  }, []);

  const markDragOver = React.useCallback(() => {
    setDraggingFiles(true);
  }, []);

  const markDragLeave = React.useCallback(() => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDraggingFiles(false);
  }, []);

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
