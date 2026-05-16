import type { Message, MessageFeedback } from '../../types';

export type { MessageFeedback } from '../../types';
export type GetMessageFeedback<TMeta = Record<string, unknown>> = (message: Message<TMeta>) => MessageFeedback | null | undefined;

export function isMessageFeedback(value: unknown): value is MessageFeedback {
  return value === 'up' || value === 'down';
}

export function getMetadataFeedback<TMeta>(message: Message<TMeta>): MessageFeedback | null {
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== 'object') return null;

  const feedback = (metadata as { feedback?: unknown }).feedback;
  return isMessageFeedback(feedback) ? feedback : null;
}

export function getInitialMessageFeedback<TMeta>(message: Message<TMeta>, getMessageFeedback?: GetMessageFeedback<TMeta>): MessageFeedback | null {
  if (getMessageFeedback) {
    const feedback = getMessageFeedback(message);
    if (feedback !== undefined) return isMessageFeedback(feedback) ? feedback : null;
  }

  return getMetadataFeedback(message);
}
