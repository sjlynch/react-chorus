import React from 'react';
import type { ChorusTranscriptLabels } from '../../labels/types';
import { DefaultEmptyState } from './rendering';
import type { RenderErrorContext } from './types';

function noop() {}

export interface TranscriptEmptyStateProps {
  hasEmptyTranscript: boolean;
  emptyState?: React.ReactNode;
  suggestedPrompts?: string[];
  onSuggestedPrompt?: (prompt: string) => void;
  suggestedPromptsDisabled?: boolean;
  suggestedPromptsDisabledReason?: string;
  labels: ChorusTranscriptLabels;
}

export function TranscriptEmptyState({
  hasEmptyTranscript,
  emptyState,
  suggestedPrompts,
  onSuggestedPrompt,
  suggestedPromptsDisabled = false,
  suggestedPromptsDisabledReason,
  labels,
}: TranscriptEmptyStateProps) {
  if (!hasEmptyTranscript) return null;

  if (emptyState !== undefined) {
    return <div className="chorus-empty-state">{emptyState}</div>;
  }

  const suggestedPromptList = suggestedPrompts ?? [];
  if (suggestedPromptList.length === 0) return null;

  return (
    <DefaultEmptyState
      prompts={suggestedPromptList}
      onSuggestedPrompt={onSuggestedPrompt}
      disabled={suggestedPromptsDisabled}
      disabledReason={suggestedPromptsDisabledReason}
      title={labels.emptyStateTitle}
      ariaLabel={labels.suggestedPromptsAriaLabel}
    />
  );
}

export interface TypingRowProps {
  typing?: boolean;
  label: string;
}

export function TypingRow({ typing, label }: TypingRowProps) {
  if (!typing) return null;

  // No own live region: the transcript is the single `aria-live` region, so
  // appearing here is announced once. The label is carried as SR-only text
  // because the animated dots are decorative (`aria-hidden`).
  return (
    <div className="chorus-msg chorus-assistant chorus-typing">
      <span className="chorus-sr-only">{label}</span>
      <div className="chorus-bubble" aria-hidden="true"><span className="chorus-dot"></span><span className="chorus-dot"></span><span className="chorus-dot"></span></div>
    </div>
  );
}

export interface ErrorRowProps {
  error?: string | null;
  rawError: Error | null;
  retryLabel: string;
  onRetry?: () => void;
  onDismissError?: () => void;
  renderError?: (context: RenderErrorContext) => React.ReactNode;
}

export function ErrorRow({ error, rawError, retryLabel, onRetry, onDismissError, renderError }: ErrorRowProps) {
  if (!error) return null;

  if (renderError) {
    return <>{renderError({ error, rawError, retry: onRetry ?? noop, dismiss: onDismissError ?? noop })}</>;
  }

  // No own live region: the surrounding transcript is the single `aria-live`
  // region, so the error text is announced once when this row is added.
  return (
    <div className="chorus-error">
      <span className="chorus-error-text">{error}</span>
      {onRetry && <button type="button" className="chorus-retry-btn" onClick={onRetry}>{retryLabel}</button>}
    </div>
  );
}

export interface JumpToBottomButtonProps {
  show: boolean;
  label: string;
  onClick: () => void;
}

export function JumpToBottomButton({ show, label, onClick }: JumpToBottomButtonProps) {
  if (!show) return null;

  return (
    <button type="button" className="chorus-jump-to-bottom" onClick={onClick}>
      {label}
    </button>
  );
}
