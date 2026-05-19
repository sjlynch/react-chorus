import React from 'react';
import type { ChatInputHandle } from '../components/ChatInput';
import type { ChorusRef } from '../Chorus.types';
import type { Attachment, Message } from '../types';
import type { UseAssistantSessionResult } from './useAssistantSession';

interface UseChorusRefArgs<TMeta> {
  session: UseAssistantSessionResult;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  messagesRef: React.RefObject<Message<TMeta>[]>;
  rootRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<ChatInputHandle | null>;
  writesDisabled: boolean;
  controlledWithoutOnChange: boolean;
}

export function useChorusRef<TMeta>(
  ref: React.ForwardedRef<ChorusRef<TMeta>>,
  {
    session,
    setDraft,
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
      if (accepted) setDraft('');
      return accepted;
    },
    stop() {
      session.stop('programmatic');
    },
    clear() {
      if (writesDisabled || session.clearConfirmationPending) return false;
      if (controlledWithoutOnChange) return false;
      session.clear('programmatic');
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
  }), [controlledWithoutOnChange, inputRef, messagesRef, rootRef, session, setDraft, writesDisabled]);
}
