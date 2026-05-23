import type { Attachment, Message, Role, ToolCall } from '../../types';
import { warnInDev } from '../../utils/warnings';

export const VALID_ROLES: ReadonlySet<Role> = new Set<Role>(['user', 'assistant', 'system', 'tool']);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidAttachment(value: unknown): value is Attachment {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.data === 'string' &&
    typeof value.size === 'number'
  );
}

export function isValidToolCall(value: unknown): value is ToolCall {
  if (!isPlainObject(value)) return false;
  // Trim before the emptiness check: a whitespace-only name (e.g. '   ') survives
  // a bare `.length > 0` test but is useless downstream — `metadataWithToolError`
  // and `runCompletedToolCalls` look up handlers by name and would silently miss.
  return typeof value.name === 'string' && value.name.trim().length > 0;
}

/**
 * Validates a single deserialized message against the public `Message` contract.
 *
 * Returns the message (typed) when valid, or a string describing why it was rejected.
 * Rejection reasons:
 * - id missing, not a string, or blank (empty or whitespace-only)
 * - role not one of 'user' | 'assistant' | 'system' | 'tool'
 * - `createdAt` present and not a string (the public contract is an ISO-8601 string)
 * - non-tool message has non-string `text`
 * - tool message missing a valid `toolCall` (must be an object with a non-blank `name`)
 * - attachments on a role that does not support them (system, tool), or not an Attachment[]
 * - `toolCall` set on a non-tool role
 */
export function validateStoredMessage<TMeta>(value: unknown): { ok: true; message: Message<TMeta> } | { ok: false; reason: string } {
  if (!isPlainObject(value)) return { ok: false, reason: 'entry is not an object' };
  // Trim before the emptiness check: a whitespace-only id (e.g. '   ') survives
  // a bare `.length === 0` test but is useless downstream — it reaches render
  // and `warnDuplicateMessageIds`, where two such entries collide as duplicates.
  // `isConversationSummary` in conversations/sanitize.ts trims the same way.
  if (typeof value.id !== 'string' || value.id.trim().length === 0) return { ok: false, reason: 'missing or empty id' };
  if (typeof value.role !== 'string' || !VALID_ROLES.has(value.role as Role)) {
    return { ok: false, reason: `invalid role: ${String(value.role)}` };
  }

  // `createdAt` is optional, but when present the public contract is an
  // ISO-8601 string. A number or object survives JSON round-trips yet renders
  // as `Invalid Date` under `<Chorus showTimestamps>`, so reject it here —
  // mirroring the per-role `reasoning` checks below. Applies to every role.
  if (value.createdAt !== undefined && typeof value.createdAt !== 'string') {
    return { ok: false, reason: 'createdAt is not a string' };
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

/**
 * Warns (in dev) when a stored payload deserialized to something other than an
 * array — e.g. a `{"messages":[...]}` object written by a different tool or an
 * older format the host migrated. `null`/`undefined` means "nothing stored" and
 * stays silent; any other non-array value loudly signals the transcript was
 * dropped, matching the dev-warning discipline for invalid message entries.
 */
export function warnNonArrayPayload(parsed: unknown): void {
  if (parsed === null || parsed === undefined) return;
  warnInDev(
    `[Chorus] Expected an array of persisted messages, got ${typeof parsed}; treating as empty.`,
  );
}

export function validateStoredMessages<TMeta>(parsed: unknown): Message<TMeta>[] {
  if (!Array.isArray(parsed)) {
    warnNonArrayPayload(parsed);
    return [];
  }

  const valid: Message<TMeta>[] = [];
  const dropped: Array<{ index: number; id?: string; reason: string }> = [];

  parsed.forEach((entry, index) => {
    const result = validateStoredMessage<TMeta>(entry);
    if (result.ok) {
      valid.push(result.message);
      return;
    }
    // Surface the message id alongside the index so the dev warning identifies
    // *which* persisted entry was dropped, not just its array position.
    const id = isPlainObject(entry) && typeof entry.id === 'string' ? entry.id : undefined;
    dropped.push(id === undefined ? { index, reason: result.reason } : { index, id, reason: result.reason });
  });

  if (dropped.length > 0) {
    warnInDev(
      `[Chorus] Dropped ${dropped.length} invalid persisted message${dropped.length === 1 ? '' : 's'} during deserialization.`,
      dropped,
    );
  }

  return valid;
}
