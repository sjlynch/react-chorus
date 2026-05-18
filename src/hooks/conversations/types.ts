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
  /** Used when no non-empty user message text exists. */
  fallbackTitle?: string;
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
  /** Persistence key for the active conversation, suitable for <Chorus persistenceKey>. */
  activePersistenceKey: string;
  /** Storage wrapper suitable for <Chorus persistenceStorage>; message writes update conversation timestamps. */
  storage: StorageAdapter | null;
  /** False while an async conversation index read is pending; gate custom sidebars on this. */
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
