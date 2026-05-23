import React from 'react';
import type { ChatInputHandle } from '../components/ChatInput';
import type { ChorusRef } from '../Chorus.types';
import type { Attachment, Message } from '../types';
import { isChorusDevMode } from '../utils/devMode';
import type { UseAssistantSessionResult } from './useAssistantSession';
import type { ToolPolicyStore } from './conversations/toolPolicyStore';

type ImperativeRejectionCause = 'writesDisabled' | 'controlledWithoutOnChange';

const REJECTION_EXPLANATIONS: Record<ImperativeRejectionCause, string> = {
  writesDisabled: '`disabled`/`readOnly` is set, or a built-in persistence load is still pending, so write actions are gated',
  controlledWithoutOnChange: '`value` is provided without `onChange`, so Chorus is controlled and cannot reflect the change itself',
};

interface UseChorusRefArgs<TMeta> {
  session: UseAssistantSessionResult;
  resetComposer: () => void;
  messagesRef: React.RefObject<Message<TMeta>[]>;
  rootRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<ChatInputHandle | null>;
  writesDisabled: boolean;
  controlledWithoutOnChange: boolean;
  policyStore: ToolPolicyStore;
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
    policyStore,
  }: UseChorusRefArgs<TMeta>,
): void {
  // A `false` return from an imperative method is ambiguous: it can mean an
  // invalid argument / no-op (e.g. unknown id, no error to retry) OR that
  // writes are gated (`disabled`/`readOnly`/load pending, or controlled without
  // `onChange`). The latter is a host misconfiguration the caller usually wants
  // to know about, so emit a one-time-per-(method, cause) dev warning for it.
  const warnedRejectionsRef = React.useRef<Set<string>>(new Set());

  React.useImperativeHandle(ref, () => {
    const warnRejected = (method: string, cause: ImperativeRejectionCause): false => {
      if (isChorusDevMode()) {
        const key = `${method}:${cause}`;
        if (!warnedRejectionsRef.current.has(key)) {
          warnedRejectionsRef.current.add(key);
          console.warn(`[Chorus] \`ChorusRef.${method}()\` returned \`false\` because ${REJECTION_EXPLANATIONS[cause]}. This rejection is distinct from an invalid-argument/no-op \`false\` (e.g. unknown id or nothing to act on).`);
        }
      }
      return false;
    };

    return {
    send(text: string, attachments: Attachment[] = []) {
      if (writesDisabled) return warnRejected('send', 'writesDisabled');
      if (controlledWithoutOnChange) return warnRejected('send', 'controlledWithoutOnChange');
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
      if (writesDisabled) return warnRejected('clear', 'writesDisabled');
      if (session.clearConfirmationPending) return false;
      if (controlledWithoutOnChange) return warnRejected('clear', 'controlledWithoutOnChange');
      // On commit the clear path invokes onClear, which resets the composer the
      // same way a UI-driven clear does — no extra reset is needed here (and
      // resetting unconditionally would wrongly clear it before an async
      // confirmClearConversation resolves).
      session.clear('programmatic');
      return true;
    },
    retry() {
      if (writesDisabled) return warnRejected('retry', 'writesDisabled');
      if (controlledWithoutOnChange) return warnRejected('retry', 'controlledWithoutOnChange');
      if (!session.streamError) return false;
      session.retry();
      return true;
    },
    regenerate(messageId: string) {
      if (writesDisabled) return warnRejected('regenerate', 'writesDisabled');
      if (controlledWithoutOnChange) return warnRejected('regenerate', 'controlledWithoutOnChange');
      if (!canRegenerateMessage(messagesRef.current, messageId)) return false;
      session.handleRegenerate(messageId);
      return true;
    },
    dismissError() {
      // Intentionally NOT gated on `writesDisabled` (unlike the other
      // mutators): dismissing an error clears only transient stream-error
      // state, not the transcript, so a `disabled`/`readOnly` Chorus may
      // still dismiss it. This matches the built-in error banner's dismiss
      // button, whose `onDismissError` is wired unconditionally.
      if (controlledWithoutOnChange) return warnRejected('dismissError', 'controlledWithoutOnChange');
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
    respondToApproval(toolCallId: string, decision) {
      if (decision === 'allow-always') {
        const message = messagesRef.current.find(m => m.role === 'tool' && m.toolCall?.id === toolCallId);
        if (message && message.role === 'tool' && message.toolCall?.name) {
          policyStore.setPerToolDecision(message.toolCall.name, 'allow');
        }
      }
      return policyStore.respondToApproval(toolCallId, decision === 'deny' ? 'denied' : 'allowed');
    },
    scrollToMessage(id: string) {
      const root = rootRef.current;
      if (!root) return false;
      const nodes = root.querySelectorAll<HTMLElement>('[data-chorus-message-id]');
      const target = Array.from(nodes).find(node => node.dataset.chorusMessageId === id);
      if (target) {
        target.scrollIntoView({ block: 'nearest' });
        return true;
      }
      // No rendered row carries this id. A `false` here is ambiguous: the id
      // may match no message at all, OR it may be a perfectly valid message
      // (one `getMessages()` returns) whose row simply is not in the DOM right
      // now — windowed out by `maxRenderedMessages`, hidden by `hiddenRoles`,
      // or drawn by a custom `renderMessage` that never spread
      // `ctx.messageProps`. A host wiring "jump to message"/citation
      // navigation reads the bare `false` as "unknown id" and never learns the
      // target is real but unrendered. Emit a one-time dev warning for the
      // known-but-unrendered case so the two are distinguishable (callers can
      // also cross-check `id` against `getMessages()` at runtime).
      if (isChorusDevMode() && messagesRef.current.some(message => message.id === id)) {
        const key = 'scrollToMessage:knownButUnrendered';
        if (!warnedRejectionsRef.current.has(key)) {
          warnedRejectionsRef.current.add(key);
          console.warn(`[Chorus] \`ChorusRef.scrollToMessage()\` returned \`false\` for id "${id}", a known message that is not currently rendered — it is windowed out by \`maxRenderedMessages\`, hidden by \`hiddenRoles\`, or drawn by a custom \`renderMessage\` that did not spread \`ctx.messageProps\`. This is distinct from a \`false\` for an id that matches no message; cross-check ids against \`getMessages()\` to tell the two cases apart.`);
        }
      }
      return false;
    },
    };
  }, [controlledWithoutOnChange, inputRef, messagesRef, policyStore, resetComposer, rootRef, session, writesDisabled]);
}
