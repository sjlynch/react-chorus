import React from 'react';
import { DEFAULT_CODE_COPY_LABELS } from '../../labels/codeCopy';
import type { ChorusCodeCopyLabels } from '../../labels/types';
import { COPY_FEEDBACK_DURATION_MS, toClipboardError } from '../../utils/messageCopy';

export const COPY_LABEL = DEFAULT_CODE_COPY_LABELS.copy;

type ContainerRef = { current: HTMLDivElement | null };

function getCodeCopyText(codeEl: HTMLElement | null) {
  const raw = codeEl?.textContent ?? codeEl?.innerText ?? '';
  return raw.replace(/\r?\n$/, '');
}

/** Announce a status string into the code block's polite `aria-live` region, if present. */
function setCopyStatus(btn: HTMLElement, text: string) {
  const wrapper = btn.closest('.chorus-codeblock');
  const status = wrapper?.querySelector('.chorus-copy-status') as HTMLElement | null;
  if (status) status.textContent = text;
}

export function useCodeCopy(
  containerRef: ContainerRef,
  onCopyError?: (error: Error) => void,
  labels: ChorusCodeCopyLabels = DEFAULT_CODE_COPY_LABELS,
) {
  const labelsRef = React.useRef(labels);
  labelsRef.current = labels;

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof window === 'undefined' || typeof document === 'undefined' || typeof navigator === 'undefined') return;

    const feedbackTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

    const showCopyFeedback = (btn: HTMLElement, label: string, className: 'copied' | 'copy-failed') => {
      const existingTimer = feedbackTimers.get(btn);
      if (existingTimer) clearTimeout(existingTimer);

      // Reflect the new state visually (text), in the accessible name (aria-label),
      // and announce it via the block's polite live region for screen readers.
      btn.textContent = label;
      btn.setAttribute('aria-label', label);
      btn.classList.remove('copied', 'copy-failed');
      btn.classList.add(className);
      setCopyStatus(btn, label);

      const timer = setTimeout(() => {
        btn.textContent = labelsRef.current.copy;
        btn.setAttribute('aria-label', labelsRef.current.ariaLabel);
        btn.classList.remove(className);
        setCopyStatus(btn, '');
        feedbackTimers.delete(btn);
      }, COPY_FEEDBACK_DURATION_MS);
      feedbackTimers.set(btn, timer);
    };

    const handleCopy = async (btn: HTMLElement) => {
      const wrapper = btn.closest('.chorus-codeblock') as HTMLElement | null;
      const codeEl = wrapper?.querySelector('pre > code') as HTMLElement | null;
      const raw = getCodeCopyText(codeEl);
      try {
        if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Clipboard API is unavailable');
        await navigator.clipboard.writeText(raw);
        showCopyFeedback(btn, labelsRef.current.copied, 'copied');
      } catch (error) {
        const clipboardError = toClipboardError(error);
        showCopyFeedback(btn, labelsRef.current.failed, 'copy-failed');
        onCopyError?.(clipboardError);
      }
    };

    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement)?.closest?.('.chorus-copy-btn') as HTMLElement | null;
      if (btn) handleCopy(btn);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const btn = (e.target as HTMLElement)?.closest?.('.chorus-copy-btn') as HTMLElement | null;
      if (!btn) return;
      // Native <button> chrome (the default) already activates on Enter/Space via
      // a synthesized click; only polyfill keyboard activation for custom chrome
      // built on a non-button element so it does not copy twice.
      if (btn.tagName === 'BUTTON') return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleCopy(btn);
      }
    };

    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('keydown', onKeyDown);
      for (const timer of feedbackTimers.values()) clearTimeout(timer);
      feedbackTimers.clear();
    };
  }, [containerRef, onCopyError]);
}
