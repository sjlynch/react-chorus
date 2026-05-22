import type React from 'react';
import type { ConnectorToolDelta, ConnectorWarning } from '../../connectors/connectors';
import type { MessageSource } from '../../types';
import type { SendCallbacks } from '../useChorusStream';
import type { ChorusFinishContext, ChorusSendHelpers } from './types';

export interface SessionHelpersDeps<TMeta> {
  appendAssistantNow: (chunk: string) => void;
  appendAssistantReasoningNow: (chunk: string) => void;
  appendAssistantSourceNow: (source: MessageSource) => void;
  appendToolDeltaNow: (delta: ConnectorToolDelta) => void;
  safeOnStreamWarning: (warning: ConnectorWarning) => void;
  safeOnStreamMetadata: (metadata: Record<string, unknown>) => void;
  completeActiveSession: (
    sessionId: number,
    finish?: { reason: ChorusFinishContext<TMeta>['reason']; response?: Response; message?: import('../../types').Message<TMeta> },
  ) => import('../../types').Message<TMeta> | null;
  isAssistantSessionActive: (sessionId: number) => boolean;
  /**
   * Surface a stream error on the `onSend` path: drop the half-streamed
   * partial assistant message, close the session, release `sending`, and
   * route the error to the `onError` observer and the UI banner. Shared with
   * `startOnSendLifecycle`'s catch so a rejected `onSend` promise and a
   * bridged `streamCallbacks().onError` clean up identically — see
   * `onSendLifecycle.ts`.
   */
  reportStreamError: (rawError: unknown) => void;
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
    appendAssistantSourceNow,
    appendToolDeltaNow,
    safeOnStreamWarning,
    safeOnStreamMetadata,
    completeActiveSession,
    isAssistantSessionActive,
    reportStreamError,
    minAssistantDelayMsRef,
    systemPromptRef,
    hasStartedAssistantRef,
  } = deps;

  type BufferedHelperEvent =
    | { type: 'text'; chunk: string }
    | { type: 'reasoning'; chunk: string }
    | { type: 'source'; source: MessageSource }
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
    else if (event.type === 'source') appendAssistantSourceNow(event.source);
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
  const appendSource = (source: MessageSource) => appendEvent({ type: 'source', source });
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

  /**
   * `onError` for the bridged callback set. `useChorusStream.send()` rejects
   * on a non-abort stream error, but a host whose `onSend` does not
   * return/await that promise never lets `startOnSendLifecycle`'s catch see
   * it — so without this the error would vanish: no banner, no `onError`, and
   * any half-streamed partial left committed. Routing it through
   * `reportStreamError` surfaces the failure regardless of what `onSend`
   * returns.
   *
   * Guards before reporting:
   * - `signal.aborted` — a user stop, conversation switch, or superseding
   *   send already owns this turn's teardown; surfacing a stale error would
   *   clobber it.
   * - `isAssistantSessionActive(sessionId + 1)` — when this session closes
   *   normally it leaves the active id one ahead of `sessionId` (see
   *   `invalidateAssistantSession`). Accepting that placeholder lets a
   *   just-finished bridged turn still surface its error, while a stream that
   *   errors after the user already started another turn (active id two or
   *   more ahead) is dropped so it cannot delete the new turn's messages.
   */
  const handleStreamError = (error: Error) => {
    if (signal.aborted) return;
    if (!isAssistantSessionActive(sessionId) && !isAssistantSessionActive(sessionId + 1)) return;
    reportStreamError(error);
  };

  const streamCallbacks = (): SendCallbacks => ({
    onChunk: appendAssistant,
    onReasoning: appendReasoning,
    onSource: appendSource,
    onToolDelta: appendToolDelta,
    onWarning: safeOnStreamWarning,
    onMetadata: safeOnStreamMetadata,
    onDone: finalizeAssistant,
    onError: handleStreamError,
  });

  return {
    helpers: { appendAssistant, appendReasoning, appendSource, appendToolDelta, finalizeAssistant, streamCallbacks, signal, systemPrompt: systemPromptRef.current },
    hasPendingAssistant: () => bufferedEvents.length > 0 || finalizeRequested,
    hasAssistantOutput: () => hasStartedAssistantRef.current || bufferedEvents.length > 0,
    wasFinalizeRequested: () => finalizeCalled,
    autoFinalizeAssistant,
  };
}
