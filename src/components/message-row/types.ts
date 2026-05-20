import type { ReactNode } from 'react';
import type { Message, MessageFeedback } from '../../types';
import type { MarkdownProps } from '../Markdown';

export type MessageMarkdownProps = Omit<MarkdownProps, 'text' | 'codeTheme' | 'headless' | 'streaming'>;

/**
 * Formats a message's `createdAt` time for display when `<Chorus showTimestamps>` is enabled.
 * Receives the raw `createdAt` string and the message it belongs to.
 */
export type MessageTimestampFormatter<TMeta = Record<string, unknown>> = (
  timestamp: string,
  message: Message<TMeta>,
) => ReactNode;

export type {
  ChorusCodeCopyLabels,
  ChorusMessageActionLabels,
  ChorusSpeakerLabels,
  ChorusToolCallLabels,
} from '../../labels/types';

export interface MessageBubbleSlots {
  before?: ReactNode;
  headerSlot?: ReactNode;
  footerSlot?: ReactNode;
  after?: ReactNode;
}

export type MessageCopyResult = boolean | void | Promise<boolean | void>;

export interface MessageRenderActions {
  canEdit: boolean;
  canRegenerate: boolean;
  canDelete: boolean;
  /** Saves a message edit. The built-in inline editor calls this with a non-empty trimmed string. */
  edit?: (newText: string) => void;
  regenerate?: () => void;
  delete?: () => void;
  copy?: () => MessageCopyResult;
  /** Called when the user changes feedback. Receives `null` when the active thumb is clicked again to clear the rating. */
  feedback?: (variant: MessageFeedback | null) => void;
  /** Current persisted feedback selection used to seed the built-in thumb state. */
  initialFeedback?: MessageFeedback | null;
  /**
   * When true, built-in controls render `initialFeedback` as an inert thumb
   * (no button, no `feedback` wiring) so historical reactions stay visible
   * even though there is no handler to record new ones.
   */
  feedbackReadOnly?: boolean;
  defaultRender: () => ReactNode;
}
