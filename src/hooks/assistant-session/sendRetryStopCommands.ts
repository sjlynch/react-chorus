import React from 'react';
import type { Attachment, Message } from '../../types';
import { appendUserTurn, createRetryHistory } from './sessionCommandTransforms';
import type {
  ChorusAbortReason,
  ChorusAbortSource,
  ChorusOnSend,
  SubmittedUserTurn,
  UpdateSessionMessages,
} from './types';

export interface SendRetryStopCommandDeps<TMeta> {
  transportRef: React.MutableRefObject<unknown>;
  onSendRef: React.MutableRefObject<ChorusOnSend<TMeta> | undefined>;
  lastSubmittedTurnRef: React.MutableRefObject<SubmittedUserTurn<TMeta> | null>;
  streamError: string | null;
  isBusy: () => boolean;
  abortActiveAssistant: (reason: ChorusAbortReason, source: ChorusAbortSource) => void;
  triggerAssistant: (text: string, history: Message<TMeta>[]) => void;
  updateSessionMessages: UpdateSessionMessages<TMeta>;
  warnMissingResponseHandler: () => void;
}

export interface SendRetryStopCommands {
  send: (text: string, attachments?: Attachment[]) => boolean;
  retry: () => void;
  stop: (source?: ChorusAbortSource) => void;
}

export function useSendRetryStopCommands<TMeta>({
  transportRef,
  onSendRef,
  lastSubmittedTurnRef,
  streamError,
  isBusy,
  abortActiveAssistant,
  triggerAssistant,
  updateSessionMessages,
  warnMissingResponseHandler,
}: SendRetryStopCommandDeps<TMeta>): SendRetryStopCommands {
  const send = React.useCallback((rawText: string, attachments: Attachment[] = []) => {
    if (isBusy()) return false;
    const text = rawText.trim();
    if (!text && !attachments.length) return false;
    if (!transportRef.current && !onSendRef.current) {
      warnMissingResponseHandler();
      return false;
    }

    const next = updateSessionMessages(prev => appendUserTurn(prev, text, attachments), { reason: 'send' });
    triggerAssistant(text, next);
    return true;
  }, [isBusy, onSendRef, transportRef, triggerAssistant, updateSessionMessages, warnMissingResponseHandler]);

  const retry = React.useCallback(() => {
    const submitted = lastSubmittedTurnRef.current;
    if (!submitted || isBusy()) return;
    const retryHistory = createRetryHistory(submitted.history);
    if (streamError) {
      updateSessionMessages(() => retryHistory, { flushPersistence: true, reason: 'retry' });
    }
    triggerAssistant(submitted.text, retryHistory);
  }, [isBusy, lastSubmittedTurnRef, streamError, triggerAssistant, updateSessionMessages]);

  const stop = React.useCallback((source: ChorusAbortSource = 'programmatic') => {
    if (!isBusy()) return;
    abortActiveAssistant('stop', source);
  }, [abortActiveAssistant, isBusy]);

  return { send, retry, stop };
}
