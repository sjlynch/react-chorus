import React from 'react';

/**
 * Auto-grow a `<textarea>` to fit its content, capped at `maxHeight` px.
 *
 * Shared by the composer (`useComposerTextarea`) and the inline message editor
 * (`InlineMessageEditor`) so both textareas resize identically while editing
 * chat text — previously only the composer auto-resized.
 *
 * The textarea is re-measured whenever `value` changes and on mount, so an
 * editor pre-filled with existing text opens already sized to fit it. The
 * returned `resize` callback re-measures on demand for callers that mutate the
 * textarea outside a `value` change (e.g. inside an onChange handler).
 */
export function useTextareaAutosize(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeight: number,
): () => void {
  const resize = React.useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Collapse to `auto` first so `scrollHeight` reports the content height
    // rather than the previously-set (possibly larger) box height.
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [textareaRef, maxHeight]);

  React.useEffect(() => {
    resize();
  }, [resize, value]);

  return resize;
}
