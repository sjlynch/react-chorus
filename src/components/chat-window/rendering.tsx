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

export function DefaultEmptyState({
  prompts,
  onSuggestedPrompt,
  disabled = false,
  disabledReason,
  title = DEFAULT_TRANSCRIPT_LABELS.emptyStateTitle,
  ariaLabel = DEFAULT_TRANSCRIPT_LABELS.suggestedPromptsAriaLabel,
}: DefaultEmptyStateProps) {
  return (
    <div className="chorus-empty-state chorus-empty-state-default">
      <div className="chorus-empty-title">{title}</div>
      <div className="chorus-suggested-prompts" aria-label={ariaLabel}>
        {prompts.map(prompt => (
          <button
            key={prompt}
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
