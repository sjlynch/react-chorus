import type { Message } from '../../types';

const objectActivityIds = new WeakMap<object, number>();
let nextObjectActivityId = 1;

function objectActivityKey(value: object) {
  let id = objectActivityIds.get(value);
  if (!id) {
    id = nextObjectActivityId;
    nextObjectActivityId += 1;
    objectActivityIds.set(value, id);
  }
  return `o:${id}`;
}

function codePointHash(value: string) {
  let hash = 0x811c9dc5;

  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(36);
}

export function stringActivityKey(value: string) {
  const codePoints = Array.from(value);
  return `s:${value.length}:${codePoints.length}:${codePointHash(value)}:${codePoints.slice(0, 24).join('')}:${codePoints.slice(-24).join('')}`;
}

export function unknownActivityKey(value: unknown): string {
  if (value == null) return 'null';
  if (typeof value === 'string') return stringActivityKey(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return `${typeof value}:${String(value)}`;
  if (typeof value === 'symbol') return `symbol:${String(value.description ?? '')}`;
  if (typeof value === 'function') return objectActivityKey(value);
  if (typeof value === 'object') return objectActivityKey(value);
  return typeof value;
}

export function attachmentActivityKey(attachment: NonNullable<Message['attachments']>[number]) {
  const source = attachment.url ?? attachment.id ?? attachment.data ?? '';
  return [
    attachment.name,
    attachment.type,
    attachment.size,
    stringActivityKey(source),
    unknownActivityKey(attachment.metadata),
  ].join(',');
}

export function messageActivityKey<TMeta>(message: Message<TMeta>) {
  const toolCall = message.toolCall;
  return [
    message.id,
    message.role,
    stringActivityKey(message.text ?? ''),
    stringActivityKey(message.reasoning ?? ''),
    message.attachments?.length ?? 0,
    ...(message.attachments?.map(attachmentActivityKey) ?? []),
    toolCall?.id ?? '',
    toolCall?.name ?? '',
    toolCall && Object.prototype.hasOwnProperty.call(toolCall, 'input') ? 'input' : '',
    unknownActivityKey(toolCall?.input),
    toolCall && Object.prototype.hasOwnProperty.call(toolCall, 'output') ? 'output' : '',
    unknownActivityKey(toolCall?.output),
  ].join('~');
}

export function visibleActivityKey<TMeta>(visible: Message<TMeta>[], typing: boolean | undefined, streamingMessageId: string | null | undefined, error: string | null | undefined) {
  return [
    visible.length,
    ...visible.map(messageActivityKey),
    typing ? 'typing' : '',
    streamingMessageId ?? '',
    error ?? '',
  ].join('|');
}
