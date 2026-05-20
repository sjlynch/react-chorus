import React from 'react';
import type { Attachment, AttachmentError, AttachmentSource, UploadAttachment } from '../../types';
import type { ChorusAttachmentLabels } from '../../labels/types';
import {
  createAttachmentUid,
  createPlaceholderAttachment,
  normalizeAttachment,
  readFileAsDataURL,
  updateQueuedAttachment,
  type PendingAttachmentOperation,
  type QueuedAttachment,
} from './attachmentUtils';
import { createAttachmentWorkError } from './attachmentValidation';

// Local to keep attachment UI from owning shared hook/transport utility chunks.
function isAbortError(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name?: unknown }).name === 'AbortError';
}

export interface AttachmentAnnouncement {
  /** Stable id used as the announcement key (mirrors the attachment uid). */
  id: string;
  /** Type of announcement so callers can vary tone/role if desired. */
  kind: 'completed' | 'failed';
  /** Localized text to render inside a polite live region. */
  message: string;
}

interface UsePendingAttachmentWorkOptions {
  uploadAttachment?: UploadAttachment;
  labels: ChorusAttachmentLabels;
  accept?: string;
  maxAttachmentBytes?: number;
  maxAttachments?: number;
  setQueuedAttachments: React.Dispatch<React.SetStateAction<QueuedAttachment[]>>;
  setAnnouncement: React.Dispatch<React.SetStateAction<AttachmentAnnouncement | null>>;
  reportAttachmentError: (error: AttachmentError) => void;
  /**
   * Whether an attachment error region (the default `AttachmentErrorRegion` or a
   * host `renderAttachmentError` node) is rendered for failures. That region is a
   * live region that announces the failure itself, so when it is present the
   * separate `kind: 'failed'` polite announcement is skipped — otherwise a single
   * failure would be announced twice. When false (`renderAttachmentError={null}`,
   * i.e. no error surface), the `failed` announcement is the only screen-reader
   * notification of the failure and is emitted.
   */
  errorRegionRendered: boolean;
}

export function usePendingAttachmentWork({
  uploadAttachment,
  labels,
  accept,
  maxAttachmentBytes,
  maxAttachments,
  setQueuedAttachments,
  setAnnouncement,
  reportAttachmentError,
  errorRegionRendered,
}: UsePendingAttachmentWorkOptions) {
  // Abort controllers are keyed by the stable attachment uid so cancel/retry
  // always target the right in-flight work regardless of chip ordering.
  const pendingControllersRef = React.useRef<Map<string, AbortController>>(new Map());
  // Latest labels are tracked via a ref so async completion handlers always use the freshest
  // localized text without re-creating pending work callbacks each render.
  const labelsRef = React.useRef(labels);
  React.useEffect(() => { labelsRef.current = labels; }, [labels]);

  const convertFile = React.useCallback(async (file: File, signal: AbortSignal): Promise<Attachment> => {
    if (uploadAttachment) return normalizeAttachment(file, await uploadAttachment(file, { signal }));

    return {
      name: file.name,
      type: file.type,
      data: await readFileAsDataURL(file, signal),
      size: file.size,
    };
  }, [uploadAttachment]);

  const abortPendingAttachment = React.useCallback((uid: string) => {
    const controller = pendingControllersRef.current.get(uid);
    if (controller && !controller.signal.aborted) controller.abort();
    pendingControllersRef.current.delete(uid);
  }, []);

  const abortAllPendingAttachments = React.useCallback(() => {
    for (const controller of pendingControllersRef.current.values()) {
      if (!controller.signal.aborted) controller.abort();
    }
    pendingControllersRef.current.clear();
  }, []);

  // Runs (or re-runs) the read/upload for one queued attachment, keyed by uid.
  // Resolution targets the chip by uid, so a chip removed or cleared while the
  // work was in flight is never resurrected and an aborted chip is left alone.
  const runAttachmentWork = React.useCallback(async (uid: string, file: File, source: AttachmentSource) => {
    const operation: PendingAttachmentOperation = uploadAttachment ? 'upload' : 'read';
    const controller = new AbortController();
    pendingControllersRef.current.set(uid, controller);
    try {
      const attachment = await convertFile(file, controller.signal);
      if (controller.signal.aborted) return;
      setQueuedAttachments(prev => updateQueuedAttachment(prev, uid, item => ({ ...item, status: 'ready', attachment })));
      setAnnouncement({
        id: uid,
        kind: 'completed',
        message: labelsRef.current.completedAnnouncement(file.name),
      });
    } catch (error) {
      const wasCancelled = controller.signal.aborted || isAbortError(error);
      if (!wasCancelled) {
        const detail = error instanceof Error ? error.message : String(error);
        const errorLabels = labelsRef.current;
        reportAttachmentError(createAttachmentWorkError({
          operation,
          source,
          file,
          detail,
          labels: errorLabels,
          accept,
          maxAttachmentBytes,
          maxAttachments,
        }));
        // The error region rendered by `reportAttachmentError` is itself a polite
        // live region that announces this failure. Only emit the separate `failed`
        // announcement when no error region exists, so one failure is announced once.
        if (!errorRegionRendered) {
          setAnnouncement({
            id: uid,
            kind: 'failed',
            message: errorLabels.failedAnnouncement(file.name),
          });
        }
        // Keep the chip in the row in a `failed` state so the user can retry or remove it.
        setQueuedAttachments(prev => updateQueuedAttachment(prev, uid, item => ({ ...item, status: 'failed' })));
      }
    } finally {
      pendingControllersRef.current.delete(uid);
    }
  }, [accept, convertFile, errorRegionRendered, maxAttachmentBytes, maxAttachments, reportAttachmentError, setAnnouncement, setQueuedAttachments, uploadAttachment]);

  const startPendingAttachmentWork = React.useCallback(async (acceptedFiles: File[], source: AttachmentSource) => {
    if (acceptedFiles.length === 0) return;

    const operation: PendingAttachmentOperation = uploadAttachment ? 'upload' : 'read';
    const newItems: QueuedAttachment[] = acceptedFiles.map(file => ({
      uid: createAttachmentUid(),
      status: 'pending',
      operation,
      source,
      file,
      attachment: createPlaceholderAttachment(file),
    }));

    setQueuedAttachments(prev => [...prev, ...newItems]);

    await Promise.all(newItems.map(item => runAttachmentWork(item.uid, item.file, item.source)));
  }, [runAttachmentWork, uploadAttachment, setQueuedAttachments]);

  // Re-runs the work for a `failed` chip, reusing its stable uid so the chip
  // transitions failed → pending → ready/failed in place.
  const retryAttachmentWork = React.useCallback(async (uid: string, file: File, source: AttachmentSource) => {
    setQueuedAttachments(prev => updateQueuedAttachment(prev, uid, item => ({
      ...item,
      status: 'pending',
      attachment: createPlaceholderAttachment(file),
    })));
    await runAttachmentWork(uid, file, source);
  }, [runAttachmentWork, setQueuedAttachments]);

  return {
    startPendingAttachmentWork,
    retryAttachmentWork,
    abortPendingAttachment,
    abortAllPendingAttachments,
  };
}
