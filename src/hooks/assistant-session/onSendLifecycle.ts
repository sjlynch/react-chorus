import type React from 'react';
import type { ConnectorToolDelta } from '../../connectors/connectors';
import type { Message } from '../../types';
import { isChorusDevMode } from '../../utils/devMode';
import { isAbortError } from '../../utils/errors';
import type { ObserverCallbacks } from './observerCallbacks';
import { normalizeReturnedMessage } from './messageUtils';
import { createSessionHelpers } from './sessionHelpers';
import type { ChorusFinishContext, ChorusOnSend, ChorusSendPath, UpdateSessionMessages } from './types';

interface CompleteActiveSessionFinish<TMeta> {
  reason: ChorusFinishContext<TMeta>['reason'];
  response?: Response;
  message?: Message<TMeta>;
}

export interface OnSendLifecycleDeps<TMeta> {
  controllerRef: React.MutableRefObject<AbortController | null>;
  activeSendPathRef: React.MutableRefObject<ChorusSendPath | null>;
  minAssistantDelayMsRef: React.MutableRefObject<number>;
  systemPromptRef: React.MutableRefObject<string | undefined>;
  hasStartedAssistantRef: React.MutableRefObject<boolean>;
  setInternalSending: (next: boolean) => void;
  clearStreamError: () => void;
  resetStreamState: () => void;
  appendAssistantNow: (chunk: string) => void;
  appendAssistantReasoningNow: (chunk: string) => void;
  appendToolDeltaNow: (delta: ConnectorToolDelta) => void;
  completeActiveSession: (sessionId: number, finish?: CompleteActiveSessionFinish<TMeta>) => Message<TMeta> | null;
  isAssistantSessionActive: (sessionId: number) => boolean;
  invalidateAssistantSession: (sessionId?: number) => void;
  removePendingAssistant: () => void;
  updateSessionMessages: UpdateSessionMessages<TMeta>;
  observers: Pick<ObserverCallbacks<TMeta>, 'safeOnError' | 'safeOnStreamWarning'>;
  showStreamError: (rawError: Error) => void;
}

export interface StartOnSendLifecycleArgs<TMeta> extends OnSendLifecycleDeps<TMeta> {
  sessionId: number;
  text: string;
  history: Message<TMeta>[];
  onSend: ChorusOnSend<TMeta>;
}

/**
 * Owns the custom `onSend` branch after the facade has selected it over the
 * transport path: controller setup, helper wiring, returned-message handling,
 * auto-finalization, error reporting, and controller cleanup.
 */
export function startOnSendLifecycle<TMeta>({
  controllerRef,
  activeSendPathRef,
  minAssistantDelayMsRef,
  systemPromptRef,
  hasStartedAssistantRef,
  setInternalSending,
  clearStreamError,
  resetStreamState,
  appendAssistantNow,
  appendAssistantReasoningNow,
  appendToolDeltaNow,
  completeActiveSession,
  isAssistantSessionActive,
  invalidateAssistantSession,
  removePendingAssistant,
  updateSessionMessages,
  observers,
  showStreamError,
  sessionId,
  text,
  history,
  onSend,
}: StartOnSendLifecycleArgs<TMeta>): void {
  controllerRef.current?.abort();
  const controller = new AbortController();
  controllerRef.current = controller;
  activeSendPathRef.current = 'onSend';
  setInternalSending(true);
  clearStreamError();
  resetStreamState();

  const startedAt = Date.now();
  const sessionHelpers = createSessionHelpers<TMeta>({
    appendAssistantNow,
    appendAssistantReasoningNow,
    appendToolDeltaNow,
    safeOnStreamWarning: observers.safeOnStreamWarning,
    completeActiveSession,
    isAssistantSessionActive,
    minAssistantDelayMsRef,
    systemPromptRef,
    hasStartedAssistantRef,
  }, sessionId, controller.signal, startedAt);

  void (async () => {
    try {
      const res = await onSend(text, history, sessionHelpers.helpers);
      if (!isAssistantSessionActive(sessionId)) return;

      if (res && typeof res === 'object' && !hasStartedAssistantRef.current && !sessionHelpers.hasPendingAssistant()) {
        const wait = Math.max(0, minAssistantDelayMsRef.current - (Date.now() - startedAt));
        if (wait) await new Promise(r => setTimeout(r, wait));
        if (!isAssistantSessionActive(sessionId)) return;

        const returnedMessage = res as Partial<Message<TMeta>>;
        const normalizedMessage = normalizeReturnedMessage(returnedMessage);
        updateSessionMessages(prev => prev.concat(normalizedMessage), { reason: 'assistant' });
        completeActiveSession(sessionId, { reason: 'returned-message', message: normalizedMessage });
      }

      if (isAssistantSessionActive(sessionId) && sessionHelpers.hasAssistantOutput() && !sessionHelpers.wasFinalizeRequested()) {
        if (isChorusDevMode()) {
          console.warn('[Chorus] `onSend` appended assistant chunks but resolved without calling `helpers.finalizeAssistant()`. Chorus finalized the assistant automatically to avoid leaving the conversation in a sending state.');
        }
        sessionHelpers.autoFinalizeAssistant();
      }
    } catch (e: unknown) {
      if (isAssistantSessionActive(sessionId)) {
        removePendingAssistant();
        invalidateAssistantSession(sessionId);
        setInternalSending(false);
        if (controllerRef.current === controller) controllerRef.current = null;

        if (!isAbortError(e)) {
          const error = e instanceof Error ? e : new Error(String(e));
          observers.safeOnError(error);
          showStreamError(error);
        }
      }
    } finally {
      if (isAssistantSessionActive(sessionId) && !hasStartedAssistantRef.current && !sessionHelpers.hasPendingAssistant()) {
        completeActiveSession(sessionId);
      }
      if (controllerRef.current === controller && !isAssistantSessionActive(sessionId)) controllerRef.current = null;
    }
  })();
}
