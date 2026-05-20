import React from 'react';
import type { Message, ToolMessage } from '../../types';
import type { ConnectorToolDelta } from '../../connectors/connectors';
import { createAbortError, isAbortError, toError } from '../../utils/errors';
import type { SendCallbacks } from '../useChorusStream';
import { hasToolOutput } from './messageUtils';
import { normalizeMaxToolIterations } from './toolLoop';
import type { ObserverCallbacks } from './observerCallbacks';
import type { ChorusShouldContinueToolLoop, ChorusStreamDoneReason } from './types';

export interface ToolLoopDecision {
  reason: ChorusStreamDoneReason;
  iteration: number;
  maxToolIterations: number;
  willContinue: boolean;
}

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
  isAssistantSessionActive: (sessionId: number) => boolean;
  invalidateAssistantSession: (sessionId?: number) => void;
  removePendingAssistant: () => void;
  setTransportBusy: (next: boolean) => void;
  appendAssistantNow: (chunk: string) => void;
  appendAssistantReasoningNow: (chunk: string) => void;
  appendToolDeltaNow: (delta: ConnectorToolDelta) => void;
  finalizeAssistantNow: () => Message<TMeta> | null;
  resetPendingAssistantState: () => void;
  getToolMessagesByIds: (ids: Set<string>) => ToolMessage<TMeta>[];
  runCompletedToolCalls: (sessionId: number, toolMessages: ToolMessage<TMeta>[], signal: AbortSignal) => Promise<void>;
  showStreamError: (error: Error) => void;
  observers: Pick<ObserverCallbacks<TMeta>, 'safeOnError' | 'safeOnFinish' | 'safeOnStreamDone' | 'safeOnStreamWarning'>;
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
    isAssistantSessionActive,
    invalidateAssistantSession,
    removePendingAssistant,
    setTransportBusy,
    appendAssistantNow,
    appendAssistantReasoningNow,
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
    systemPromptRef.current
      ? [{ id: 'chorus-system-prompt', role: 'system' as const, text: systemPromptRef.current }, ...history]
      : history
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
    void doStream(text, historyForTransport(history), {
      onChunk: (chunk) => {
        if (isAssistantSessionActive(sessionId)) appendAssistantNow(chunk);
      },
      onReasoning: (chunk) => {
        if (isAssistantSessionActive(sessionId)) appendAssistantReasoningNow(chunk);
      },
      onToolDelta: (delta) => {
        if (isAssistantSessionActive(sessionId)) appendToolDeltaNow(delta);
      },
      onWarning: (warning) => {
        if (isAssistantSessionActive(sessionId)) observers.safeOnStreamWarning(warning);
      },
      onDone: (response) => {
        if (!isAssistantSessionActive(sessionId)) return;
        void finishTransportStreamRef.current?.(sessionId, response, controller, iteration);
      },
      onError: (err) => {
        if (!isAssistantSessionActive(sessionId)) return;
        removePendingAssistant();
        invalidateAssistantSession(sessionId);
        setTransportBusy(false);
        if (controllerRef.current === controller) controllerRef.current = null;
        observers.safeOnError(err);
        showStreamError(err);
      },
      minDelayMs: minAssistantDelayMsRef.current,
    }, controller.signal).catch(() => {
      setTransportBusy(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    });
  }, [appendAssistantNow, appendAssistantReasoningNow, appendToolDeltaNow, controllerRef, doStream, historyForTransport, invalidateAssistantSession, isAssistantSessionActive, minAssistantDelayMsRef, observers, removePendingAssistant, setTransportBusy, showStreamError]);

  const decideToolLoopContinuation = React.useCallback(async (
    iteration: number,
    assistantMessage: Message<TMeta> | null,
    toolMessages: ToolMessage<TMeta>[],
    response: Response | undefined,
    signal: AbortSignal,
  ): Promise<ToolLoopDecision> => {
    const maxToolIterations = normalizeMaxToolIterations(maxToolIterationsRef.current);
    const completedIteration = iteration + 1;

    if (!autoContinueToolsRef.current || !toolMessages.length || !toolMessages.every(hasToolOutput)) {
      return { reason: 'completed', iteration: completedIteration, maxToolIterations, willContinue: false };
    }

    if (completedIteration > maxToolIterations) {
      return { reason: 'max-tool-iterations', iteration: completedIteration, maxToolIterations, willContinue: false };
    }

    if (signal.aborted) throw createAbortError();

    const userDecision = await shouldContinueToolLoopRef.current?.({
      assistantMessage,
      toolMessages,
      messages: messagesRef.current,
      response,
      iteration: completedIteration,
      maxToolIterations,
      signal,
    });
    if (signal.aborted) throw createAbortError();

    const willContinue = userDecision ?? true;
    return {
      reason: willContinue ? 'tool-loop-continue' : 'tool-loop-veto',
      iteration: completedIteration,
      maxToolIterations,
      willContinue,
    };
  }, [autoContinueToolsRef, maxToolIterationsRef, messagesRef, shouldContinueToolLoopRef]);

  const emitFinishForAssistantMessage = React.useCallback((
    assistantMessage: Message<TMeta> | null,
    response: Response | undefined,
  ) => {
    if (!assistantMessage) return;
    observers.safeOnFinish({
      message: assistantMessage,
      messages: messagesRef.current,
      reason: 'done',
      response,
    });
  }, [messagesRef, observers]);

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
        observers.safeOnStreamDone({
          assistantMessage,
          toolMessages,
          messages: messagesRef.current,
          response,
          reason: 'tool-loop-veto',
          willContinue: false,
          iteration: iteration + 1,
          maxToolIterations: normalizeMaxToolIterations(maxToolIterationsRef.current),
        });
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
      emitFinishForAssistantMessage(assistantMessage, response);

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

      observers.safeOnStreamDone({
        assistantMessage,
        toolMessages,
        messages: messagesRef.current,
        response,
        reason: decision.reason,
        willContinue: decision.willContinue,
        iteration: decision.iteration,
        maxToolIterations: decision.maxToolIterations,
      });

      if (decision.willContinue) {
        keepTransportBusy = true;
        startTransportStream(sessionId, '', messagesRef.current, controller, iteration + 1);
        return;
      }

      invalidateAssistantSession(sessionId);
    } catch (error) {
      if (!isAssistantSessionActive(sessionId)) return;
      resetPendingAssistantState();
      invalidateAssistantSession(sessionId);
      forceRender();

      if (!isAbortError(error)) {
        const normalizedError = toError(error);
        observers.safeOnError(normalizedError);
        showStreamError(normalizedError);
      }
    } finally {
      if (!keepTransportBusy) {
        setTransportBusy(false);
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    }
  }, [controllerRef, emitFinishForAssistantMessage, finalizeAssistantNow, forceRender, getToolMessagesByIds, invalidateAssistantSession, isAssistantSessionActive, messagesRef, observers, pendingToolMessageIdsRef, resetPendingAssistantState, runCompletedToolCalls, safeDecideToolLoopContinuation, setTransportBusy, showStreamError, startTransportStream]);

  finishTransportStreamRef.current = finishTransportStream;

  return { historyForTransport, startTransportStream, decideToolLoopContinuation };
}
