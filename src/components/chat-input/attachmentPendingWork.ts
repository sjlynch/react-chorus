import React from 'react';
import type { Attachment, AttachmentError, AttachmentSource, UploadAttachment } from '../../types';
import type { ChorusAttachmentLabels } from '../../labels/types';
import {
  createPendingAttachment,
  createPendingAttachmentId,
  getPendingAttachmentId,
  normalizeAttachment,
  readFileAsDataURL,
  type PendingAttachmentOperation,
} from './attachmentUtils';
import { createAttachmentWorkError } from './attachmentValidation';

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

interface PendingAttachmentWork {
  file: File;
  pendingId: string;
  controller: AbortController;
  operation: PendingAttachmentOperation;
  placeholder: Attachment;
}

interface UsePendingAttachmentWorkOptions {
  uploadAttachment?: UploadAttachment;
  labels: ChorusAttachmentLabels;
  accept?: string;
  maxAttachmentBytes?: number;
  maxAttachments?: number;
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
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
  setAttachments,
  setAnnouncement,
  reportAttachmentError,
  errorRegionRendered,
}: UsePendingAttachmentWorkOptions) {
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

  const startPendingAttachmentWork = React.useCallback(async (acceptedFiles: File[], source: AttachmentSource) => {
    if (acceptedFiles.length === 0) return;

    const operation: PendingAttachmentOperation = uploadAttachment ? 'upload' : 'read';
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

    await Promise.all(pendingWork.map(async ({ file, pendingId, controller, operation: pendingOperation }) => {
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
          const errorLabels = labelsRef.current;
          reportAttachmentError(createAttachmentWorkError({
            operation: pendingOperation,
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
              id: pendingId,
              kind: 'failed',
              message: errorLabels.failedAnnouncement(file.name),
            });
          }
        }
        setAttachments(prev => prev.filter(att => getPendingAttachmentId(att) !== pendingId));
      } finally {
        pendingControllersRef.current.delete(pendingId);
      }
    }));
  }, [accept, convertFile, errorRegionRendered, maxAttachmentBytes, maxAttachments, reportAttachmentError, setAnnouncement, setAttachments, uploadAttachment]);

  return {
    startPendingAttachmentWork,
    abortPendingAttachment,
    abortAllPendingAttachments,
  };
}
