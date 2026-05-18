import type React from 'react';
import type { ChorusLabels } from '../../labels/types';
import type { Message, Role } from '../../types';
import type { MarkdownSanitizer } from '../Markdown';
import type { GetMessageFeedback, MessageBubbleSlots, MessageCopyResult, MessageFeedback, MessageMarkdownProps, MessageRenderActions } from '../MessageRow';

export interface RenderErrorContext {
  error: string;
  rawError: Error | null;
  retry: () => void;
  dismiss: () => void;
}

export interface RenderMessageRootProps {
  'data-chorus-message-id': string;
}

export interface RenderMessageContext<TMeta = Record<string, unknown>> {
  isStreaming: boolean;
  /**
   * True while this message's built-in inline editor is active. Skip rendering your own bubble/content
   * when true so the editor replaces the row instead of rendering alongside the original content.
   */
  isEditing: boolean;
  defaultRender: (slots?: MessageBubbleSlots) => React.ReactNode;
  actions: MessageRenderActions;
  message: Message<TMeta>;
  /** Spread on a custom row root so ChorusRef.scrollToMessage can target it. */
  messageProps: RenderMessageRootProps;
}

export interface ChatWindowProps<TMeta = Record<string, unknown>> extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onCopy'> {
  codeTheme?: 'dark' | 'light';
  emptyState?: React.ReactNode;
  error?: string | null;
  headless?: boolean;
  /** Message roles hidden from the transcript. Defaults to ['system', 'tool']; pass ['system'] to show tool calls while hiding system prompts, or [] to show every role. */
  hiddenRoles?: Role[];
  /** Props forwarded to the built-in Markdown renderer for message text. */
  markdownProps?: MessageMarkdownProps;
  /** Convenience alias for markdownProps.sanitizer. Takes precedence when both are provided. */
  markdownSanitizer?: MarkdownSanitizer;
  /** Render only the latest N visible messages. Typing and error rows still render outside this message window. */
  maxRenderedMessages?: number;
  messages: Message<TMeta>[];
  /** Return a persisted feedback selection for a message. If omitted or undefined, message.metadata.feedback seeds the built-in thumb state when it is 'up' or 'down'. */
  getMessageFeedback?: GetMessageFeedback<TMeta>;
  /**
   * Overrides the built-in per-message Copy action. Return false (or Promise<false>)
   * to show the Copy failed indicator; return void to keep historical assume-success behavior.
   */
  onCopy?: (message: Message<TMeta>) => MessageCopyResult;
  onDelete?: (id: string) => void;
  onDismissError?: () => void;
  onEdit?: (id: string, newText: string) => void;
  /** Built-in controls call this only when the chosen variant differs from the current selection; clicks do not toggle feedback off. */
  onFeedback?: (message: Message<TMeta>, feedback: MessageFeedback) => void;
  onRegenerate?: (id: string) => void;
  onRetry?: () => void;
  onSuggestedPrompt?: (prompt: string) => void;
  rawError?: Error | null;
  renderError?: (context: RenderErrorContext) => React.ReactNode;
  renderMessage?: (message: Message<TMeta>, context: RenderMessageContext<TMeta>) => React.ReactNode;
  showJumpToBottomButton?: boolean;
  /** @deprecated Use hiddenRoles instead. When hiddenRoles is omitted, true is equivalent to hiddenRoles={[]} and false keeps the default ['system', 'tool']. */
  showSystemMessages?: boolean;
  /** Internal optimization hint: render the active assistant message as escaped plain text until it finalizes. */
  streamingMessageId?: string | null;
  suggestedPrompts?: string[];
  /** Disable default empty-state prompt buttons without hiding them. */
  suggestedPromptsDisabled?: boolean;
  suggestedPromptsDisabledReason?: string;
  typing?: boolean;
  /** Localized labels for the transcript, message actions, speakers, tool calls, reasoning, and code copy. Defaults to English. */
  labels?: ChorusLabels;
}
