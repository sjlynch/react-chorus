import type { Connector, ConnectorResult } from '../../connectors/connectors';
import type { Message } from '../../types';
import { readSSEStream } from '../../streaming/readSSEStream';
import { ChorusStreamError, createHttpResponseError } from '../../streaming/errors';
import { isAbortError, toError } from '../../streaming/internal/streamErrors';
import type { DelayedChunkEmitter } from './connectorDelivery';
import { errorFromEventErrorFrame, isIgnoredKeepaliveEvent } from './namedSSEEvents';
import { safeOnObserverError } from './observer';
import type { StreamSession } from './session';
import type { SendCallbacks, Transport } from './types';

export type StreamPromiseRef = { current: Promise<void> | null };

/**
 * Drives the success path: invoke the transport, validate the response,
 * pump the SSE reader, flush the connector, then deliver buffered events
 * and call cb.onDone. Throws connector/HTTP/transport errors so the caller
 * can route them through `handleSendError`. Stores the SSE reader promise
 * into `streamPromiseRef.current` as soon as it starts so the error branch
 * can await it during teardown.
 *
 * Returns the cb.onDone callback error (if onDone threw); otherwise undefined.
 * onDone errors are caught here so they reject send() without going through
 * the onError observer — there was no stream error to report.
 */
export async function runSendStream<TMeta>(args: {
  text: string;
  history: Message<TMeta>[];
  transport: Transport<TMeta>;
  connector: Connector;
  session: StreamSession;
  delayedChunks: DelayedChunkEmitter;
  deliverConnectorResult: (out: ConnectorResult | null | undefined) => boolean;
  cb: SendCallbacks;
  streamPromiseRef: StreamPromiseRef;
}): Promise<unknown | undefined> {
  const { text, history, transport, connector, session, delayedChunks, deliverConnectorResult, cb, streamPromiseRef } = args;
  const connectorState = connector.createState?.();

  const res = await transport(text, history, session.signal);
  if (!res.ok) throw await createHttpResponseError(res);
  if (!res.body) throw new ChorusStreamError(`Response body was missing for HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);

  const streamPromise = readSSEStream(res, (payload, eventName) => {
    // Route named SSE `event:` frames before the connector runs. `event: error`
    // is surfaced as a ChorusStreamError regardless of its data shape (instead of
    // letting the connector type a bare error string into the assistant message);
    // `event: heartbeat`/`ping` keepalives are dropped so a `{}`/empty payload is
    // never rendered. Unnamed frames and the SSE-default `event: message` dispatch
    // to the connector unchanged.
    if (eventName === 'error') throw errorFromEventErrorFrame(payload);
    if (isIgnoredKeepaliveEvent(eventName)) return;
    const done = deliverConnectorResult(connector.extract(payload, connectorState));
    if (done) return false;
  }, session.readerController.signal);
  streamPromiseRef.current = streamPromise;

  await Promise.race([streamPromise, delayedChunks.callbackErrorPromise]);
  await streamPromise;

  deliverConnectorResult(connector.flush?.(connectorState));
  await delayedChunks.flushBeforeDone();

  try {
    cb.onDone?.(res);
  } catch (callbackError) {
    // Completion observers run after the stream has succeeded. Preserve the
    // historical contract that their failures reject send(), but do not route
    // them through onError because there is no underlying stream error.
    return callbackError;
  }
  return undefined;
}

/**
 * Drives the error path: cancel the reader, drain any in-flight SSE read,
 * then prefer a captured observer-callback error over the caught error
 * (delayed observer throws surface here even if the stream itself raced to
 * resolve first). AbortErrors are swallowed silently — the caller already
 * sees `sending: false`. Other errors are reported to cb.onError (whose
 * own throws are warned-and-ignored so the original stream error wins) and
 * returned for send() to reject with.
 */
export async function handleSendError(args: {
  caught: unknown;
  session: StreamSession;
  streamPromise: Promise<void> | null;
  delayedChunks: DelayedChunkEmitter;
  cb: SendCallbacks;
}): Promise<unknown | undefined> {
  const { caught, session, streamPromise, delayedChunks, cb } = args;
  session.readerController.abort();
  if (streamPromise) await streamPromise.catch(() => undefined);
  const caughtError = delayedChunks.getCallbackError() ?? caught;
  delayedChunks.cancel();
  if (isAbortError(caughtError)) return undefined;

  const error = toError(caughtError);
  try {
    cb.onError?.(error);
  } catch (callbackError) {
    safeOnObserverError('onError', callbackError);
  }
  return error;
}
