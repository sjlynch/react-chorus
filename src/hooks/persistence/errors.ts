import type { ChorusPersistenceError, PersistenceOperation } from './types';
import { wrapError } from '../../utils/errors';
import { warnInDev } from '../../utils/warnings';

// Non-enumerable brand stamped on every error this module produces. `isPersistenceError`
// checks the brand instead of duck-typing `'operation'`/`'key'` fields: a custom async
// `StorageAdapter` (e.g. a remote backend) can reject with its own error carrying `key`
// and `operation` properties, and a structural check would mistake that foreign error
// for an already-wrapped Chorus error — passing it through `reportPersistenceError`
// without `wrapError` and with the adapter's own (wrong) `operation`. Being a symbol it
// cannot collide with adapter fields; being non-enumerable it stays out of JSON output.
const PERSISTENCE_ERROR_BRAND = Symbol('chorus.persistenceError');

export function createPersistenceError(key: string, operation: PersistenceOperation, error: unknown): ChorusPersistenceError {
  // wrapError returns a fresh Error every time (with the original kept as
  // `cause`), so the metadata assignments below never touch a shared/frozen
  // source error and never overwrite its `cause` with a self-reference.
  const nextError = wrapError(error) as ChorusPersistenceError;
  nextError.key = key;
  nextError.operation = operation;
  Object.defineProperty(nextError, PERSISTENCE_ERROR_BRAND, { value: true });
  return nextError;
}

export function isPersistenceError(error: unknown): error is ChorusPersistenceError {
  return typeof error === 'object'
    && error !== null
    && (error as Record<symbol, unknown>)[PERSISTENCE_ERROR_BRAND] === true;
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
