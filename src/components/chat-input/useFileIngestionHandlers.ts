import type * as React from 'react';
import type { AttachmentSource } from '../../types';
import { filesFromTransfer, transferHasFiles } from './attachmentUtils';

type HandleFiles = (files: FileList | File[] | null, source: AttachmentSource) => void | Promise<void>;

interface UseFileIngestionHandlersOptions {
  showAttachBtn: boolean;
  canIngestFiles: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
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
    if (!canIngestFiles) {
      e.preventDefault();
      return;
    }
    void handleFiles(files, 'paste');
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!showAttachBtn || !transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (!canIngestFiles) return;
    markDragEnter();
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!showAttachBtn || !transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (!canIngestFiles) return;
    e.dataTransfer.dropEffect = 'copy';
    markDragOver();
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!showAttachBtn || !transferHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (!canIngestFiles) return;
    markDragLeave();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!showAttachBtn || !transferHasFiles(e.dataTransfer)) return;
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

  return {
    onFileInputChange,
    handleRootPaste,
    handleRootDragEnter,
    handleRootDragOver,
    handleRootDragLeave,
    handleRootDrop,
  };
}
