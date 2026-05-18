import type { ReactNode } from 'react';
import type { MessageFeedback } from '../../types';
import type { MarkdownProps } from '../Markdown';

export type MessageMarkdownProps = Omit<MarkdownProps, 'text' | 'codeTheme' | 'headless' | 'streaming'>;

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
  edit?: (newText: string) => void;
  regenerate?: () => void;
  delete?: () => void;
  copy?: () => MessageCopyResult;
  /** Called when the user chooses a different feedback variant. Built-in controls ignore repeat clicks on the selected variant. */
  feedback?: (variant: MessageFeedback) => void;
  /** Current persisted feedback selection used to seed the built-in thumb state. */
  initialFeedback?: MessageFeedback | null;
  defaultRender: () => ReactNode;
}
