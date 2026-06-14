import React from 'react';
import type { Message, MessageSource, ToolMessage } from '../../types';
import type { ConnectorToolDelta } from '../../connectors/connectors';
import { isAbortError, toError } from '../../utils/errors';
import { isUnstartedSendError } from '../../streaming/errors';
import type { SendCallbacks } from '../useChorusStream';
import type { ObserverCallbacks } from './observerCallbacks';
import { normalizeMaxToolIterations } from './toolLoop';
import { releaseTransportController, emitFinishForAssistantMessage, finalizeErroredTransportStream, finalizeTransportFinishError } from './transportFinalizers';
import { historyWithSystemPrompt } from './transportHistory';
import { createStreamDoneContext, createTerminalStreamDoneContext } from './transportStreamDone';
import { decideTransportToolLoopContinuation, type ToolLoopDecision } from './transportToolLoop';
import { createTransportSendCallbacks } from './transportSendCallbacks';
import type { ChorusShouldContinueToolLoop, ChorusTransformRequest } from './types';

export type { ToolLoopDecision } from './transportToolLoop';

export type DoStream<TMeta> = (
  text: string,
  history: Message<TMeta>[],
  cb: SendCallbacks,
  externalSignal?: AbortSignal,
) => Promise<unknown>;

export interface TransportLifecycleDeps<TMeta> {
  controllerRef: React.MutableRefObject<AbortController | null>;
  messagesRef: React.MutableRefObject<Message<TMeta>[]>;
  pendingToolMessageIdsRef: React.MutableRefObject<Set<string>>;
  autoContinueToolsRef: React.MutableRefObject<boolean>;
  maxToolIterationsRef: React.MutableRefObject<number>;
  shouldContinueToolLoopRef: React.MutableRefObject<ChorusShouldContinueToolLoop<TMeta> | undefined>;
  systemPromptRef: React.MutableRefObject<string | undefined>;
  minAssistantDelayMsRef: React.MutableRefObject<number>;
  /**
   * Optional pre-send hook ref. When set, it runs once per outbound transport
   * request (initial + every tool-loop iteration) and may override the
   * outgoing `messages` / `systemPrompt`. See `ChorusTransformRequest`.
   */
  transformRequestRef: React.MutableRefObject<ChorusTransformRequest<TMeta> | undefined>;
  isAssistantSessionActive: (sessionId: number) => boolean;
  invalidateAssistantSession: (sessionId?: number) => void;
  removePendingAssistant: () => void;
  setTransportBusy: (next: boolean) => void;
  appendAssistantNow: (chunk: string) => void;
  appendAssistantReasoningNow: (chunk: string) => void;
  appendAssistantSourceNow: (source: MessageSource) => void;
  appendToolDeltaNow: (delta: ConnectorToolDelta) => void;
  finalizeAssistantNow: () => Message<TMeta> | null;
  resetPendingAssistantState: () => void;
  getToolMessagesByIds: (ids: Set<string>) => ToolMessage<TMeta>[];
  runCompletedToolCalls: (sessionId: number, toolMessages: ToolMessage<TMeta>[], signal: AbortSignal) => Promise<void>;
  showStreamError: (error: Error) => void;
  observers: Pick<ObserverCallbacks<TMeta>, 'safeOnError' | 'safeOnFinish' | 'safeOnStreamDone' | 'safeOnStreamWarning' | 'safeOnStreamMetadata'>;
  doStream: DoStream<TMeta>;
  forceRender: () => void;
}

export type StartTransportStream<TMeta> = (
  sessionId: number,
  text: string,
  history: Message<TMeta>[],
  controller: AbortController,
  iteration: number,
) => void;

export interface TransportLifecycle<TMeta> {
  historyForTransport: (history: Message<TMeta>[]) => Message<TMeta>[];
  startTransportStream: StartTransportStream<TMeta>;
  decideToolLoopContinuation: (
    iteration: number,
    assistantMessage: Message<TMeta> | null,
    toolMessages: ToolMessage<TMeta>[],
    response: Response | undefined,
    signal: AbortSignal,
  ) => Promise<ToolLoopDecision>;
}

export function useTransportLifecycle<TMeta>(deps: TransportLifecycleDeps<TMeta>): TransportLifecycle<TMeta> {
  const {
    controllerRef,
    messagesRef,
    pendingToolMessageIdsRef,
    autoContinueToolsRef,
    maxToolIterationsRef,
    shouldContinueToolLoopRef,
    systemPromptRef,
    minAssistantDelayMsRef,
    transformRequestRef,
    isAssistantSessionActive,
    invalidateAssistantSession,
    removePendingAssistant,
    setTransportBusy,
    appendAssistantNow,
    appendAssistantReasoningNow,
    appendAssistantSourceNow,
    appendToolDeltaNow,
    finalizeAssistantNow,
    resetPendingAssistantState,
    getToolMessagesByIds,
    runCompletedToolCalls,
    showStreamError,
    observers,
    doStream,
    forceRender,
  } = deps;

  const historyForTransport = React.useCallback((history: Message<TMeta>[]): Message<TMeta>[] => (
    historyWithSystemPrompt(history, systemPromptRef.current)
  ), [systemPromptRef]);

  type FinishTransportStream = (sessionId: number, response: Response | undefined, controller: AbortController, iteration: number) => Promise<void>;
  const finishTransportStreamRef = React.useRef<FinishTransportStream | null>(null);

  const startTransportStream = React.useCallback((
    sessionId: number,
    text: string,
    history: Message<TMeta>[],
    controller: AbortController,
    iteration: number,
  ) => {
    const finalizeError = (error: Error) => finalizeErroredTransportStream({
      sessionId,
      error,
      controllerRef,
      controller,
      isAssistantSessionActive,
      removePendingAssistant,
      invalidateAssistantSession,
      setTransportBusy,
      observers,
      showStreamError,
    });
    const callbacks = createTransportSendCallbacks<TMeta>({
      sessionId,
      isAssistantSessionActive,
      appendAssistantNow,
      appendAssistantReasoningNow,
      appendAssistantSourceNow,
      appendToolDeltaNow,
      observers,
      onDone: (response) => {
        if (!isAssistantSessionActive(sessionId)) return;
        void finishTransportStreamRef.current?.(sessionId, response, controller, iteration);
      },
      onError: finalizeError,
      minDelayMs: minAssistantDelayMsRef.current,
    });
    const reason = iteration === 0 ? 'initial' as const : 'tool-continuation' as const;

    const dispatch = (wireHistory: Message<TMeta>[]) => {
      void doStream(text, wireHistory, callbacks, controller.signal).catch((rejection: unknown) => {
        if (isUnstartedSendError(rejection)) {
          // doStream rejected before the transport ran — a concurrent-send overlap
          // (this startTransportStream raced another send still in flight) or an
          // already-aborted externalSignal. The send never started, so the cb.onError
          // path above never fired. Route the rejection through the standard error
          // finalizer so the turn surfaces an error banner / onError instead of
          // silently releasing busy state and snapping back to the Send button.
          finalizeError(rejection);
          return;
        }
        releaseTransportController({ controllerRef, controller, setTransportBusy });
      });
    };

    const transformer = transformRequestRef.current;
    if (!transformer) {
      dispatch(historyForTransport(history));
      return;
    }

    // Run the host transformer async so even a synchronous return is awaited
    // through Promise.resolve — keeps the control flow uniform and lets
    // throws/rejections route through the same finalizer.
    void Promise.resolve()
      .then(() => transformer({
        messages: history,
        systemPrompt: systemPromptRef.current,
        signal: controller.signal,
        reason,
      }))
      .then((result) => {
        if (!isAssistantSessionActive(sessionId)) return;
        // `messages`/`systemPrompt` overrides apply to the WIRE request only —
        // `historyWithSystemPrompt` runs after the transformer so the
        // overridden system prompt still lands at position 0. `undefined`
        // keeps the configured value; pass an empty string to suppress the
        // system prompt for this request.
        const finalHistory = result && result.messages ? result.messages : history;
        const finalSystemPrompt = result && result.systemPrompt !== undefined
          ? result.systemPrompt
          : systemPromptRef.current;
        dispatch(historyWithSystemPrompt(finalHistory, finalSystemPrompt));
      })
      .catch((error: unknown) => {
        if (!isAssistantSessionActive(sessionId)) return;
        // Aborts propagated through ctx.signal are silent: the orchestrator
        // already handled the abort path. All other transformer failures end
        // the turn through the standard error finalizer.
        if (isAbortError(error)) {
          releaseTransportController({ controllerRef, controller, setTransportBusy });
          return;
        }
        finalizeError(toError(error));
      });
  }, [appendAssistantNow, appendAssistantReasoningNow, appendAssistantSourceNow, appendToolDeltaNow, controllerRef, doStream, historyForTransport, invalidateAssistantSession, isAssistantSessionActive, minAssistantDelayMsRef, observers, removePendingAssistant, setTransportBusy, showStreamError, systemPromptRef, transformRequestRef]);

  const decideToolLoopContinuation = React.useCallback(async (
    iteration: number,
    assistantMessage: Message<TMeta> | null,
    toolMessages: ToolMessage<TMeta>[],
    response: Response | undefined,
    signal: AbortSignal,
  ): Promise<ToolLoopDecision> => decideTransportToolLoopContinuation({
    iteration,
    assistantMessage,
    toolMessages,
    response,
    signal,
    messages: messagesRef.current,
    autoContinueTools: autoContinueToolsRef.current,
    maxToolIterations: maxToolIterationsRef.current,
    shouldContinueToolLoop: shouldContinueToolLoopRef.current,
  }), [autoContinueToolsRef, maxToolIterationsRef, messagesRef, shouldContinueToolLoopRef]);

  const safeDecideToolLoopContinuation = React.useCallback(async (
    sessionId: number,
    iteration: number,
    assistantMessage: Message<TMeta> | null,
    toolMessages: ToolMessage<TMeta>[],
    response: Response | undefined,
    signal: AbortSignal,
  ): Promise<ToolLoopDecision> => {
    try {
      return await decideToolLoopContinuation(iteration, assistantMessage, toolMessages, response, signal);
    } catch (decisionError) {
      if (!isAbortError(decisionError) && isAssistantSessionActive(sessionId)) {
        // shouldContinueToolLoop threw. Surface a terminal callback so observers see the
        // turn end before the error is reported via onError.
        observers.safeOnStreamDone(createTerminalStreamDoneContext({
          assistantMessage,
          toolMessages,
          messages: messagesRef.current,
          response,
          reason: 'tool-loop-veto',
          iteration: iteration + 1,
          maxToolIterations: normalizeMaxToolIterations(maxToolIterationsRef.current),
        }));
      }
      throw decisionError;
    }
  }, [decideToolLoopContinuation, isAssistantSessionActive, maxToolIterationsRef, messagesRef, observers]);

  const finishTransportStream = React.useCallback<FinishTransportStream>(async (sessionId, response, controller, iteration) => {
    const toolMessageIds = new Set(pendingToolMessageIdsRef.current);
    let keepTransportBusy = false;

    try {
      await runCompletedToolCalls(sessionId, getToolMessagesByIds(toolMessageIds), controller.signal);
      if (!isAssistantSessionActive(sessionId)) return;

      const assistantMessage = finalizeAssistantNow();

      const toolMessages = getToolMessagesByIds(toolMessageIds);
      const decision = await safeDecideToolLoopContinuation(
        sessionId,
        iteration,
        assistantMessage,
        toolMessages,
        response,
        controller.signal,
      );
      if (!isAssistantSessionActive(sessionId)) return;

      // Fire onFinish only on the terminal iteration. An autoContinueTools turn
      // runs finishTransportStream once per loop iteration; emitting here, after
      // the continuation decision, keeps onFinish to the documented once-per-turn
      // contract instead of firing for every intermediate iteration that streamed
      // assistant text.
      if (!decision.willContinue) {
        emitFinishForAssistantMessage({
          assistantMessage,
          response,
          messages: messagesRef.current,
          observers,
        });
      }

      observers.safeOnStreamDone(createStreamDoneContext({
        assistantMessage,
        toolMessages,
        messages: messagesRef.current,
        response,
        decision,
      }));

      if (decision.willContinue) {
        keepTransportBusy = true;
        startTransportStream(sessionId, '', messagesRef.current, controller, iteration + 1);
        return;
      }

      invalidateAssistantSession(sessionId);
    } catch (error) {
      finalizeTransportFinishError({
        sessionId,
        error,
        isAssistantSessionActive,
        resetPendingAssistantState,
        invalidateAssistantSession,
        forceRender,
        observers,
        showStreamError,
      });
    } finally {
      if (!keepTransportBusy) {
        releaseTransportController({ controllerRef, controller, setTransportBusy });
      }
    }
  }, [controllerRef, finalizeAssistantNow, forceRender, getToolMessagesByIds, invalidateAssistantSession, isAssistantSessionActive, messagesRef, observers, pendingToolMessageIdsRef, resetPendingAssistantState, runCompletedToolCalls, safeDecideToolLoopContinuation, setTransportBusy, showStreamError, startTransportStream]);

  finishTransportStreamRef.current = finishTransportStream;

  return { historyForTransport, startTransportStream, decideToolLoopContinuation };
}
