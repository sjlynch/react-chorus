import type React from 'react';
import type { ConnectorToolDelta, ConnectorWarning } from '../../connectors/connectors';
import type { SendCallbacks } from '../useChorusStream';
import type { ChorusFinishContext, ChorusSendHelpers } from './types';

export interface SessionHelpersDeps<TMeta> {
  appendAssistantNow: (chunk: string) => void;
  appendAssistantReasoningNow: (chunk: string) => void;
  appendToolDeltaNow: (delta: ConnectorToolDelta) => void;
  safeOnStreamWarning: (warning: ConnectorWarning) => void;
  completeActiveSession: (
    sessionId: number,
    finish?: { reason: ChorusFinishContext<TMeta>['reason']; response?: Response; message?: import('../../types').Message<TMeta> },
  ) => import('../../types').Message<TMeta> | null;
  isAssistantSessionActive: (sessionId: number) => boolean;
  minAssistantDelayMsRef: React.MutableRefObject<number>;
  systemPromptRef: React.MutableRefObject<string | undefined>;
  hasStartedAssistantRef: React.MutableRefObject<boolean>;
}

export interface SessionHelpersBundle {
  helpers: ChorusSendHelpers;
  hasPendingAssistant: () => boolean;
  hasAssistantOutput: () => boolean;
  wasFinalizeRequested: () => boolean;
  autoFinalizeAssistant: () => void;
}

/**
 * Build the `ChorusSendHelpers` exposed to a user-supplied `onSend`. Buffers
 * helper invocations until `minAssistantDelayMs` elapses so hosts can resolve
 * synchronously without flashing partial assistant state.
 */
export function createSessionHelpers<TMeta>(
  deps: SessionHelpersDeps<TMeta>,
  sessionId: number,
  signal: AbortSignal,
  startedAt: number,
): SessionHelpersBundle {
  const {
    appendAssistantNow,
    appendAssistantReasoningNow,
    appendToolDeltaNow,
    safeOnStreamWarning,
    completeActiveSession,
    isAssistantSessionActive,
    minAssistantDelayMsRef,
    systemPromptRef,
    hasStartedAssistantRef,
  } = deps;

  type BufferedHelperEvent =
    | { type: 'text'; chunk: string }
    | { type: 'reasoning'; chunk: string }
    | { type: 'toolDelta'; delta: ConnectorToolDelta };

  let released = minAssistantDelayMsRef.current <= 0;
  let bufferedEvents: BufferedHelperEvent[] = [];
  let finalizeRequested = false;
  let finalizeCalled = false;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;

  const clearReleaseTimer = () => {
    if (releaseTimer !== null) {
      clearTimeout(releaseTimer);
      releaseTimer = null;
    }
  };

  const isActive = () => isAssistantSessionActive(sessionId) && !signal.aborted;

  const deliverEvent = (event: BufferedHelperEvent) => {
    if (!isActive()) return;
    if (event.type === 'text') appendAssistantNow(event.chunk);
    else if (event.type === 'reasoning') appendAssistantReasoningNow(event.chunk);
    else appendToolDeltaNow(event.delta);
  };

  const flushBufferedEvents = () => {
    clearReleaseTimer();
    if (released) return;
    if (!isActive()) {
      bufferedEvents = [];
      finalizeRequested = false;
      return;
    }

    released = true;
    const events = bufferedEvents;
    bufferedEvents = [];
    for (const event of events) deliverEvent(event);
    if (finalizeRequested) completeActiveSession(sessionId, { reason: 'done' });
  };

  const scheduleRelease = () => {
    if (released || releaseTimer !== null) return;
    const wait = Math.max(0, minAssistantDelayMsRef.current - (Date.now() - startedAt));
    if (wait <= 0) {
      flushBufferedEvents();
      return;
    }
    releaseTimer = setTimeout(flushBufferedEvents, wait);
  };

  const appendEvent = (event: BufferedHelperEvent) => {
    if (!isActive()) return;
    if ((event.type === 'text' || event.type === 'reasoning') && !event.chunk) return;

    if (released || Date.now() - startedAt >= minAssistantDelayMsRef.current) {
      if (!released) flushBufferedEvents();
      deliverEvent(event);
      return;
    }

    bufferedEvents.push(event);
    scheduleRelease();
  };

  const appendAssistant = (chunk: string) => appendEvent({ type: 'text', chunk });
  const appendReasoning = (chunk: string) => appendEvent({ type: 'reasoning', chunk });
  const appendToolDelta = (delta: ConnectorToolDelta) => appendEvent({ type: 'toolDelta', delta });

  const requestFinalize = (forceFlush: boolean) => {
    if (!isActive()) return;

    if (!released && bufferedEvents.length > 0) {
      finalizeRequested = true;
      if (forceFlush) flushBufferedEvents();
      else scheduleRelease();
      return;
    }

    clearReleaseTimer();
    completeActiveSession(sessionId, { reason: 'done' });
  };

  const finalizeAssistant = () => {
    finalizeCalled = true;
    requestFinalize(false);
  };

  const autoFinalizeAssistant = () => requestFinalize(true);

  const streamCallbacks = (): SendCallbacks => ({
    onChunk: appendAssistant,
    onReasoning: appendReasoning,
    onToolDelta: appendToolDelta,
    onWarning: safeOnStreamWarning,
    onDone: finalizeAssistant,
  });

  return {
    helpers: { appendAssistant, appendReasoning, appendToolDelta, finalizeAssistant, streamCallbacks, signal, systemPrompt: systemPromptRef.current },
    hasPendingAssistant: () => bufferedEvents.length > 0 || finalizeRequested,
    hasAssistantOutput: () => hasStartedAssistantRef.current || bufferedEvents.length > 0,
    wasFinalizeRequested: () => finalizeCalled,
    autoFinalizeAssistant,
  };
}
