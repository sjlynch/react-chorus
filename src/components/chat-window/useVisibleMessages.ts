import React from 'react';
import type { Message, Role } from '../../types';
import { createHiddenRoleSet, filterVisibleMessages, getEffectiveHiddenRoles, normalizeMaxRenderedMessages, windowVisibleMessages } from './messageWindowing';

// Stable empty set so a non-streaming render keeps the same `streamingTurnIds`
// reference and does not re-render MessageList rows for an identity change.
const EMPTY_STREAMING_TURN_IDS: ReadonlySet<string> = new Set();

interface UseVisibleMessagesParams<TMeta> {
  messages: Message<TMeta>[];
  hiddenRoles: Role[] | undefined;
  showSystemMessages: boolean | undefined;
  maxRenderedMessages: number | undefined;
  streamingMessageId: string | null | undefined;
}

interface UseVisibleMessagesResult<TMeta> {
  visible: Message<TMeta>[];
  renderedVisible: Message<TMeta>[];
  streamingTurnIds: ReadonlySet<string>;
}

// Derives the transcript's visible/windowed message arrays and the in-flight
// turn id set, keeping ChatWindowInner free of the chained-useMemo windowing
// logic.
export function useVisibleMessages<TMeta = Record<string, unknown>>({
  messages,
  hiddenRoles,
  showSystemMessages,
  maxRenderedMessages,
  streamingMessageId,
}: UseVisibleMessagesParams<TMeta>): UseVisibleMessagesResult<TMeta> {
  const effectiveHiddenRoles = getEffectiveHiddenRoles(hiddenRoles, showSystemMessages);
  const hiddenRoleSet = React.useMemo(() => createHiddenRoleSet(effectiveHiddenRoles), [effectiveHiddenRoles]);
  const visible = React.useMemo(() => filterVisibleMessages(messages, hiddenRoleSet), [messages, hiddenRoleSet]);
  const normalizedMaxRenderedMessages = React.useMemo(() => normalizeMaxRenderedMessages(maxRenderedMessages), [maxRenderedMessages]);
  const renderedVisible = React.useMemo(
    () => windowVisibleMessages(visible, normalizedMaxRenderedMessages, streamingMessageId),
    [normalizedMaxRenderedMessages, visible, streamingMessageId],
  );
  // Derive the in-flight turn (every message after the last user message) from
  // the FULL visible array, before windowing. MessageList used to reduce over
  // the already-windowed array; when `maxRenderedMessages` sliced the last user
  // message out, that reduce found no user message and flagged every rendered
  // tool row as in-flight — flipping older finished tool calls to "Running…".
  const streamingTurnIds = React.useMemo(() => {
    if (streamingMessageId == null) return EMPTY_STREAMING_TURN_IDS;
    const lastUserIndex = visible.reduce((last, message, i) => (message.role === 'user' ? i : last), -1);
    return new Set(visible.slice(lastUserIndex + 1).map(message => message.id));
  }, [visible, streamingMessageId]);

  return { visible, renderedVisible, streamingTurnIds };
}
