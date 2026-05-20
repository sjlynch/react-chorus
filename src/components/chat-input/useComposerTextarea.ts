import React from 'react';
import type { ChatInputFocusOptions, ChatInputHandle } from './types';

export const MAX_COMPOSER_TEXTAREA_HEIGHT = 160;

interface UseComposerTextareaOptions {
  value: string;
  onChange: (value: string) => void;
  composerInactive: boolean;
  forwardedRef: React.ForwardedRef<ChatInputHandle>;
}

export function useComposerTextarea({
  value,
  onChange,
  composerInactive,
  forwardedRef,
}: UseComposerTextareaOptions) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  // True while an IME composition is active so Enter can commit the composition
  // instead of sending (CJK / accented input).
  const isComposingRef = React.useRef(false);
  // Bumped on every user edit; a send captures the current value and a pending
  // async `onSend` can detect that the user has typed since it was dispatched.
  const composerGenerationRef = React.useRef(0);

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

  React.useImperativeHandle(forwardedRef, () => ({
    focus(options?: ChatInputFocusOptions) {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const caret = options?.caret;
      if (caret === undefined) return;
      const len = el.value.length;
      let pos: number;
      if (caret === 'start') pos = 0;
      else if (caret === 'end') pos = len;
      else pos = Math.max(0, Math.min(len, caret));
      el.selectionStart = pos;
      el.selectionEnd = pos;
    },
  }), []);

  const handleTextareaChange = React.useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (composerInactive) return;
    composerGenerationRef.current += 1;
    onChange(e.target.value);
    resizeTextarea();
  }, [composerInactive, onChange, resizeTextarea]);

  const handleCompositionStart = React.useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = React.useCallback(() => {
    isComposingRef.current = false;
  }, []);

  return {
    rootRef,
    textareaRef,
    handleTextareaChange,
    handleCompositionStart,
    handleCompositionEnd,
    isComposingRef,
    composerGenerationRef,
    resetTextareaHeight,
    resizeTextarea,
  };
}
