import type { ConversationStorageError, ConversationStorageOperation } from './types';
import { wrapError } from '../../utils/errors';

// Non-enumerable brand stamped on every error this module produces. `isConversationStorageError`
// checks the brand instead of duck-typing `'operation'`/`'key'` fields: a custom async
// `StorageAdapter` (e.g. a remote backend) can reject with its own error carrying `key`
// and `operation` properties, and a structural check would mistake that foreign error
// for an already-wrapped Chorus error — passing it through `reportError` without
// `wrapError` and with the adapter's own (wrong) `operation`. Being a symbol it cannot
// collide with adapter fields; being non-enumerable it stays out of JSON output.
const CONVERSATION_STORAGE_ERROR_BRAND = Symbol('chorus.conversationStorageError');

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
  Object.defineProperty(nextError, CONVERSATION_STORAGE_ERROR_BRAND, { value: true });
  return nextError;
}

export function isConversationStorageError(error: unknown): error is ConversationStorageError {
  return typeof error === 'object'
    && error !== null
    && (error as Record<symbol, unknown>)[CONVERSATION_STORAGE_ERROR_BRAND] === true;
}
