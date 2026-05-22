import React from 'react';
import type { Message } from '../../types';
import { runConfirmationFlow } from './confirmationFlow';
import { clearUpdateOptions, messagesAfterClear } from './sessionCommandTransforms';
import type {
  ChorusAbortReason,
  ChorusAbortSource,
  ChorusClearConversationContext,
  ChorusConfirmClearConversation,
  SubmittedUserTurn,
  UpdateSessionMessages,
} from './types';

export interface ClearCommandDeps<TMeta> {
  messagesRef: React.MutableRefObject<Message<TMeta>[]>;
  lastSubmittedTurnRef: React.MutableRefObject<SubmittedUserTurn<TMeta> | null>;
  clearConfirmationActiveRef: React.MutableRefObject<boolean>;
  confirmClearConversationRef: React.MutableRefObject<ChorusConfirmClearConversation<TMeta> | undefined>;
  persistenceKeyRef: React.MutableRefObject<string | undefined>;
  resetToInitialMessagesRef: React.MutableRefObject<boolean>;
  seedMessagesRef: React.MutableRefObject<Message<TMeta>[]>;
  onClearRef: React.MutableRefObject<((messages: Message<TMeta>[]) => void) | undefined>;
  isBusy: () => boolean;
  abortActiveAssistant: (reason: ChorusAbortReason, source: ChorusAbortSource) => void;
  clearStreamError: () => void;
  updateSessionMessages: UpdateSessionMessages<TMeta>;
  setClearConfirmationPending: React.Dispatch<React.SetStateAction<boolean>>;
}

function createClearConversationContext<TMeta>(
  messages: Message<TMeta>[],
  resetToInitialMessages: boolean,
  source: ChorusAbortSource,
  persistenceKey: string | undefined,
): ChorusClearConversationContext<TMeta> {
  return {
    messages: messages.slice(),
    resetToInitialMessages,
    source,
    ...(persistenceKey ? { persistenceKey } : {}),
  };
}

export function useClearCommand<TMeta>({
  messagesRef,
  lastSubmittedTurnRef,
  clearConfirmationActiveRef,
  confirmClearConversationRef,
  persistenceKeyRef,
  resetToInitialMessagesRef,
  seedMessagesRef,
  onClearRef,
  isBusy,
  abortActiveAssistant,
  clearStreamError,
  updateSessionMessages,
  setClearConfirmationPending,
}: ClearCommandDeps<TMeta>): (source?: ChorusAbortSource) => void {
  const commitClear = React.useCallback((source: ChorusAbortSource) => {
    if (isBusy()) abortActiveAssistant('clear', source);
    clearStreamError();
    lastSubmittedTurnRef.current = null;

    const reset = resetToInitialMessagesRef.current;
    const seedMessages = seedMessagesRef.current;
    const next = messagesAfterClear(seedMessages, reset);
    updateSessionMessages(() => next, clearUpdateOptions(seedMessages, reset));
    onClearRef.current?.(next);
  }, [abortActiveAssistant, clearStreamError, isBusy, lastSubmittedTurnRef, onClearRef, resetToInitialMessagesRef, seedMessagesRef, updateSessionMessages]);

  return React.useCallback((source: ChorusAbortSource = 'programmatic') => {
    if (clearConfirmationActiveRef.current) return;

    const confirm = confirmClearConversationRef.current;
    if (!confirm) {
      commitClear(source);
      return;
    }

    const context = createClearConversationContext(
      messagesRef.current,
      resetToInitialMessagesRef.current,
      source,
      persistenceKeyRef.current,
    );

    runConfirmationFlow({
      label: 'confirmClearConversation',
      requestConfirmation: () => confirm(context),
      onConfirmed: () => commitClear(source),
      // Deliberately NO `shouldCommit` busy recheck — this is an intentional
      // asymmetry with `useDeleteCommand`. Delete vetoes an async confirmation
      // that resolves mid-send because removing the active streaming message
      // (or its context) would orphan pending state. Clear is a whole-
      // conversation reset: `commitClear` is built to run during a send and
      // aborts any active assistant via `abortActiveAssistant('clear', …)`.
      // The no-confirm and synchronous-confirm clear paths already commit
      // while busy, so a busy recheck here would only veto the async-confirm
      // path — an inconsistency, not a fix. A confirmed clear therefore always
      // commits (and aborts whatever is in flight), regardless of when the
      // confirmation resolves.
      onPendingChange: pending => {
        clearConfirmationActiveRef.current = pending;
        setClearConfirmationPending(pending);
      },
    });
  }, [clearConfirmationActiveRef, commitClear, confirmClearConversationRef, messagesRef, persistenceKeyRef, resetToInitialMessagesRef, setClearConfirmationPending]);
}
