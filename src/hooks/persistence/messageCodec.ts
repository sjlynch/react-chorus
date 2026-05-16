import type { Message, StorageAdapter } from '../../types';
import type { ChorusPersistenceError, DeserializeMessages } from '../useChorusPersistence';
import { createPersistenceError } from './errors';

export interface PersistenceState<TMeta = Record<string, unknown>> {
  key: string;
  storage: StorageAdapter | null;
  value: Message<TMeta>[];
  loaded: boolean;
  hasStoredValue: boolean;
}

export interface ParsedStoredMessages<TMeta = Record<string, unknown>> {
  messages: Message<TMeta>[];
  error: ChorusPersistenceError | null;
}

export interface ParsedPersistenceState<TMeta = Record<string, unknown>> {
  state: PersistenceState<TMeta>;
  error: ChorusPersistenceError | null;
}

export function defaultSerializeMessages<TMeta>(messages: Message<TMeta>[]): string {
  const serialized = JSON.stringify(messages);
  if (serialized === undefined) throw new Error('Unable to serialize messages.');
  return serialized;
}

export function defaultDeserializeMessages<TMeta>(raw: string): Message<TMeta>[] {
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed as Message<TMeta>[] : [];
}

export function parseStoredMessages<TMeta = Record<string, unknown>>(
  key: string,
  raw: string | null,
  deserializeMessages: DeserializeMessages<TMeta>,
): ParsedStoredMessages<TMeta> {
  if (!raw) return { messages: [], error: null };
  try {
    const parsed = deserializeMessages(raw);
    return { messages: Array.isArray(parsed) ? parsed : [], error: null };
  } catch (error) {
    return { messages: [], error: createPersistenceError(key, 'deserialize', error) };
  }
}

export function emptyState<TMeta>(key: string, storage: StorageAdapter | null, loaded: boolean): PersistenceState<TMeta> {
  return { key, storage, value: [], loaded, hasStoredValue: false };
}

export function stateFromRaw<TMeta>(
  key: string,
  storage: StorageAdapter | null,
  raw: string | null,
  deserializeMessages: DeserializeMessages<TMeta>,
): ParsedPersistenceState<TMeta> {
  const parsed = parseStoredMessages<TMeta>(key, raw, deserializeMessages);
  return {
    state: {
      key,
      storage,
      value: parsed.messages,
      loaded: true,
      hasStoredValue: raw !== null,
    },
    error: parsed.error,
  };
}
