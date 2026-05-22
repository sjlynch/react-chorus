import React from 'react';

/** The enter/over/leave drag bookkeeping for one independent region. */
export interface DragScopeHandlers {
  markDragEnter: () => void;
  markDragOver: () => void;
  markDragLeave: () => void;
}

export interface AttachmentDragState {
  draggingFiles: boolean;
  clearDragState: () => void;
  /** Drag bookkeeping for the surrounding `.chorus` surface listeners. */
  surfaceDrag: DragScopeHandlers;
  /** Drag bookkeeping for the composer root's React handlers. */
  composerDrag: DragScopeHandlers;
}

export function useAttachmentDragState(): AttachmentDragState {
  const [draggingFiles, setDraggingFiles] = React.useState(false);
  // `dragenter`/`dragleave` fire once per descendant element the cursor crosses,
  // so each region counts its own crossings and only stops showing the overlay
  // once its depth returns to 0. The surface listeners and the composer React
  // handlers keep SEPARATE depths: a single shared counter desynced because the
  // two handler sets observe different — and not symmetric — enter/leave events.
  // Dragging a file from the transcript into the composer fires a surface
  // `dragleave` and a composer `dragenter` from unrelated code paths; sharing
  // one counter let those drift and leave `draggingFiles` stuck on or flickering.
  const surfaceDepthRef = React.useRef(0);
  const composerDepthRef = React.useRef(0);

  const syncDraggingFiles = React.useCallback(() => {
    setDraggingFiles(surfaceDepthRef.current > 0 || composerDepthRef.current > 0);
  }, []);

  const clearDragState = React.useCallback(() => {
    surfaceDepthRef.current = 0;
    composerDepthRef.current = 0;
    setDraggingFiles(false);
  }, []);

  const surfaceDrag = useDragScope(surfaceDepthRef, syncDraggingFiles, setDraggingFiles);
  const composerDrag = useDragScope(composerDepthRef, syncDraggingFiles, setDraggingFiles);

  React.useEffect(() => {
    if (!draggingFiles) return;

    window.addEventListener('dragend', clearDragState);
    window.addEventListener('blur', clearDragState);

    return () => {
      window.removeEventListener('dragend', clearDragState);
      window.removeEventListener('blur', clearDragState);
    };
  }, [clearDragState, draggingFiles]);

  return { draggingFiles, clearDragState, surfaceDrag, composerDrag };
}

/** Builds the stable enter/over/leave handlers for one independent drag region. */
function useDragScope(
  depthRef: React.MutableRefObject<number>,
  syncDraggingFiles: () => void,
  setDraggingFiles: React.Dispatch<React.SetStateAction<boolean>>,
): DragScopeHandlers {
  // `depthRef`, `syncDraggingFiles`, and `setDraggingFiles` are all stable, so
  // these handlers keep a stable identity — the surface effect can depend on them
  // without re-subscribing every render.
  return React.useMemo(() => ({
    markDragEnter: () => {
      depthRef.current += 1;
      setDraggingFiles(true);
    },
    markDragOver: () => {
      setDraggingFiles(true);
    },
    markDragLeave: () => {
      depthRef.current = Math.max(0, depthRef.current - 1);
      // Only this region's depth changed; the other region may still be mid-drag,
      // so recompute from both counters instead of clearing unconditionally.
      syncDraggingFiles();
    },
  }), [depthRef, syncDraggingFiles, setDraggingFiles]);
}
