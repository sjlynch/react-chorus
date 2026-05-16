import React from 'react';
import type { Message, MessageFeedback } from '../../types';
import { getInitialMessageFeedback, type GetMessageFeedback } from '../message-row/feedback';

export interface UseMessageFeedbackStateOptions<TMeta = Record<string, unknown>> {
  messages: Message<TMeta>[];
  getMessageFeedback?: GetMessageFeedback<TMeta>;
  onFeedback?: (message: Message<TMeta>, feedback: MessageFeedback) => void;
}

export function useMessageFeedbackState<TMeta = Record<string, unknown>>({ messages, getMessageFeedback, onFeedback }: UseMessageFeedbackStateOptions<TMeta>) {
  const [feedbackOverrides, setFeedbackOverrides] = React.useState<Record<string, MessageFeedback>>({});
  const feedbackOverridesRef = React.useRef(feedbackOverrides);

  React.useEffect(() => {
    feedbackOverridesRef.current = feedbackOverrides;
  }, [feedbackOverrides]);

  React.useEffect(() => {
    const messageIds = new Set(messages.map(message => message.id));
    const current = feedbackOverridesRef.current;
    let changed = false;
    const next: Record<string, MessageFeedback> = {};

    for (const [messageId, feedback] of Object.entries(current)) {
      if (messageIds.has(messageId)) next[messageId] = feedback;
      else changed = true;
    }

    if (changed) {
      feedbackOverridesRef.current = next;
      setFeedbackOverrides(next);
    }
  }, [messages]);

  const getSelectedFeedback = React.useCallback((message: Message<TMeta>) => {
    return feedbackOverrides[message.id] ?? getInitialMessageFeedback(message, getMessageFeedback);
  }, [feedbackOverrides, getMessageFeedback]);

  const handleMessageFeedback = React.useCallback((message: Message<TMeta>, variant: MessageFeedback) => {
    const current = feedbackOverridesRef.current[message.id] ?? getInitialMessageFeedback(message, getMessageFeedback);
    if (current === variant) return;

    const next = { ...feedbackOverridesRef.current, [message.id]: variant };
    feedbackOverridesRef.current = next;
    setFeedbackOverrides(next);
    onFeedback?.(message, variant);
  }, [getMessageFeedback, onFeedback]);

  return { getSelectedFeedback, handleMessageFeedback };
}
