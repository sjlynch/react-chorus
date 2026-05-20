import React from 'react';
import type { AttachmentSource } from '../../types';
import { filesFromTransfer, transferHasFiles } from './attachmentUtils';

type HandleFiles = (files: FileList | File[] | null, source: AttachmentSource) => void | Promise<void>;

interface UseFileIngestionHandlersOptions {
  showAttachBtn: boolean;
  canIngestFiles: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  /** ChatInput root element — used to locate the wider chat surface and to skip
   *  composer-originating events that the React handlers already cover. */
  rootRef: React.RefObject<HTMLElement | null>;
  handleFiles: HandleFiles;
  clearDragState: () => void;
  markDragEnter: () => void;
  markDragLeave: () => void;
  markDragOver: () => void;
  onPaste?: React.ClipboardEventHandler<HTMLDivElement>;
  onDragEnter?: React.DragEventHandler<HTMLDivElement>;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDragLeave?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
}

export function useFileIngestionHandlers({
  showAttachBtn,
  canIngestFiles,
  fileInputRef,
  rootRef,
  handleFiles,
  clearDragState,
  markDragEnter,
  markDragLeave,
  markDragOver,
  onPaste,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: UseFileIngestionHandlersOptions) {
  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canIngestFiles) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const files = e.currentTarget.files ? Array.from(e.currentTarget.files) : [];
    void handleFiles(files, 'picker');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!showAttachBtn) return;
    const files = filesFromTransfer(e.clipboardData);
    if (files.length === 0) return;
    // A file payload is being handled by the composer — stop the textarea from
    // also receiving the file path / image-HTML alt text representation.
    e.preventDefault();
    if (!canIngestFiles) return;
    void handleFiles(files, 'paste');
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(e.dataTransfer)) return;
    // preventDefault even when attachments are disabled so a stray drop never
    // navigates the browser away to the dropped file's URL.
    e.preventDefault();
    if (!canIngestFiles) return;
    markDragEnter();
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (!canIngestFiles) return;
    e.dataTransfer.dropEffect = 'copy';
    markDragOver();
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (!canIngestFiles) return;
    markDragLeave();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    clearDragState();
    if (!canIngestFiles) return;
    void handleFiles(filesFromTransfer(e.dataTransfer), 'drop');
  };

  const handleRootPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    onPaste?.(e);
    if (!e.defaultPrevented) handlePaste(e);
  };

  const handleRootDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    onDragEnter?.(e);
    if (!e.defaultPrevented) handleDragEnter(e);
  };

  const handleRootDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    onDragOver?.(e);
    if (!e.defaultPrevented) handleDragOver(e);
  };

  const handleRootDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    onDragLeave?.(e);
    if (!e.defaultPrevented) handleDragLeave(e);
  };

  const handleRootDrop = (e: React.DragEvent<HTMLDivElement>) => {
    onDrop?.(e);
    if (!e.defaultPrevented) handleDrop(e);
  };

  // Drag-and-drop is wired to the ChatInput root via the React handlers above,
  // but users naturally drag files onto the transcript too. Listen on the
  // surrounding chat surface (the `.chorus` widget root, when present) so a drop
  // anywhere in the widget is ingested — and, critically, preventDefault()'d so
  // the browser never navigates away to the dropped file's URL. Composer-rooted
  // events are skipped here because the React handlers already cover them.
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const surface = root.closest<HTMLElement>('.chorus');
    if (!surface || surface === root || !surface.contains(root)) return;

    // Claim a file drag that lands on the surface outside the composer (the
    // transcript): preventDefault() it so the browser never navigates to the
    // file, and hand back its DataTransfer. Composer-rooted drags are left to
    // the React handlers above. Returns null when the event is not ours.
    const claimSurfaceDrag = (e: DragEvent): DataTransfer | null => {
      const transfer = e.dataTransfer;
      if (!transfer || !transferHasFiles(transfer)) return null;
      if (e.target instanceof Node && root.contains(e.target)) return null;
      e.preventDefault();
      return transfer;
    };

    const onSurfaceDragEnter = (e: DragEvent) => {
      if (claimSurfaceDrag(e) && canIngestFiles) markDragEnter();
    };

    const onSurfaceDragOver = (e: DragEvent) => {
      const transfer = claimSurfaceDrag(e);
      if (transfer && canIngestFiles) {
        transfer.dropEffect = 'copy';
        markDragOver();
      }
    };

    const onSurfaceDragLeave = (e: DragEvent) => {
      if (claimSurfaceDrag(e) && canIngestFiles) markDragLeave();
    };

    const onSurfaceDrop = (e: DragEvent) => {
      const transfer = claimSurfaceDrag(e);
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
  }, [rootRef, canIngestFiles, handleFiles, clearDragState, markDragEnter, markDragLeave, markDragOver]);

  return {
    onFileInputChange,
    handleRootPaste,
    handleRootDragEnter,
    handleRootDragOver,
    handleRootDragLeave,
    handleRootDrop,
  };
}
