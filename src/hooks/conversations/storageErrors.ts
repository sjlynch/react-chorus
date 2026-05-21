import type { ConversationStorageError, ConversationStorageOperation } from './types';
import { wrapError } from '../../utils/errors';

export function createConversationStorageError(
  key: string,
  operation: ConversationStorageOperation,
  error: unknown,
  conversationId?: string,
): ConversationStorageError {
  // wrapError returns a fresh Error every time (with the original kept as
  // `cause`), so attaching metadata here never mutates a shared/frozen
  // DOMException and never clobbers the original's `cause` with a self-reference.
  const nextError = wrapError(error) as ConversationStorageError;
  nextError.key = key;
  nextError.operation = operation;
  nextError.conversationId = conversationId;
  return nextError;
}

export function isConversationStorageError(error: unknown): error is ConversationStorageError {
  return Boolean(error && typeof error === 'object' && 'operation' in error && 'key' in error);
}
