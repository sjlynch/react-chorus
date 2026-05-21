import React from 'react';
import { DEFAULT_TRANSCRIPT_LABELS } from '../../labels/transcript';
import { isChorusDevMode } from '../../utils/devMode';
import { MessageBubble, MessageRow } from '../MessageRow';

// `renderMessage` roots that are react-chorus components rendering their own
// `data-chorus-message-id` scroll target (directly or via a nested bubble).
// Returning one of these — or `ctx.defaultRender()`, which is a `MessageRow` —
// does not break `ChorusRef.scrollToMessage`, so it must not trigger a warning.
const SELF_TAGGING_MESSAGE_ROOTS: ReadonlySet<unknown> = new Set([MessageBubble, MessageRow]);

// Once-guard for the warning below; the dev-mode gate is the shared
// `isChorusDevMode` from `src/utils/devMode.ts` (a zero-dependency leaf).
let didWarnNonHostMessageRoot = false;
function warnNonHostMessageRootOnce(message: string) {
  if (didWarnNonHostMessageRoot || !isChorusDevMode()) return;
  didWarnNonHostMessageRoot = true;
  console.warn(message);
}

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
  if (!React.isValidElement(node)) return node;

  const props = node.props as Partial<TMessageProps>;
  const alreadyTagged = props['data-chorus-message-id'] != null;

  // A custom component (or Fragment) as the message root cannot be tagged here:
  // we cannot know which DOM node it ultimately renders, and cloning would only
  // pass `data-chorus-message-id` as a prop the component most likely ignores.
  // Warn (once) so the host knows `ChorusRef.scrollToMessage(id)` will not be
  // able to find this row — unless the id is already covered: the host either
  // forwarded it onto the root themselves, returned a Fragment (the README
  // `<MessageBubble/>` + actions pattern), or returned a self-tagging
  // react-chorus component.
  if (typeof node.type !== 'string') {
    const coversScrollTarget = alreadyTagged
      || node.type === React.Fragment
      || SELF_TAGGING_MESSAGE_ROOTS.has(node.type);
    if (!coversScrollTarget) {
      warnNonHostMessageRootOnce(
        '[react-chorus] renderMessage returned a custom component as the message root, so '
          + 'data-chorus-message-id could not be attached and ChorusRef.scrollToMessage(id) '
          + 'cannot scroll to this message. Spread ctx.messageProps onto a DOM element (e.g. '
          + 'the outermost <div>) in your renderMessage output.',
      );
    }
    return node;
  }

  if (alreadyTagged) return node;

  return React.cloneElement(
    node as React.ReactElement<Record<string, unknown>>,
    messageProps as unknown as Partial<Record<string, unknown>>,
  );
}
