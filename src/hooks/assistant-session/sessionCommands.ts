import type React from 'react';
import type { Attachment, Message } from '../../types';
import { useClearCommand } from './clearCommand';
import { useDeleteCommand } from './deleteCommand';
import { useEditRegenerateCommands } from './editRegenerateCommands';
import { useSendRetryStopCommands } from './sendRetryStopCommands';
import type {
  ChorusAbortReason,
  ChorusAbortSource,
  ChorusConfirmClearConversation,
  ChorusConfirmDeleteMessage,
  ChorusOnSend,
  SubmittedUserTurn,
  UpdateSessionMessages,
} from './types';

export interface SessionCommandsDeps<TMeta> {
  messagesRef: React.MutableRefObject<Message<TMeta>[]>;
  transportRef: React.MutableRefObject<unknown>;
  onSendRef: React.MutableRefObject<ChorusOnSend<TMeta> | undefined>;
  lastSubmittedTurnRef: React.MutableRefObject<SubmittedUserTurn<TMeta> | null>;
  pendingDeleteIdsRef: React.MutableRefObject<Set<string>>;
  clearConfirmationActiveRef: React.MutableRefObject<boolean>;
  confirmDeleteMessageRef: React.MutableRefObject<ChorusConfirmDeleteMessage<TMeta> | undefined>;
  confirmClearConversationRef: React.MutableRefObject<ChorusConfirmClearConversation<TMeta> | undefined>;
  persistenceKeyRef: React.MutableRefObject<string | undefined>;
  resetToInitialMessagesRef: React.MutableRefObject<boolean>;
  seedMessagesRef: React.MutableRefObject<Message<TMeta>[]>;
  onClearRef: React.MutableRefObject<((messages: Message<TMeta>[]) => void) | undefined>;
  streamError: string | null;
  isBusy: () => boolean;
  abortActiveAssistant: (reason: ChorusAbortReason, source: ChorusAbortSource) => void;
  clearStreamError: () => void;
  triggerAssistant: (text: string, history: Message<TMeta>[]) => void;
  updateSessionMessages: UpdateSessionMessages<TMeta>;
  warnMissingResponseHandler: () => void;
  setClearConfirmationPending: React.Dispatch<React.SetStateAction<boolean>>;
}

export interface SessionCommands {
  send: (text: string, attachments?: Attachment[]) => boolean;
  retry: () => void;
  stop: (source?: ChorusAbortSource) => void;
  clear: (source?: ChorusAbortSource) => void;
  handleEdit: (id: string, newText: string) => void;
  handleRegenerate: (id: string) => void;
  handleDelete: (id: string) => void;
}

export function useSessionCommands<TMeta>({
  messagesRef,
  transportRef,
  onSendRef,
  lastSubmittedTurnRef,
  pendingDeleteIdsRef,
  clearConfirmationActiveRef,
  confirmDeleteMessageRef,
  confirmClearConversationRef,
  persistenceKeyRef,
  resetToInitialMessagesRef,
  seedMessagesRef,
  onClearRef,
  streamError,
  isBusy,
  abortActiveAssistant,
  clearStreamError,
  triggerAssistant,
  updateSessionMessages,
  warnMissingResponseHandler,
  setClearConfirmationPending,
}: SessionCommandsDeps<TMeta>): SessionCommands {
  const { send, retry, stop } = useSendRetryStopCommands<TMeta>({
    transportRef,
    onSendRef,
    lastSubmittedTurnRef,
    streamError,
    isBusy,
    abortActiveAssistant,
    triggerAssistant,
    updateSessionMessages,
    warnMissingResponseHandler,
  });

  const clear = useClearCommand<TMeta>({
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
  });

  const { handleEdit, handleRegenerate } = useEditRegenerateCommands<TMeta>({
    messagesRef,
    transportRef,
    onSendRef,
    streamError,
    isBusy,
    triggerAssistant,
    updateSessionMessages,
    warnMissingResponseHandler,
  });

  const handleDelete = useDeleteCommand<TMeta>({
    messagesRef,
    pendingDeleteIdsRef,
    confirmDeleteMessageRef,
    isBusy,
    updateSessionMessages,
  });

  return { send, retry, stop, clear, handleEdit, handleRegenerate, handleDelete };
}
