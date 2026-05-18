import type { Message, StorageAdapter } from '../../types';

export type SerializeMessages<TMeta = Record<string, unknown>> = (messages: Message<TMeta>[]) => string;
export type DeserializeMessages<TMeta = Record<string, unknown>> = (raw: string) => Message<TMeta>[];
export type PersistenceOperation = 'read' | 'deserialize' | 'write' | 'remove';

export interface ChorusPersistenceError extends Error {
  key: string;
  operation: PersistenceOperation;
  cause?: unknown;
}

export interface UseChorusPersistenceOptions<TMeta = Record<string, unknown>> {
  storage?: StorageAdapter | null;
  /** Debounce storage writes by this many milliseconds. Defaults to 0 for immediate writes. */
  writeDebounceMs?: number;
  /** Called when a persistence read, deserialization, write, or remove operation fails. */
  onError?: (error: ChorusPersistenceError) => void;
  /** Override message serialization. Defaults to JSON.stringify(messages). */
  serializeMessages?: SerializeMessages<TMeta>;
  /**
   * Override message deserialization. Defaults to JSON.parse followed by validating
   * each entry against the public Message contract: entries with missing/empty id,
   * unknown role, wrong-typed text, missing/invalid toolCall on tool messages, or
   * attachments on roles that do not support them are dropped (with a dev warning).
   * Custom deserializers are responsible for their own validation; the hook still
   * applies an array guard to whatever they return.
   */
  deserializeMessages?: DeserializeMessages<TMeta>;
}

export interface PersistenceWriteOptions {
  /** Flush this update to storage immediately instead of waiting for the debounce window. */
  flush?: boolean;
  /** Remove the storage key when this write is an empty message list and removeItem is available. */
  removeIfEmpty?: boolean;
}

export interface UseChorusPersistenceResult<TMeta = Record<string, unknown>> {
  value: Message<TMeta>[];
  onChange: (messages: Message<TMeta>[], options?: PersistenceWriteOptions) => void;
  /** Flushes the latest debounced write, if one is pending. */
  flush: () => void;
  /** Last persistence error, if any. Cleared after the latest successful read or write for the current source. */
  error: ChorusPersistenceError | null;
  /** True once the current key/storage pair has completed its initial read. */
  loaded: boolean;
  /** True when storage already had a value for the key, or this hook has written one. */
  hasStoredValue: boolean;
  /** False when the key is empty or storage is unavailable. */
  canPersist: boolean;
}
