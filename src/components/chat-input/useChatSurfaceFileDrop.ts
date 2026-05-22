import React from 'react';
import type { AttachmentSource } from '../../types';
import { filesFromTransfer, transferHasFiles } from './attachmentUtils';
import type { DragScopeHandlers } from './useAttachmentDragState';

type HandleFiles = (files: FileList | File[] | null, source: AttachmentSource) => void | Promise<void>;

interface UseChatSurfaceFileDropOptions {
  /** ChatInput root element, used to find the surrounding `.chorus` surface and
   *  to leave composer-originating events to the React handlers. */
  rootRef: React.RefObject<HTMLElement | null>;
  canIngestFiles: boolean;
  handleFiles: HandleFiles;
  clearDragState: () => void;
  /** Surface-only drag bookkeeping, kept independent from the composer's so the
   *  two listener sets never decrement a depth the other side incremented. */
  surfaceDrag: DragScopeHandlers;
}

export function claimSurfaceFileTransfer(e: DragEvent, root: HTMLElement): DataTransfer | null {
  const transfer = e.dataTransfer;
  if (!transfer || !transferHasFiles(transfer)) return null;
  if (e.target instanceof Node && root.contains(e.target)) return null;

  // Always suppress browser navigation for file drops on the wider chat surface,
  // even when the composer cannot currently ingest files.
  e.preventDefault();
  return transfer;
}

export function useChatSurfaceFileDrop({
  rootRef,
  canIngestFiles,
  handleFiles,
  clearDragState,
  surfaceDrag,
}: UseChatSurfaceFileDropOptions) {
  // Drag-and-drop is wired to the ChatInput root via React handlers, but users
  // naturally drag files onto the transcript too. Listen on the surrounding chat
  // surface (the `.chorus` widget root, when present) so a drop anywhere in the
  // widget is ingested — and, critically, preventDefault()'d so the browser never
  // navigates away to the dropped file's URL. Composer-rooted events are skipped
  // because the React handlers already cover them.
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const surface = root.closest<HTMLElement>('.chorus');
    if (!surface || surface === root || !surface.contains(root)) return;

    const onSurfaceDragEnter = (e: DragEvent) => {
      if (claimSurfaceFileTransfer(e, root) && canIngestFiles) surfaceDrag.markDragEnter();
    };

    const onSurfaceDragOver = (e: DragEvent) => {
      const transfer = claimSurfaceFileTransfer(e, root);
      if (transfer && canIngestFiles) {
        transfer.dropEffect = 'copy';
        surfaceDrag.markDragOver();
      }
    };

    const onSurfaceDragLeave = (e: DragEvent) => {
      if (claimSurfaceFileTransfer(e, root) && canIngestFiles) surfaceDrag.markDragLeave();
    };

    const onSurfaceDrop = (e: DragEvent) => {
      const transfer = claimSurfaceFileTransfer(e, root);
      if (!transfer) return;
      clearDragState();
      if (canIngestFiles) void handleFiles(filesFromTransfer(transfer), 'drop');
    };

    surface.addEventListener('dragenter', onSurfaceDragEnter);
    surface.addEventListener('dragover', onSurfaceDragOver);
    surface.addEventListener('dragleave', onSurfaceDragLeave);
    surface.addEventListener('drop', onSurfaceDrop);

    return () => {
      surface.removeEventListener('dragenter', onSurfaceDragEnter);
      surface.removeEventListener('dragover', onSurfaceDragOver);
      surface.removeEventListener('dragleave', onSurfaceDragLeave);
      surface.removeEventListener('drop', onSurfaceDrop);
    };
  }, [rootRef, canIngestFiles, handleFiles, clearDragState, surfaceDrag]);
}
