import type { Message, StorageAdapter } from '../../types';

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  /** True until the title is user-modified or auto-renamed from the first message. */
  pristine?: boolean;
}

export type ConversationStorageOperation = 'read' | 'write' | 'delete';

export interface ConversationStorageError extends Error {
  key: string;
  operation: ConversationStorageOperation;
  conversationId?: string;
  cause?: unknown;
}

export interface RenameFromFirstMessageOptions {
  /** Rename even when the conversation is no longer pristine. Defaults to false. */
  overwrite?: boolean;
  /** Maximum generated title length before adding an ellipsis. Defaults to 48. */
  maxLength?: number;
  /** Used when no eligible non-empty message text exists. */
  fallbackTitle?: string;
  /**
   * Message roles eligible to source the generated title, scanned in `messages`
   * order. Defaults to `['user']`. Pass `['assistant']` to title an
   * assistant-first conversation (system prompt + assistant greeting, no user
   * reply yet), or `['user', 'assistant']` to title from whichever non-empty
   * message of those roles appears first.
   */
  includeRoles?: Message['role'][];
}

export interface UseConversationsOptions {
  /** Storage used for both the conversation index and per-conversation messages. Defaults to localStorage. */
  storage?: StorageAdapter | null;
  /** Storage key for the serialized conversation index. */
  indexKey?: string;
  /** Prefix used to derive each conversation's message persistence key. */
  messageKeyPrefix?: string;
  /** Preferred active conversation after the index loads. */
  initialActiveId?: string | null;
  /** Default title for createConversation() when no title is supplied. */
  defaultTitle?: string;
  /** Deterministic ID hook for tests or app-specific IDs. */
  createId?: () => string;
  /** Deterministic timestamp hook for tests. */
  now?: () => Date | string | number;
  /** Called when the index or a transcript delete fails to read/write/delete. */
  onError?: (error: ConversationStorageError) => void;
}

export interface UseConversationsResult {
  conversations: ConversationSummary[];
  activeId: string | null;
  activeConversation: ConversationSummary | null;
  /**
   * Persistence key for the active conversation, suitable for <Chorus persistenceKey>.
   * Empty (`''`) while `loaded` is false — there is no active conversation until the
   * index read resolves. See `loaded` for the message-drop hazard this creates.
   */
  activePersistenceKey: string;
  /** Storage wrapper suitable for <Chorus persistenceStorage>; message writes update conversation timestamps. */
  storage: StorageAdapter | null;
  /**
   * False while an async conversation index read is pending. Gate custom sidebars
   * on this — and gate message sending too.
   *
   * While `loaded` is false there is no active conversation, so `activePersistenceKey`
   * is `''`. A message sent in that window has no transcript key to persist to:
   * `<Chorus>` mounts `useChorusPersistence('')`, whose `onChange` drops the message
   * silently — it is not even queued as a pending pre-load change. The user loses
   * the message with no error. Disable the composer (or the whole `<Chorus>` widget)
   * until `loaded` is true so a conversation exists before the user can send.
   */
  loaded: boolean;
  /** Last conversation storage error, if any. */
  error: ConversationStorageError | null;
  getPersistenceKey: (id: string) => string;
  /** Creates immediately once loaded; pre-load creates are queued and merged after the index read. */
  createConversation: (title?: string) => string;
  selectConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  renameFromFirstMessage: (id: string, messages: Pick<Message, 'role' | 'text'>[], options?: RenameFromFirstMessageOptions) => void;
  deleteConversation: (id: string) => void;
  pinConversation: (id: string, pinned?: boolean) => void;
}
