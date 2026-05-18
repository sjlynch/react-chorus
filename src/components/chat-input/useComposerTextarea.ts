import React from 'react';

export const MAX_COMPOSER_TEXTAREA_HEIGHT = 160;

interface UseComposerTextareaOptions {
  value: string;
  onChange: (value: string) => void;
  composerInactive: boolean;
  forwardedRef: React.ForwardedRef<HTMLDivElement>;
}

export function useComposerTextarea({
  value,
  onChange,
  composerInactive,
  forwardedRef,
}: UseComposerTextareaOptions) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const resizeTextarea = React.useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_TEXTAREA_HEIGHT)}px`;
  }, []);

  const resetTextareaHeight = React.useCallback(() => {
    const el = textareaRef.current;
    if (el) el.style.height = '';
  }, []);

  React.useEffect(() => {
    resizeTextarea();
  }, [resizeTextarea, value]);

  React.useImperativeHandle(forwardedRef, () => {
    const root = rootRef.current!;
    const focusTextarea = () => textareaRef.current?.focus();
    try {
      Object.defineProperty(root, 'focus', { value: focusTextarea, configurable: true });
    } catch {
      root.focus = focusTextarea;
    }
    return root;
  });

  const handleTextareaChange = React.useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (composerInactive) return;
    onChange(e.target.value);
    resizeTextarea();
  }, [composerInactive, onChange, resizeTextarea]);

  return {
    rootRef,
    textareaRef,
    handleTextareaChange,
    resetTextareaHeight,
    resizeTextarea,
  };
}
