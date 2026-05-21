import React from 'react';
import { getConnector } from '../connectors/connectors';
import { useLatestRef } from './useLatestRef';
import { createDelayedChunkEmitter } from '../streaming/delayedStreamEvents';
import { createToolDeltaAccumulator } from '../streaming/toolDeltaAccumulator';
import { ChorusStreamError } from '../streaming/errors';
import { warnInDev } from '../streaming/internal/devMode';
import { createConnectorResultDeliverer } from './chorus-stream/connectorDelivery';
import { endStreamSession, removeForwardAbort, startStreamSession, type StreamSession } from './chorus-stream/session';
import { handleSendError, runSendStream, type StreamPromiseRef } from './chorus-stream/sendLifecycle';
import type { Message } from '../types';
import type { SendCallbacks, StreamOptions, Transport } from './chorus-stream/types';

export { readSSEStream } from '../streaming/readSSEStream';
export { ChorusStreamError } from '../streaming/errors';
export type { SendCallbacks, StreamOptions, Transport } from './chorus-stream/types';

export function useChorusStream<TMeta = Record<string, unknown>>(transport: Transport<TMeta>, opts?: StreamOptions) {
  const connector = getConnector(opts?.connector, opts?.connectorOptions);
  const transportRef = useLatestRef(transport);
  const connectorRef = useLatestRef(connector);

  const [sending, setSending] = React.useState(false);
  const isSendingRef = React.useRef(false);
  const controllerRef = React.useRef<AbortController | null>(null);
  const sessionRef = React.useRef<StreamSession | null>(null);

  React.useEffect(() => () => {
    if (isSendingRef.current && !controllerRef.current) {
      warnInDev('[Chorus] useChorusStream unmounted while a send started with an externalSignal was in flight; the hook cannot cancel it. Abort the externalSignal you passed to send() from your own cleanup to stop the stream.');
    }
    controllerRef.current?.abort();
    // Aborting a hook-owned controller above already fires `forwardAbort` (a
    // `{ once: true }` listener that self-removes). With a caller-owned
    // externalSignal there is no hook controller to abort, so `forwardAbort`
    // stays attached to that signal — drop it here so a long-lived signal does
    // not accumulate listeners across repeated mount/unmount cycles. The
    // in-flight send's own teardown also calls this; it is idempotent.
    if (sessionRef.current) removeForwardAbort(sessionRef.current);
  }, []);

  /**
   * Start a streaming send.
   *
   * Throws a {@link ChorusStreamError} with `code: 'concurrent-send'` if a previous send is
   * still in flight; await the previous send or call abort() before re-sending.
   *
   * Throws a {@link ChorusStreamError} with `code: 'already-aborted'` if `externalSignal`
   * is already aborted when send() is called; the send is not started, the transport is
   * not invoked, and no callbacks fire. This lets callers distinguish 'send refused
   * because the signal was already aborted' from 'send completed successfully'.
   *
   * @param externalSignal Optional caller-owned AbortSignal. When supplied, the caller
   *   takes ownership of cancellation: the hook's own abort() and unmount cleanup will
   *   NOT cancel an in-flight send (the hook emits a dev-mode warning in those cases).
   *   Abort the externalSignal yourself to cancel the stream.
   */
  const send = React.useCallback(async (text: string, history: Message<TMeta>[], cb: SendCallbacks, externalSignal?: AbortSignal) => {
    if (externalSignal?.aborted) {
      throw new ChorusStreamError(
        '[Chorus] useChorusStream.send was called with an externalSignal that was already aborted; the send was not started.',
        { code: 'already-aborted' },
      );
    }

    if (isSendingRef.current) {
      const message = '[Chorus] useChorusStream.send was called while a previous send is still in flight; the new call was ignored. Wait for the previous send to finish (await the promise) or call abort() before re-sending.';
      warnInDev(message);
      throw new ChorusStreamError(message, { code: 'concurrent-send' });
    }

    isSendingRef.current = true;
    const session = startStreamSession(externalSignal, controllerRef);
    sessionRef.current = session;
    setSending(true);

    const startedAt = Date.now();
    const delayedChunks = createDelayedChunkEmitter(cb, startedAt, session.signal);
    const accumulateToolDelta = createToolDeltaAccumulator();
    const activeConnector = connectorRef.current;
    const deliverConnectorResult = createConnectorResultDeliverer(cb, delayedChunks, accumulateToolDelta);

    const streamPromiseRef: StreamPromiseRef = { current: null };
    let errorToThrow: unknown;

    try {
      errorToThrow = await runSendStream({
        text,
        history,
        transport: transportRef.current,
        connector: activeConnector,
        session,
        delayedChunks,
        deliverConnectorResult,
        cb,
        streamPromiseRef,
      });
    } catch (e: unknown) {
      errorToThrow = await handleSendError({
        caught: e,
        session,
        streamPromise: streamPromiseRef.current,
        delayedChunks,
        cb,
      });
    } finally {
      endStreamSession(session, controllerRef, sessionRef);
      isSendingRef.current = false;
      setSending(false);
    }

    if (errorToThrow !== undefined) throw errorToThrow;
  }, [transportRef, connectorRef]);

  const abort = React.useCallback(() => {
    if (isSendingRef.current && !controllerRef.current) {
      warnInDev('[Chorus] useChorusStream.abort() was called while a send started with an externalSignal was in flight; the hook does not own that signal and cannot cancel the stream. Abort the externalSignal you passed to send() to stop the stream.');
    }
    controllerRef.current?.abort();
  }, []);
  return { send, abort, sending };
}
