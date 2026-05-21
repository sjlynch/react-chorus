import type { ChorusPersistenceError, PersistenceOperation } from './types';
import { wrapError } from '../../utils/errors';
import { warnInDev } from '../../utils/warnings';

export function createPersistenceError(key: string, operation: PersistenceOperation, error: unknown): ChorusPersistenceError {
  // wrapError returns a fresh Error every time (with the original kept as
  // `cause`), so the metadata assignments below never touch a shared/frozen
  // source error and never overwrite its `cause` with a self-reference.
  const nextError = wrapError(error) as ChorusPersistenceError;
  nextError.key = key;
  nextError.operation = operation;
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
