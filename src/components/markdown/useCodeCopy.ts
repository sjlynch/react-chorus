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

      btn.textContent = label;
      btn.classList.remove('copied', 'copy-failed');
      btn.classList.add(className);

      const timer = setTimeout(() => {
        btn.textContent = labelsRef.current.copy;
        btn.classList.remove(className);
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
