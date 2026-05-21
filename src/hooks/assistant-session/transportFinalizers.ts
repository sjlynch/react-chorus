import type React from 'react';
import type { Message } from '../../types';
import { isAbortError, toError } from '../../utils/errors';
import type { ObserverCallbacks } from './observerCallbacks';

export interface TransportControllerCleanupDeps {
  controllerRef: React.MutableRefObject<AbortController | null>;
  controller: AbortController;
  setTransportBusy: (next: boolean) => void;
}

export function releaseTransportController({
  controllerRef,
  controller,
  setTransportBusy,
}: TransportControllerCleanupDeps): void {
  setTransportBusy(false);
  if (controllerRef.current === controller) controllerRef.current = null;
}

export interface TransportStreamErrorDeps<TMeta> extends TransportControllerCleanupDeps {
  sessionId: number;
  error: Error;
  isAssistantSessionActive: (sessionId: number) => boolean;
  removePendingAssistant: () => void;
  invalidateAssistantSession: (sessionId?: number) => void;
  observers: Pick<ObserverCallbacks<TMeta>, 'safeOnError'>;
  showStreamError: (error: Error) => void;
}

export function finalizeErroredTransportStream<TMeta>({
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
}: TransportStreamErrorDeps<TMeta>): void {
  if (!isAssistantSessionActive(sessionId)) return;
  removePendingAssistant();
  invalidateAssistantSession(sessionId);
  releaseTransportController({ controllerRef, controller, setTransportBusy });
  observers.safeOnError(error);
  showStreamError(error);
}

export interface AssistantFinishObserverDeps<TMeta> {
  assistantMessage: Message<TMeta> | null;
  response: Response | undefined;
  messages: Message<TMeta>[];
  observers: Pick<ObserverCallbacks<TMeta>, 'safeOnFinish'>;
}

export function emitFinishForAssistantMessage<TMeta>({
  assistantMessage,
  response,
  messages,
  observers,
}: AssistantFinishObserverDeps<TMeta>): void {
  if (!assistantMessage) return;
  observers.safeOnFinish({
    message: assistantMessage,
    messages,
    reason: 'done',
    response,
  });
}

export interface TransportFinishErrorDeps<TMeta> {
  sessionId: number;
  error: unknown;
  isAssistantSessionActive: (sessionId: number) => boolean;
  resetPendingAssistantState: () => void;
  invalidateAssistantSession: (sessionId?: number) => void;
  forceRender: () => void;
  observers: Pick<ObserverCallbacks<TMeta>, 'safeOnError'>;
  showStreamError: (error: Error) => void;
}

export function finalizeTransportFinishError<TMeta>({
  sessionId,
  error,
  isAssistantSessionActive,
  resetPendingAssistantState,
  invalidateAssistantSession,
  forceRender,
  observers,
  showStreamError,
}: TransportFinishErrorDeps<TMeta>): void {
  if (!isAssistantSessionActive(sessionId)) return;
  resetPendingAssistantState();
  invalidateAssistantSession(sessionId);
  forceRender();

  if (!isAbortError(error)) {
    const normalizedError = toError(error);
    observers.safeOnError(normalizedError);
    showStreamError(normalizedError);
  }
}
