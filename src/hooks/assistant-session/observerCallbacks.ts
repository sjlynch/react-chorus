import type React from 'react';
import type { ConnectorWarning } from '../../connectors/connectors';
import type {
  ChorusAbortContext,
  ChorusFinishContext,
  ChorusOnAbort,
  ChorusOnFinish,
  ChorusOnStreamDone,
  ChorusOnToolCall,
  ChorusOnToolDelta,
  ChorusStreamDoneContext,
  ChorusToolCallContext,
  ChorusToolDeltaContext,
} from './types';
import { warnObserverError } from './observer';

export interface ObserverCallbackRefs<TMeta> {
  onChunkRef: React.MutableRefObject<((chunk: string, messageId: string) => void) | undefined>;
  onErrorRef: React.MutableRefObject<((error: Error) => void) | undefined>;
  onFinishRef: React.MutableRefObject<ChorusOnFinish<TMeta> | undefined>;
  onAbortRef: React.MutableRefObject<ChorusOnAbort<TMeta> | undefined>;
  onStreamDoneRef: React.MutableRefObject<ChorusOnStreamDone<TMeta> | undefined>;
  onStreamWarningRef: React.MutableRefObject<((warning: ConnectorWarning) => void) | undefined>;
  onStreamMetadataRef: React.MutableRefObject<((metadata: Record<string, unknown>) => void) | undefined>;
  onToolDeltaRef: React.MutableRefObject<ChorusOnToolDelta<TMeta> | undefined>;
  onToolCallRef: React.MutableRefObject<ChorusOnToolCall<TMeta> | undefined>;
}

export interface ObserverCallbacks<TMeta> {
  safeOnChunk: (chunk: string, messageId: string) => void;
  safeOnError: (error: Error) => void;
  safeOnFinish: (context: ChorusFinishContext<TMeta>) => void;
  safeOnAbort: (context: ChorusAbortContext<TMeta>) => void;
  safeOnStreamDone: (context: ChorusStreamDoneContext<TMeta>) => void;
  safeOnStreamWarning: (warning: ConnectorWarning) => void;
  safeOnStreamMetadata: (metadata: Record<string, unknown>) => void;
  safeOnToolDelta: (context: ChorusToolDeltaContext<TMeta>) => void;
  safeNotifyToolCall: (context: ChorusToolCallContext<TMeta>) => Promise<void>;
}

/**
 * Build try/catch wrappers around the host-supplied observer callbacks. The
 * returned functions read the latest callback from each ref on every call, so
 * the factory can be invoked once per `useAssistantSession` instance.
 */
export function createObserverCallbacks<TMeta>(refs: ObserverCallbackRefs<TMeta>): ObserverCallbacks<TMeta> {
  const { onChunkRef, onErrorRef, onFinishRef, onAbortRef, onStreamDoneRef, onStreamWarningRef, onStreamMetadataRef, onToolDeltaRef, onToolCallRef } = refs;

  return {
    safeOnChunk: (chunk, messageId) => {
      try { onChunkRef.current?.(chunk, messageId); }
      catch (error) { warnObserverError('onChunk', error); }
    },
    safeOnError: (error) => {
      try { onErrorRef.current?.(error); }
      catch (callbackError) { warnObserverError('onError', callbackError); }
    },
    safeOnFinish: (context) => {
      try { onFinishRef.current?.(context); }
      catch (error) { warnObserverError('onFinish', error); }
    },
    safeOnAbort: (context) => {
      try { onAbortRef.current?.(context); }
      catch (error) { warnObserverError('onAbort', error); }
    },
    safeOnStreamDone: (context) => {
      try { onStreamDoneRef.current?.(context); }
      catch (error) { warnObserverError('onStreamDone', error); }
    },
    safeOnStreamWarning: (warning) => {
      try { onStreamWarningRef.current?.(warning); }
      catch (error) { warnObserverError('onStreamWarning', error); }
    },
    safeOnStreamMetadata: (metadata) => {
      try { onStreamMetadataRef.current?.(metadata); }
      catch (error) { warnObserverError('onStreamMetadata', error); }
    },
    safeOnToolDelta: (context) => {
      try { onToolDeltaRef.current?.(context); }
      catch (error) { warnObserverError('onToolDelta', error); }
    },
    safeNotifyToolCall: async (context) => {
      try { await onToolCallRef.current?.(context); }
      catch (error) { warnObserverError('onToolCall', error); }
    },
  };
}
