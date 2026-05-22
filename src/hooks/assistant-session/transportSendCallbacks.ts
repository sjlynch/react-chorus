import type { MessageSource } from '../../types';
import type { ConnectorToolDelta, ConnectorWarning } from '../../connectors/connectors';
import type { SendCallbacks } from '../useChorusStream';
import type { ObserverCallbacks } from './observerCallbacks';

export interface TransportSendCallbacksDeps<TMeta> {
  sessionId: number;
  isAssistantSessionActive: (sessionId: number) => boolean;
  appendAssistantNow: (chunk: string) => void;
  appendAssistantReasoningNow: (chunk: string) => void;
  appendAssistantSourceNow: (source: MessageSource) => void;
  appendToolDeltaNow: (delta: ConnectorToolDelta) => void;
  observers: Pick<ObserverCallbacks<TMeta>, 'safeOnStreamWarning' | 'safeOnStreamMetadata'>;
  onDone: (response: Response | undefined) => void;
  onError: (err: Error) => void;
  minDelayMs: number;
}

/**
 * Builds the `SendCallbacks` bag passed to `doStream` from the transport-lifecycle layer.
 * Each delegating callback is guarded by `isAssistantSessionActive(sessionId)` so a
 * stale stream that outlives its session is dropped silently; control-flow callbacks
 * (`onDone`, `onError`) are passed through unchanged so the caller keeps the
 * start / finalize-on-done / finalize-on-error shape visible at the call site.
 */
export function createTransportSendCallbacks<TMeta>({
  sessionId,
  isAssistantSessionActive,
  appendAssistantNow,
  appendAssistantReasoningNow,
  appendAssistantSourceNow,
  appendToolDeltaNow,
  observers,
  onDone,
  onError,
  minDelayMs,
}: TransportSendCallbacksDeps<TMeta>): SendCallbacks {
  const ifActive = <T>(fn: (arg: T) => void) => (arg: T) => {
    if (isAssistantSessionActive(sessionId)) fn(arg);
  };
  const onWarning = (warning: ConnectorWarning) => {
    if (isAssistantSessionActive(sessionId)) observers.safeOnStreamWarning(warning);
  };
  const onMetadata = (metadata: Record<string, unknown>) => {
    if (isAssistantSessionActive(sessionId)) observers.safeOnStreamMetadata(metadata);
  };
  return {
    onChunk: ifActive(appendAssistantNow),
    onReasoning: ifActive(appendAssistantReasoningNow),
    onSource: ifActive(appendAssistantSourceNow),
    onToolDelta: ifActive(appendToolDeltaNow),
    onWarning,
    onMetadata,
    onDone,
    onError,
    minDelayMs,
  };
}
