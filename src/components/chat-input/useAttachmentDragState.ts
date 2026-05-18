import React from 'react';

export function useAttachmentDragState() {
  const [draggingFiles, setDraggingFiles] = React.useState(false);
  const dragDepthRef = React.useRef(0);

  const clearDragState = React.useCallback(() => {
    dragDepthRef.current = 0;
    setDraggingFiles(false);
  }, []);

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

  React.useEffect(() => {
    if (!draggingFiles) return;

    window.addEventListener('dragend', clearDragState);
    window.addEventListener('blur', clearDragState);

    return () => {
      window.removeEventListener('dragend', clearDragState);
      window.removeEventListener('blur', clearDragState);
    };
  }, [clearDragState, draggingFiles]);

  return {
    draggingFiles,
    clearDragState,
    markDragEnter,
    markDragLeave,
    markDragOver,
  };
}
