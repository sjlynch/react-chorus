import React from 'react';
import type { Message } from '../../types';
import type { ConnectorToolDelta } from '../../connectors/connectors';
import { cloneHistoryForRetry, findLastUserMessage } from './messageUtils';
import type { ObserverCallbacks } from './observerCallbacks';
import { startOnSendLifecycle } from './onSendLifecycle';
import { resolveAbortSendPath, selectAssistantSendPath } from './sessionPath';
import { useSessionWarnings } from './sessionWarnings';
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
  // The orchestrator only reads whether transport is *present* (not
  // null/undefined, via `isTransportPresent`) for the transport/onSend branch
  // selection — never bare truthiness, so a misconfigured `transport=""` still
  // takes the transport branch. The facade passes its full
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
 * Two late-bound deps (`appendToolDeltaNow`, `startTransportStream`) come
 * from hooks (`useToolExecution`, `useTransportLifecycle`) that the facade
 * creates AFTER this orchestrator because they consume
 * `isAssistantSessionActive` /
 * `invalidateAssistantSession` / `removePendingAssistant` from it. The facade
 * wires them in via `bindLateDeps` once those hooks exist; the orchestrator's
 * trigger/abort callbacks read them through a ref at call time.
 *
 * Dev-mode warnings (missing-response-handler, transport+onSend, empty-onSend)
 * are wired through `useSessionWarnings` so they fire at most once per hook instance.
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
  const lateDepsRef = React.useRef<SessionOrchestratorLateDeps<TMeta> | null>(null);
  const { warnMissingResponseHandler, warnEmptyOnSend, warnReturnedMessageIgnored, warnTransportOnSend } = useSessionWarnings();

  const bindLateDeps = React.useCallback((next: SessionOrchestratorLateDeps<TMeta>) => {
    lateDepsRef.current = next;
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
    // Only rewrite the transcript when the partial/tool messages are actually
    // present in the CURRENT message array. On a `persistenceKey` switch the
    // cleanup effect runs `abortActiveAssistant('superseded')` after the
    // component has already re-rendered with the newly opened conversation, so
    // `messagesRef.current` no longer holds the old stream's partial. Filtering
    // it out then is a no-op rewrite, but it would still flush a spurious
    // `error-cleanup` `onMessagesChange` and persistence write against a
    // conversation that never had anything streaming.
    const partialInTranscript = messagesRef.current.some(
      m => m.id === partialId || toolMessageIds.has(m.id),
    );
    if (partialInTranscript) {
      updateSessionMessages(
        prev => prev.filter(m => m.id !== partialId && !toolMessageIds.has(m.id)),
        // `'error-cleanup'`, not `'delete'`: dropping a half-streamed partial
        // after a stream failure or supersession is internal cleanup, not a
        // host-initiated message delete. A host observing `onMessagesChange`
        // should be able to tell the two apart.
        { flushPersistence: true, reason: 'error-cleanup' },
      );
    }
  }, [messagesRef, pendingAssistantIdRef, pendingToolMessageIdsRef, resetStreamState, updateSessionMessages]);

  const abortActiveAssistant = React.useCallback((reason: ChorusAbortReason, source: ChorusAbortSource) => {
    const path = resolveAbortSendPath(activeSendPathRef.current, transportRef.current);

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

    // `'stop'` intentionally keeps whatever streamed — finalizeAssistantNow()
    // commits the partial assistant message into the transcript. `'superseded'`
    // is a brand-new turn replacing this one, so the half-streamed partial must
    // be discarded instead: leaving it committed wedges a stale truncated turn
    // between the two user messages (and re-sends it as history). Mirror the
    // transport error path (finalizeErroredTransportStream) and drop it.
    let message: Message<TMeta> | null = null;
    if (reason === 'superseded') {
      removePendingAssistant();
    } else {
      message = finalizeAssistantNow();
    }
    observers.safeOnAbort({
      message,
      messages: messagesRef.current,
      reason,
      source,
      path,
    });
  }, [finalizeAssistantNow, invalidateAssistantSession, messagesRef, observers, removePendingAssistant, setTransportBusy, transportRef]);

  // Abort only the in-flight controller — the `onSend` `helpers.signal` and any
  // transport fetch — without finalizing, removing, or rewriting the partial
  // assistant message. The unmount cleanup uses this instead of
  // `abortActiveAssistant`: on a real teardown the RAF-buffered trailing token
  // is handed to persistence by `useRAFQueue`'s own persist-only unmount flush,
  // and `removePendingAssistant`/`finalizeAssistantNow` here would instead
  // discard that buffer and rewrite messages through `onChange` /
  // `onMessagesChange` / `onAbort` after the host has already unmounted.
  const abortInFlightOnUnmount = React.useCallback(() => {
    invalidateAssistantSession();
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, [invalidateAssistantSession]);

  const triggerAssistant = React.useCallback((text: string, history: Message<TMeta>[] = messagesRef.current) => {
    if (activeSendPathRef.current) abortActiveAssistant('superseded', 'programmatic');

    const sessionId = beginAssistantSession();
    const currentTransport = transportRef.current;
    const sendPath = selectAssistantSendPath<TMeta>(currentTransport, onSendRef.current);

    if (sendPath.path === 'missing') {
      invalidateAssistantSession(sessionId);
      warnMissingResponseHandler();
      return;
    }

    // Record the submitted turn only after a real send path is committed.
    // Recording it before path selection logs a phantom turn for the
    // `'missing'` case — a turn that was never dispatched would then be
    // replayable by `retry()`.
    rememberSubmittedTurn(text, history);

    if (sendPath.path === 'transport') {
      if (sendPath.onSend) warnTransportOnSend();
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
      warnReturnedMessageIgnored,
      sessionId,
      text,
      history,
      onSend: sendPath.onSend,
    });
  }, [abortActiveAssistant, appendAssistantNow, appendAssistantReasoningNow, beginAssistantSession, clearStreamError, completeActiveSession, hasStartedAssistantRef, invalidateAssistantSession, isAssistantSessionActive, messagesRef, minAssistantDelayMsRef, observers, onSendRef, rememberSubmittedTurn, removePendingAssistant, resetStreamState, setInternalSending, setTransportBusy, showStreamError, systemPromptRef, transportRef, updateSessionMessages, warnEmptyOnSend, warnMissingResponseHandler, warnReturnedMessageIgnored, warnTransportOnSend]);

  // `abortActiveAssistant` is stable in real <Chorus> usage, but a hook-level
  // consumer can pass an unstable `flushPersistence` whose identity ripples
  // through the buffer into it. Read both abort callbacks from refs so the
  // cleanup effect below can depend ONLY on `persistenceKey`: its cleanup must
  // run on unmount and on a conversation switch, never because an unrelated
  // callback churned (that would abort a healthy in-flight turn on every
  // render).
  const abortActiveAssistantRef = React.useRef(abortActiveAssistant);
  abortActiveAssistantRef.current = abortActiveAssistant;
  const abortInFlightOnUnmountRef = React.useRef(abortInFlightOnUnmount);
  abortInFlightOnUnmountRef.current = abortInFlightOnUnmount;

  // The cleanup effect below fires on both a real unmount and a `persistenceKey`
  // change because they share one effect. This ref — flipped true by a cleanup
  // that runs only on a true unmount, and reset on (re)mount so a StrictMode
  // remount does not leave it stuck — lets that shared cleanup tell the two
  // apart. It is declared before the cleanup effect so its cleanup runs first
  // on teardown.
  const isUnmountingRef = React.useRef(false);
  React.useEffect(() => {
    isUnmountingRef.current = false;
    return () => { isUnmountingRef.current = true; };
  }, []);

  // Abort whatever assistant turn is in flight when <Chorus> unmounts or the
  // conversation switches (`persistenceKey` change). The assistant-session
  // layer has no other unmount cleanup: without this an `onSend` promise keeps
  // resolving against a dead component and a transport/SSE fetch keeps
  // streaming. One effect covers both because aborting the in-flight controller
  // is common to them; the cleanup runs on unmount AND on every `persistenceKey`
  // change. `activeSendPathRef` gates the abort so a teardown with nothing in
  // flight stays quiet.
  //
  // The two cases then diverge. A `persistenceKey` switch fully supersedes the
  // stale turn — `abortActiveAssistant('superseded')` discards its half-streamed
  // partial and routes `onAbort` — so the previous conversation's reply cannot
  // land in the chat the user just opened. A real unmount instead aborts only
  // the controller: the partial assistant message and its RAF-buffered trailing
  // token are left to `useRAFQueue`'s persist-only unmount flush, which lands
  // the final token in persistence without firing `onChange` / `onMessagesChange`
  // / `onAbort` on a host that has already torn down.
  React.useEffect(() => () => {
    if (!activeSendPathRef.current) return;
    if (isUnmountingRef.current) abortInFlightOnUnmountRef.current();
    else abortActiveAssistantRef.current('superseded', 'programmatic');
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
