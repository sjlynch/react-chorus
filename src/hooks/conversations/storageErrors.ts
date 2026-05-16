import type { ConversationStorageError, ConversationStorageOperation } from '../useConversations';
import { toError } from '../../utils/errors';

export function createConversationStorageError(
  key: string,
  operation: ConversationStorageOperation,
  error: unknown,
  conversationId?: string,
): ConversationStorageError {
  const nextError = toError(error) as ConversationStorageError;
  nextError.key = key;
  nextError.operation = operation;
  nextError.conversationId = conversationId;
  nextError.cause = error;
  return nextError;
}

export function isConversationStorageError(error: unknown): error is ConversationStorageError {
  return Boolean(error && typeof error === 'object' && 'operation' in error && 'key' in error);
}
