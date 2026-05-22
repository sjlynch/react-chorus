import type { Message, StorageAdapter } from '../../types';
import type { ChorusPersistenceError, DeserializeMessages } from './types';
import { createPersistenceError } from './errors';
import { validateStoredMessages, warnNonArrayPayload } from './messageValidation';

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

/**
 * Default deserializer for persisted Chorus messages. Parses JSON, then validates each
 * entry against the public `Message` contract and drops invalid entries (with a dev
 * warning listing what was dropped) so a corrupted payload cannot crash rendering.
 *
 * Invalid entries dropped here include: non-object entries, missing or blank `id`,
 * unknown `role`, non-string `createdAt`, non-string `text` on non-tool messages,
 * tool messages without a valid `toolCall` (object with non-blank `name`), and
 * attachments on roles that do not support them. A non-array payload (e.g. a
 * `{"messages":[...]}` object) loads as empty with a dev warning, so a silently
 * unreadable transcript is not mistaken for an empty one. Pass a custom
 * `deserializeMessages` to take over validation; the
 * persistence hook still applies an array guard (with the same dev warning) to whatever
 * the custom hook returns.
 */
export function defaultDeserializeMessages<TMeta>(raw: string): Message<TMeta>[] {
  const parsed = JSON.parse(raw) as unknown;
  return validateStoredMessages<TMeta>(parsed);
}

export function parseStoredMessages<TMeta = Record<string, unknown>>(
  key: string,
  raw: string | null,
  deserializeMessages: DeserializeMessages<TMeta>,
): ParsedStoredMessages<TMeta> {
  if (!raw) return { messages: [], error: null };
  try {
    const parsed = deserializeMessages(raw);
    if (!Array.isArray(parsed)) {
      warnNonArrayPayload(parsed);
      return { messages: [], error: null };
    }
    return { messages: parsed, error: null };
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
