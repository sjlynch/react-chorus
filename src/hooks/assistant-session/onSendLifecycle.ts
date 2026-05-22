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
  observers: Pick<ObserverCallbacks<TMeta>, 'safeOnError' | 'safeOnStreamWarning' | 'safeOnStreamMetadata'>;
  showStreamError: (rawError: Error) => void;
  /**
   * Dev-mode warning fired (once per hook instance) when `onSend` resolves
   * without appending assistant chunks or returning a message — that turn
   * closes silently with no `onFinish`/`onAbort` observer. Owned by
   * `useSessionOrchestrator` alongside the other once-warnings.
   */
  warnEmptyOnSend: () => void;
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
  warnEmptyOnSend,
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

  // Shared stream-error handler for the `onSend` path: drop the half-streamed
  // partial, close the session, release `sending`, then surface the error to
  // the `onError` observer + the UI banner. Used both by the catch below (a
  // rejected `onSend` promise) and by `createSessionHelpers`' bridged
  // `streamCallbacks().onError` (a `useChorusStream` send that errors when the
  // host's `onSend` did not return/await it). AbortErrors clean up but are not
  // surfaced — the host already sees `sending: false`.
  const reportStreamError = (rawError: unknown) => {
    removePendingAssistant();
    invalidateAssistantSession(sessionId);
    setInternalSending(false);
    if (controllerRef.current === controller) controllerRef.current = null;
    if (isAbortError(rawError)) return;
    const error = rawError instanceof Error ? rawError : new Error(String(rawError));
    observers.safeOnError(error);
    showStreamError(error);
  };

  const startedAt = Date.now();
  const sessionHelpers = createSessionHelpers<TMeta>({
    appendAssistantNow,
    appendAssistantReasoningNow,
    appendToolDeltaNow,
    safeOnStreamWarning: observers.safeOnStreamWarning,
    safeOnStreamMetadata: observers.safeOnStreamMetadata,
    completeActiveSession,
    isAssistantSessionActive,
    reportStreamError,
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
        // Append to the LIVE transcript (`prev` is `messagesRef.current`), not
        // the `history` snapshot passed to `onSend`. The `isAssistantSessionActive`
        // guard above only catches aborts/supersedes — an in-place edit/delete
        // within the same session is NOT detected here, so the documented
        // contract (see `ChorusOnSend`) is that the transcript must not be
        // mutated while an `onSend` is in flight.
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
      // A bridged `streamCallbacks().onError` may have already reported the
      // same stream error and invalidated the session; the active-session
      // guard makes this catch a no-op in that case so the error surfaces once.
      if (isAssistantSessionActive(sessionId)) reportStreamError(e);
    } finally {
      if (isAssistantSessionActive(sessionId) && !hasStartedAssistantRef.current && !sessionHelpers.hasPendingAssistant()) {
        // `onSend` resolved without appending assistant chunks or returning a
        // message. `completeActiveSession` with no `finish` flips `sending`
        // off but emits no `onFinish`/`onAbort`, so the turn closes silently —
        // warn so hosts wiring lifecycle telemetry notice the no-op turn.
        warnEmptyOnSend();
        completeActiveSession(sessionId);
      }
      if (controllerRef.current === controller && !isAssistantSessionActive(sessionId)) controllerRef.current = null;
    }
  })();
}
