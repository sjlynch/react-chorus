import type React from 'react';
import type { AttachmentSource } from '../../types';
import { filesFromTransfer, transferHasFiles } from './attachmentUtils';
import type { DragScopeHandlers } from './useAttachmentDragState';
import { useChatSurfaceFileDrop } from './useChatSurfaceFileDrop';

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
  /** Drag bookkeeping for the surrounding `.chorus` surface listeners. */
  surfaceDrag: DragScopeHandlers;
  /** Drag bookkeeping for the composer root's React handlers. */
  composerDrag: DragScopeHandlers;
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
  surfaceDrag,
  composerDrag,
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
    composerDrag.markDragEnter();
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (!canIngestFiles) return;
    e.dataTransfer.dropEffect = 'copy';
    composerDrag.markDragOver();
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (!canIngestFiles) return;
    composerDrag.markDragLeave();
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

  useChatSurfaceFileDrop({
    rootRef,
    canIngestFiles,
    handleFiles,
    clearDragState,
    surfaceDrag,
  });

  return {
    onFileInputChange,
    handleRootPaste,
    handleRootDragEnter,
    handleRootDragOver,
    handleRootDragLeave,
    handleRootDrop,
  };
}
