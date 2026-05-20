import React from 'react';
import type { Message } from '../../types';
import type { ConnectorToolDelta } from '../../connectors/connectors';
import { isChorusDevMode } from '../../utils/devMode';
import { cloneHistoryForRetry, findLastUserMessage } from './messageUtils';
import type { ObserverCallbacks } from './observerCallbacks';
import { startOnSendLifecycle } from './onSendLifecycle';
import type { StartTransportStream } from './transportLifecycle';
import type {
  ChorusAbortReason,
  ChorusAbortSource,
  ChorusFinishContext,
  ChorusOnSend,
  ChorusSendPath,
  SubmittedUserTurn,
  UpdateSessionMessages,
} from './types';

interface CompleteActiveSessionFinish<TMeta> {
  reason: ChorusFinishContext<TMeta>['reason'];
  response?: Response;
  message?: Message<TMeta>;
}

export interface SessionOrchestratorLateDeps<TMeta> {
  appendToolDeltaNow: (delta: ConnectorToolDelta) => void;
  startTransportStream: StartTransportStream<TMeta>;
}

export interface SessionOrchestratorDeps<TMeta> {
  messagesRef: React.MutableRefObject<Message<TMeta>[]>;
  // The orchestrator only reads truthiness of transport (for the
  // transport/onSend branch selection); the facade passes its full
  // FetchTransportInit/Transport ref.
  transportRef: React.MutableRefObject<unknown>;
  onSendRef: React.MutableRefObject<ChorusOnSend<TMeta> | undefined>;
  minAssistantDelayMsRef: React.MutableRefObject<number>;
  systemPromptRef: React.MutableRefObject<string | undefined>;
  hasStartedAssistantRef: React.MutableRefObject<boolean>;
  pendingAssistantIdRef: React.MutableRefObject<string | null>;
  pendingToolMessageIdsRef: React.MutableRefObject<Set<string>>;
  lastSubmittedTurnRef: React.MutableRefObject<SubmittedUserTurn<TMeta> | null>;

  updateSessionMessages: UpdateSessionMessages<TMeta>;
  setInternalSending: (next: boolean) => void;
  setTransportBusy: (next: boolean) => void;
  forceRender: () => void;
  clearStreamError: () => void;
  showStreamError: (error: Error) => void;

  appendAssistantNow: (chunk: string) => void;
  appendAssistantReasoningNow: (chunk: string) => void;
  finalizeAssistantNow: () => Message<TMeta> | null;
  resetPendingAssistantState: () => void;
  resetStreamState: () => void;

  observers: ObserverCallbacks<TMeta>;
}

export interface SessionOrchestrator<TMeta> {
  beginAssistantSession: () => number;
  isAssistantSessionActive: (sessionId: number) => boolean;
  invalidateAssistantSession: (sessionId?: number) => void;
  completeActiveSession: (sessionId: number, finish?: CompleteActiveSessionFinish<TMeta>) => Message<TMeta> | null;
  removePendingAssistant: () => void;
  abortActiveAssistant: (reason: ChorusAbortReason, source: ChorusAbortSource) => void;
  triggerAssistant: (text: string, history?: Message<TMeta>[]) => void;
  warnMissingResponseHandler: () => void;
  // Shared with `useTransportLifecycle` which owns the in-flight controller
  // for the transport branch and clears it on stream completion/abort.
  controllerRef: React.MutableRefObject<AbortController | null>;
  bindLateDeps: (deps: SessionOrchestratorLateDeps<TMeta>) => void;
}

/**
 * Owns the active-session/active-path/abort-controller bookkeeping plus the
 * begin/active/invalidate/complete/remove/abort/trigger callbacks that drive
 * a Chorus assistant turn.
 *
 * Two late-bound deps (`appendToolDeltaNow`, `startTransportStream`) come
 * from hooks (`useToolExecution`, `useTransportLifecycle`) that the facade
 * creates AFTER this orchestrator because they consume
 * `isAssistantSessionActive` /
 * `invalidateAssistantSession` / `removePendingAssistant` from it. The facade
 * wires them in via `bindLateDeps` once those hooks exist; the orchestrator's
 * trigger/abort callbacks read them through a ref at call time.
 *
 * Dev-mode warnings (missing-response-handler, transport+onSend) are owned
 * here so they fire at most once per hook instance.
 */
export function useSessionOrchestrator<TMeta>(deps: SessionOrchestratorDeps<TMeta>): SessionOrchestrator<TMeta> {
  const {
    messagesRef,
    transportRef,
    onSendRef,
    minAssistantDelayMsRef,
    systemPromptRef,
    hasStartedAssistantRef,
    pendingAssistantIdRef,
    pendingToolMessageIdsRef,
    lastSubmittedTurnRef,
    updateSessionMessages,
    setInternalSending,
    setTransportBusy,
    forceRender,
    clearStreamError,
    showStreamError,
    appendAssistantNow,
    appendAssistantReasoningNow,
    finalizeAssistantNow,
    resetPendingAssistantState,
    resetStreamState,
    observers,
  } = deps;

  const controllerRef = React.useRef<AbortController | null>(null);
  const activeSessionIdRef = React.useRef(0);
  const activeSendPathRef = React.useRef<ChorusSendPath | null>(null);
  const warnedMissingHandlerRef = React.useRef(false);
  const warnedTransportOnSendRef = React.useRef(false);
  const lateDepsRef = React.useRef<SessionOrchestratorLateDeps<TMeta> | null>(null);

  const bindLateDeps = React.useCallback((next: SessionOrchestratorLateDeps<TMeta>) => {
    lateDepsRef.current = next;
  }, []);

  const warnMissingResponseHandler = React.useCallback(() => {
    if (isChorusDevMode() && !warnedMissingHandlerRef.current) {
      warnedMissingHandlerRef.current = true;
      console.warn('[Chorus] `send` was called but neither `transport` nor `onSend` was provided. Pass one of these props to produce an assistant response.');
    }
  }, []);

  const beginAssistantSession = React.useCallback(() => {
    activeSessionIdRef.current += 1;
    return activeSessionIdRef.current;
  }, []);

  const isAssistantSessionActive = React.useCallback(
    (sessionId: number) => activeSessionIdRef.current === sessionId,
    [],
  );

  const invalidateAssistantSession = React.useCallback((sessionId?: number) => {
    if (sessionId === undefined || activeSessionIdRef.current === sessionId) {
      activeSessionIdRef.current += 1;
      activeSendPathRef.current = null;
    }
  }, []);

  const rememberSubmittedTurn = React.useCallback((text: string, history: Message<TMeta>[]) => {
    if (!findLastUserMessage(history)) return;
    lastSubmittedTurnRef.current = { text, history: cloneHistoryForRetry(history) };
  }, [lastSubmittedTurnRef]);

  const completeActiveSession = React.useCallback((
    sessionId: number,
    finish?: CompleteActiveSessionFinish<TMeta>,
  ) => {
    if (!isAssistantSessionActive(sessionId)) return null;

    const message = finish?.message ?? finalizeAssistantNow();
    if (finish?.message) {
      resetPendingAssistantState();
      setInternalSending(false);
      forceRender();
    }

    invalidateAssistantSession(sessionId);
    if (finish && message) {
      observers.safeOnFinish({
        message,
        messages: messagesRef.current,
        reason: finish.reason,
        response: finish.response,
      });
    }
    return message;
  }, [finalizeAssistantNow, forceRender, invalidateAssistantSession, isAssistantSessionActive, messagesRef, observers, resetPendingAssistantState, setInternalSending]);

  const removePendingAssistant = React.useCallback(() => {
    const partialId = pendingAssistantIdRef.current;
    const toolMessageIds = new Set(pendingToolMessageIdsRef.current);
    resetStreamState();
    if (partialId || toolMessageIds.size > 0) {
      updateSessionMessages(
        prev => prev.filter(m => m.id !== partialId && !toolMessageIds.has(m.id)),
        { flushPersistence: true, reason: 'delete' },
      );
    }
  }, [pendingAssistantIdRef, pendingToolMessageIdsRef, resetStreamState, updateSessionMessages]);

  const abortActiveAssistant = React.useCallback((reason: ChorusAbortReason, source: ChorusAbortSource) => {
    const path = activeSendPathRef.current ?? (transportRef.current ? 'transport' : 'onSend');

    invalidateAssistantSession();
    // On the transport path `controllerRef.current` IS the external signal
    // passed to `useChorusStream.send`, so aborting it cancels the stream.
    // `useChorusStream.abort()` is intentionally not called here: the hook
    // does not own that signal, and calling abort() would log a spurious
    // dev warning telling the host to abort a signal they never passed.
    controllerRef.current?.abort();
    if (path === 'transport') {
      setTransportBusy(false);
    }
    controllerRef.current = null;

    const message = finalizeAssistantNow();
    observers.safeOnAbort({
      message,
      messages: messagesRef.current,
      reason,
      source,
      path,
    });
  }, [finalizeAssistantNow, invalidateAssistantSession, messagesRef, observers, setTransportBusy, transportRef]);

  const triggerAssistant = React.useCallback((text: string, history: Message<TMeta>[] = messagesRef.current) => {
    if (activeSendPathRef.current) abortActiveAssistant('superseded', 'programmatic');

    const sessionId = beginAssistantSession();
    rememberSubmittedTurn(text, history);
    const currentTransport = transportRef.current;
    const currentOnSend = onSendRef.current;

    if (currentTransport) {
      if (isChorusDevMode() && currentOnSend && !warnedTransportOnSendRef.current) {
        warnedTransportOnSendRef.current = true;
        console.warn('[Chorus] Both `transport` and `onSend` props were provided. `transport` takes precedence and `onSend` will be ignored. Remove one of the two props to silence this warning.');
      }
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      activeSendPathRef.current = 'transport';
      resetStreamState();
      clearStreamError();
      setTransportBusy(true);
      lateDepsRef.current?.startTransportStream(sessionId, text, history, controller, 0);
      return;
    }

    if (!currentOnSend) {
      invalidateAssistantSession(sessionId);
      warnMissingResponseHandler();
      return;
    }

    const appendToolDeltaNow = lateDepsRef.current?.appendToolDeltaNow ?? (() => {});
    startOnSendLifecycle<TMeta>({
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
      onSend: currentOnSend,
    });
  }, [abortActiveAssistant, appendAssistantNow, appendAssistantReasoningNow, beginAssistantSession, clearStreamError, completeActiveSession, hasStartedAssistantRef, invalidateAssistantSession, isAssistantSessionActive, messagesRef, minAssistantDelayMsRef, observers, onSendRef, rememberSubmittedTurn, removePendingAssistant, resetStreamState, setInternalSending, setTransportBusy, showStreamError, systemPromptRef, transportRef, updateSessionMessages, warnMissingResponseHandler]);

  return {
    beginAssistantSession,
    isAssistantSessionActive,
    invalidateAssistantSession,
    completeActiveSession,
    removePendingAssistant,
    abortActiveAssistant,
    triggerAssistant,
    warnMissingResponseHandler,
    controllerRef,
    bindLateDeps,
  };
}
