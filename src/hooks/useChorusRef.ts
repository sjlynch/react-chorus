import React from 'react';
import type { ChatInputHandle } from '../components/ChatInput';
import type { ChorusRef } from '../Chorus.types';
import type { Attachment, Message } from '../types';
import type { UseAssistantSessionResult } from './useAssistantSession';

interface UseChorusRefArgs<TMeta> {
  session: UseAssistantSessionResult;
  resetComposer: () => void;
  messagesRef: React.RefObject<Message<TMeta>[]>;
  rootRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<ChatInputHandle | null>;
  writesDisabled: boolean;
  controlledWithoutOnChange: boolean;
}

/**
 * Mirrors the validity guard in `useSessionCommands.handleRegenerate`: a turn
 * can be regenerated only when the target message exists and is preceded by a
 * user message. Kept in step with that handler so `ChorusRef.regenerate` can
 * report `false` for ids the underlying command would otherwise silently ignore.
 */
function canRegenerateMessage<TMeta>(messages: Message<TMeta>[], id: string): boolean {
  const idx = messages.findIndex(message => message.id === id);
  if (idx === -1) return false;
  for (let userIdx = idx - 1; userIdx >= 0; userIdx -= 1) {
    if (messages[userIdx]?.role === 'user') return true;
  }
  return false;
}

export function useChorusRef<TMeta>(
  ref: React.ForwardedRef<ChorusRef<TMeta>>,
  {
    session,
    resetComposer,
    messagesRef,
    rootRef,
    inputRef,
    writesDisabled,
    controlledWithoutOnChange,
  }: UseChorusRefArgs<TMeta>,
): void {
  React.useImperativeHandle(ref, () => ({
    send(text: string, attachments: Attachment[] = []) {
      if (writesDisabled) return false;
      if (controlledWithoutOnChange) return false;
      const accepted = session.send(text, attachments);
      // Mirror a UI-driven send: clear the draft, collapse the textarea, and
      // drop any attachment chips the user had staged in the composer.
      if (accepted) resetComposer();
      return accepted;
    },
    stop() {
      session.stop('programmatic');
    },
    clear() {
      if (writesDisabled || session.clearConfirmationPending) return false;
      if (controlledWithoutOnChange) return false;
      // On commit the clear path invokes onClear, which resets the composer the
      // same way a UI-driven clear does — no extra reset is needed here (and
      // resetting unconditionally would wrongly clear it before an async
      // confirmClearConversation resolves).
      session.clear('programmatic');
      return true;
    },
    retry() {
      if (writesDisabled) return false;
      if (controlledWithoutOnChange) return false;
      if (!session.streamError) return false;
      session.retry();
      return true;
    },
    regenerate(messageId: string) {
      if (writesDisabled) return false;
      if (controlledWithoutOnChange) return false;
      if (!canRegenerateMessage(messagesRef.current, messageId)) return false;
      session.handleRegenerate(messageId);
      return true;
    },
    dismissError() {
      if (writesDisabled) return false;
      if (controlledWithoutOnChange) return false;
      if (!session.streamError) return false;
      session.dismissError();
      return true;
    },
    focus() {
      inputRef.current?.focus();
    },
    getMessages() {
      return messagesRef.current.slice();
    },
    scrollToMessage(id: string) {
      const root = rootRef.current;
      if (!root) return false;
      const nodes = root.querySelectorAll<HTMLElement>('[data-chorus-message-id]');
      const target = Array.from(nodes).find(node => node.dataset.chorusMessageId === id);
      if (!target) return false;
      target.scrollIntoView({ block: 'nearest' });
      return true;
    },
  }), [controlledWithoutOnChange, inputRef, messagesRef, resetComposer, rootRef, session, writesDisabled]);
}
