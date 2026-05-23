import type { Message } from '../../types';
import { defaultFormatMessageTimestamp } from './formatTimestamp';
import type { MessageTimestampFormatter } from './types';

export interface MessageTimestampProps<TMeta = Record<string, unknown>> {
  message: Message<TMeta>;
  formatTimestamp?: MessageTimestampFormatter<TMeta>;
}

/**
 * Renders a message's `createdAt` time as a `<time>` element. Returns null when the
 * message has no `createdAt`, so callers can mount it unconditionally behind a
 * `showTimestamps` flag without first checking for the field.
 */
export function MessageTimestamp<TMeta = Record<string, unknown>>({ message, formatTimestamp }: MessageTimestampProps<TMeta>) {
  const createdAt = message.createdAt;
  if (typeof createdAt !== 'string' || createdAt.length === 0) return null;

  const format = formatTimestamp ?? defaultFormatMessageTimestamp;
  return <time className="chorus-msg-time" dateTime={createdAt}>{format(createdAt, message)}</time>;
}
