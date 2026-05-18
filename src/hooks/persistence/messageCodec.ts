import type { Attachment, Message, Role, StorageAdapter, ToolCall } from '../../types';
import type { ChorusPersistenceError, DeserializeMessages } from '../useChorusPersistence';
import { warnInDev } from '../../utils/warnings';
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

const VALID_ROLES: ReadonlySet<Role> = new Set<Role>(['user', 'assistant', 'system', 'tool']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidAttachment(value: unknown): value is Attachment {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.data === 'string' &&
    typeof value.size === 'number'
  );
}

function isValidToolCall(value: unknown): value is ToolCall {
  if (!isPlainObject(value)) return false;
  return typeof value.name === 'string' && value.name.length > 0;
}

/**
 * Validates a single deserialized message against the public `Message` contract.
 *
 * Returns the message (typed) when valid, or a string describing why it was rejected.
 * Rejection reasons:
 * - id missing or not a non-empty string
 * - role not one of 'user' | 'assistant' | 'system' | 'tool'
 * - non-tool message has non-string `text`
 * - tool message missing a valid `toolCall` (must be an object with a non-empty `name`)
 * - attachments on a role that does not support them (system, tool), or not an Attachment[]
 * - `toolCall` set on a non-tool role
 */
function validateStoredMessage<TMeta>(value: unknown): { ok: true; message: Message<TMeta> } | { ok: false; reason: string } {
  if (!isPlainObject(value)) return { ok: false, reason: 'entry is not an object' };
  if (typeof value.id !== 'string' || value.id.length === 0) return { ok: false, reason: 'missing or empty id' };
  if (typeof value.role !== 'string' || !VALID_ROLES.has(value.role as Role)) {
    return { ok: false, reason: `invalid role: ${String(value.role)}` };
  }

  const role = value.role as Role;

  if (role === 'tool') {
    if (!isValidToolCall(value.toolCall)) return { ok: false, reason: 'tool message missing a valid toolCall' };
    if (value.text !== undefined && typeof value.text !== 'string') return { ok: false, reason: 'tool message has non-string text' };
    if (value.reasoning !== undefined && typeof value.reasoning !== 'string') return { ok: false, reason: 'tool message has non-string reasoning' };
    if (value.attachments !== undefined) return { ok: false, reason: 'tool messages do not support attachments' };
    return { ok: true, message: value as unknown as Message<TMeta> };
  }

  if (typeof value.text !== 'string') return { ok: false, reason: `${role} message has non-string text` };
  if (value.reasoning !== undefined && typeof value.reasoning !== 'string') return { ok: false, reason: `${role} message has non-string reasoning` };
  if (value.toolCall !== undefined) return { ok: false, reason: `${role} message must not carry toolCall` };

  if (value.attachments !== undefined) {
    if (role === 'system') return { ok: false, reason: 'system messages do not support attachments' };
    if (!Array.isArray(value.attachments) || !value.attachments.every(isValidAttachment)) {
      return { ok: false, reason: `${role} message has invalid attachments` };
    }
  }

  return { ok: true, message: value as unknown as Message<TMeta> };
}

function validateStoredMessages<TMeta>(parsed: unknown): Message<TMeta>[] {
  if (!Array.isArray(parsed)) return [];

  const valid: Message<TMeta>[] = [];
  const dropped: Array<{ index: number; reason: string }> = [];

  parsed.forEach((entry, index) => {
    const result = validateStoredMessage<TMeta>(entry);
    if (result.ok) valid.push(result.message);
    else dropped.push({ index, reason: result.reason });
  });

  if (dropped.length > 0) {
    warnInDev(
      `[Chorus] Dropped ${dropped.length} invalid persisted message${dropped.length === 1 ? '' : 's'} during deserialization.`,
      dropped,
    );
  }

  return valid;
}

/**
 * Default deserializer for persisted Chorus messages. Parses JSON, then validates each
 * entry against the public `Message` contract and drops invalid entries (with a dev
 * warning listing what was dropped) so a corrupted payload cannot crash rendering.
 *
 * Invalid entries dropped here include: non-object entries, missing or empty `id`,
 * unknown `role`, non-string `text` on non-tool messages, tool messages without a
 * valid `toolCall` (object with non-empty `name`), and attachments on roles that do
 * not support them. Pass a custom `deserializeMessages` to take over validation; the
 * persistence hook still applies an array guard to whatever the custom hook returns.
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
