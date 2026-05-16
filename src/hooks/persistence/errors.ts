import type { ChorusPersistenceError, PersistenceOperation } from '../useChorusPersistence';
import { toError } from '../../utils/errors';
import { warnInDev } from '../../utils/warnings';

export function createPersistenceError(key: string, operation: PersistenceOperation, error: unknown): ChorusPersistenceError {
  const nextError = toError(error) as ChorusPersistenceError;
  nextError.key = key;
  nextError.operation = operation;
  nextError.cause = error;
  return nextError;
}

export function isPersistenceError(error: unknown): error is ChorusPersistenceError {
  return Boolean(error && typeof error === 'object' && 'operation' in error && 'key' in error);
}

export function describePersistenceOperation(operation: PersistenceOperation) {
  return operation === 'read'
    ? 'read persisted messages'
    : operation === 'deserialize'
      ? 'deserialize persisted messages'
      : operation === 'remove'
        ? 'remove persisted messages'
        : 'persist messages';
}

export function warnPersistenceError(nextError: ChorusPersistenceError) {
  warnInDev(`[Chorus] Failed to ${describePersistenceOperation(nextError.operation)}.`, nextError);
}
