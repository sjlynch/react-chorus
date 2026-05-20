import React from 'react';
import { DEFAULT_TRANSCRIPT_LABELS } from '../../labels/transcript';

export interface DefaultEmptyStateProps {
  prompts: string[];
  onSuggestedPrompt?: (prompt: string) => void;
  disabled?: boolean;
  disabledReason?: string;
  title?: string;
  ariaLabel?: string;
}

// Stable React key for a caller-supplied prompt string. Caller-controlled
// text is not safe to use directly as a key: two prompts that share the same
// string (or a string that recurs across re-renders) would collapse onto one
// key, producing duplicate-key warnings and reused focus/DOM state. Pairing a
// content hash with the list index keeps keys unique and content-stable.
function promptReactKey(prompt: string, index: number): string {
  let hash = 5381;
  for (let i = 0; i < prompt.length; i++) {
    hash = ((hash << 5) + hash + prompt.charCodeAt(i)) | 0;
  }
  return `${index}-${(hash >>> 0).toString(36)}`;
}

// Pick a focusable element outside the empty-state subtree so focus is never
// dropped on <body> when activating a prompt unmounts the empty state. The
// composer input is the preferred successor; the transcript container is the
// last-resort fallback (made programmatically focusable without entering the
// tab order).
function resolveFocusSuccessor(container: HTMLElement): HTMLElement | null {
  const root = container.closest('.chorus') ?? container.ownerDocument;
  const composer = root.querySelector<HTMLElement>('.chorus-input textarea');
  if (composer) return composer;

  const transcript = container.closest<HTMLElement>('.chorus-window');
  if (transcript && !transcript.hasAttribute('tabindex')) {
    transcript.setAttribute('tabindex', '-1');
  }
  return transcript;
}

export function DefaultEmptyState({
  prompts,
  onSuggestedPrompt,
  disabled = false,
  disabledReason,
  title = DEFAULT_TRANSCRIPT_LABELS.emptyStateTitle,
  ariaLabel = DEFAULT_TRANSCRIPT_LABELS.suggestedPromptsAriaLabel,
}: DefaultEmptyStateProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  // When activating a prompt clears the transcript, this empty state unmounts
  // and takes the focused prompt button with it. A layout-effect cleanup runs
  // synchronously during the unmount commit — before the DOM is detached — so
  // if focus still sits on one of our buttons we can route it to a meaningful
  // successor instead of letting it fall back to <body>.
  React.useLayoutEffect(() => {
    const container = containerRef.current;
    return () => {
      if (!container) return;
      const active = container.ownerDocument.activeElement;
      if (!active || !container.contains(active)) return;
      resolveFocusSuccessor(container)?.focus();
    };
  }, []);

  return (
    <div ref={containerRef} className="chorus-empty-state chorus-empty-state-default">
      <div className="chorus-empty-title">{title}</div>
      <div className="chorus-suggested-prompts" role="group" aria-label={ariaLabel}>
        {prompts.map((prompt, index) => (
          <button
            key={promptReactKey(prompt, index)}
            type="button"
            className="chorus-suggested-prompt"
            onClick={() => { if (!disabled) onSuggestedPrompt?.(prompt); }}
            disabled={disabled}
            aria-disabled={disabled || undefined}
            title={disabled ? disabledReason : undefined}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

export function attachMessageRootProps<TMessageProps extends { 'data-chorus-message-id': string }>(node: React.ReactNode, messageProps: TMessageProps) {
  if (!React.isValidElement(node) || typeof node.type !== 'string') return node;

  const props = node.props as Partial<TMessageProps>;
  if (props['data-chorus-message-id'] != null) return node;

  return React.cloneElement(
    node as React.ReactElement<Record<string, unknown>>,
    messageProps as unknown as Partial<Record<string, unknown>>,
  );
}
