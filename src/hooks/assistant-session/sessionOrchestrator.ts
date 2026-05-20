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
  streamAbort: () => void;
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

  /**
   * The current `persistenceKey`. The orchestrator's cleanup effect aborts
   * the active assistant session whenever this changes (a conversation
   * switch) so a stale stream cannot append into the newly-opened chat.
   */
  persistenceKey: string | undefined;

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
 * Three late-bound deps (`appendToolDeltaNow`, `streamAbort`,
 * `startTransportStream`) come from hooks (`useToolExecution`,
 * `useChorusStream`, `useTransportLifecycle`) that the facade creates AFTER
 * this orchestrator because they consume `isAssistantSessionActive` /
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
    persistenceKey,
    observers,
  } = deps;

  const controllerRef = React.useRef<AbortController | null>(null);
  const activeSessionIdRef = React.useRef(0);
  const activeSendPathRef = React.useRef<ChorusSendPath | null>(null);
  const warnedMissingHandlerRef = React.useRef(false);
  const warnedTransportOnSendRef = React.useRef(false);
  const warnedEmptyOnSendRef = React.useRef(false);
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

  const warnEmptyOnSend = React.useCallback(() => {
    if (isChorusDevMode() && !warnedEmptyOnSendRef.current) {
      warnedEmptyOnSendRef.current = true;
      console.warn('[Chorus] `onSend` resolved without appending assistant chunks or returning a message; no `onFinish`/`onAbort` observer fires for this turn. Call `helpers.finalizeAssistant()` or return a `Message` from `onSend`.');
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
    controllerRef.current?.abort();
    if (path === 'transport') {
      lateDepsRef.current?.streamAbort();
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
      warnEmptyOnSend,
      sessionId,
      text,
      history,
      onSend: currentOnSend,
    });
  }, [abortActiveAssistant, appendAssistantNow, appendAssistantReasoningNow, beginAssistantSession, clearStreamError, completeActiveSession, hasStartedAssistantRef, invalidateAssistantSession, isAssistantSessionActive, messagesRef, minAssistantDelayMsRef, observers, onSendRef, rememberSubmittedTurn, removePendingAssistant, resetStreamState, setInternalSending, setTransportBusy, showStreamError, systemPromptRef, transportRef, updateSessionMessages, warnEmptyOnSend, warnMissingResponseHandler]);

  // `abortActiveAssistant` is stable in real <Chorus> usage, but a hook-level
  // consumer can pass an unstable `flushPersistence` whose identity ripples
  // through the buffer into it. Read it from a ref so the cleanup effect below
  // can depend ONLY on `persistenceKey`: its cleanup must run on unmount and on
  // a conversation switch, never because an unrelated callback churned (that
  // would abort a healthy in-flight turn on every render).
  const abortActiveAssistantRef = React.useRef(abortActiveAssistant);
  abortActiveAssistantRef.current = abortActiveAssistant;

  // Abort whatever assistant turn is in flight when <Chorus> unmounts or the
  // conversation switches (`persistenceKey` change). The assistant-session
  // layer has no other unmount cleanup: without this an `onSend` promise keeps
  // resolving against a dead component — its `helpers.signal` never aborts and
  // the host-registered `onAbort` never fires — and a transport/SSE fetch
  // keeps streaming. On a `persistenceKey` switch it also stops the previous
  // conversation's stream from appending its assistant reply into the chat the
  // user just opened. One effect covers both cases because the mechanism is
  // identical (abort the in-flight controller); the cleanup runs on unmount
  // AND on every `persistenceKey` change. `activeSendPathRef` gates the abort
  // so a teardown with nothing in flight does not emit a spurious `onAbort`.
  React.useEffect(() => () => {
    if (activeSendPathRef.current) abortActiveAssistantRef.current('superseded', 'programmatic');
  }, [persistenceKey]);

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
