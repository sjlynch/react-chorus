import type React from 'react';
import type { ConversationSummary } from '../../hooks/useConversations';
import type { ChorusConversationListLabels } from '../../labels/types';
import type { Palette } from '../ChorusTheme';

export interface ConfirmDeleteConversationContext {
  conversation: ConversationSummary;
  conversations: ConversationSummary[];
  activeId: string | null;
}

export type ConfirmDeleteConversation = (context: ConfirmDeleteConversationContext) => boolean | void | Promise<boolean | void>;

export interface ConversationListProps {
  conversations: ConversationSummary[];
  activeId?: string | null;
  createConversation?: (title?: string) => string | void;
  selectConversation?: (id: string) => void;
  renameConversation?: (id: string, title: string) => void;
  deleteConversation?: (id: string) => void;
  /** Optional gate for built-in conversation deletes. Return or resolve false to cancel. */
  confirmDeleteConversation?: ConfirmDeleteConversation;
  pinConversation?: (id: string, pinned?: boolean) => void;
  /** Disable conversation mutations while async conversation storage is loading. */
  loaded?: boolean;
  formatTimestamp?: (timestamp: string, conversation: ConversationSummary) => React.ReactNode;
  /**
   * Theme palette applied as `--chorus-*` CSS variables on the sidebar root.
   * Equivalent to wrapping this component in `<ChorusTheme palette={…}>`. When
   * it is nested inside another `<Chorus palette>` or `<ChorusTheme>`, the
   * nearest ancestor that sets a given variable wins per the normal CSS cascade.
   */
  palette?: Palette;
  headless?: boolean;
  className?: string;
  style?: React.CSSProperties;
  newConversationLabel?: string;
  emptyLabel?: string;
  /**
   * Localized labels for the conversation sidebar. Existing `newConversationLabel`
   * and `emptyLabel` props take precedence so adding `labels` is non-breaking.
   */
  labels?: ChorusConversationListLabels;
}
