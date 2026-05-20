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
  const hostFeedbackRef = React.useRef<Record<string, MessageFeedback | null>>({});

  React.useEffect(() => {
    feedbackOverridesRef.current = feedbackOverrides;
  }, [feedbackOverrides]);

  React.useEffect(() => {
    const messageById = new Map(messages.map(message => [message.id, message]));
    const current = feedbackOverridesRef.current;
    const prevHostFeedback = hostFeedbackRef.current;

    // Re-resolve the host-driven feedback for every current message so we can
    // tell when the host changes it out from under a local override.
    const nextHostFeedback: Record<string, MessageFeedback | null> = {};
    for (const message of messages) {
      nextHostFeedback[message.id] = getInitialMessageFeedback(message, getMessageFeedback);
    }
    hostFeedbackRef.current = nextHostFeedback;

    let changed = false;
    const next: Record<string, MessageFeedback> = {};

    for (const [messageId, feedback] of Object.entries(current)) {
      if (!messageById.has(messageId)) {
        // Message left the transcript — drop its now-orphaned override.
        changed = true;
        continue;
      }

      const hostFeedback = nextHostFeedback[messageId];
      const hadPrevHostFeedback = Object.prototype.hasOwnProperty.call(prevHostFeedback, messageId);
      // Once the host's resolved feedback changes to a value the local override
      // disagrees with, evict the override so host state becomes authoritative
      // again (host-side corrections, clears, cross-device syncs).
      if (hadPrevHostFeedback && prevHostFeedback[messageId] !== hostFeedback && hostFeedback !== feedback) {
        changed = true;
        continue;
      }

      next[messageId] = feedback;
    }

    if (changed) {
      feedbackOverridesRef.current = next;
      setFeedbackOverrides(next);
    }
  }, [messages, getMessageFeedback]);

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
