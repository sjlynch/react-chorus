import React from 'react';
import type { ConnectorName, Message } from '../types';
import { getConnector, type Connector, type ConnectorResult, type ConnectorToolDelta } from '../connectors/connectors';
import { extractErrorMessage } from '../connectors/error';
import { useLatestRef } from './useLatestRef';
import { readSSEStream } from '../streaming/readSSEStream';
import { createDelayedChunkEmitter } from '../streaming/delayedStreamEvents';
import { createToolDeltaAccumulator } from '../streaming/toolDeltaAccumulator';
import { ChorusStreamError, createConnectorStreamError, createHttpResponseError } from '../streaming/errors';
import { isAbortError, toError } from '../streaming/internal/streamErrors';
import { warnInDev } from '../streaming/internal/devMode';

export { readSSEStream } from '../streaming/readSSEStream';
export { ChorusStreamError } from '../streaming/errors';

export interface SendCallbacks {
  /**
   * Optional notification fired when the first non-empty text stream chunk is delivered.
   * The same first text chunk is also delivered to onChunk.
   */
  onStart?: (firstChunk: string) => void;
  /** Receives every non-empty text stream chunk, including the first one. */
  onChunk: (chunk: string) => void;
  /** Receives non-empty reasoning/thinking chunks when the connector exposes them. */
  onReasoning?: (chunk: string) => void;
  /** Receives accumulated tool-call deltas when the connector exposes them. */
  onToolDelta?: (toolDelta: ConnectorToolDelta) => void;
  /**
   * Called after a successful stream completes. If this callback throws, send() rejects
   * with that callback error; onError is not invoked because no stream error occurred.
   */
  onDone?: (response?: Response) => void;
  /**
   * Called for non-abort stream errors. If this callback throws while handling an
   * error, the callback error is warned in development and send() still rejects
   * with the original stream error.
   */
  onError?: (err: Error) => void;
  /** Minimum elapsed time from send() start before delivering the first chunk. */
  minDelayMs?: number;
}

export type Transport<TMeta = Record<string, unknown>> = (text: string, history: Message<TMeta>[], signal: AbortSignal) => Promise<Response>;

export interface StreamOptions {
  connector?: Connector | ConnectorName;
}

function safeOnObserverError(callbackName: string, error: unknown) {
  warnInDev(`[Chorus] \`${callbackName}\` callback threw and was ignored so the original stream error could be re-thrown.`, error);
}

/**
 * Build a ChorusStreamError from the `data` payload of a named `event: error`
 * SSE frame. The payload may be JSON (`{ "error": ... }`, `{ "message": ... }`,
 * a bare JSON string) or non-JSON text; either way the frame is surfaced as an
 * error instead of being rendered as assistant text.
 */
function errorFromEventErrorFrame(payload: string): ChorusStreamError {
  let parsed: unknown = payload;
  try { parsed = JSON.parse(payload); } catch { /* non-JSON payload: keep the raw text */ }
  const message = (typeof parsed === 'string' ? parsed : extractErrorMessage(parsed))
    || payload || 'SSE `event: error` frame';
  return createConnectorStreamError(message, parsed);
}

function connectorErrorFromResult(out: ConnectorResult) {
  return out.error ? createConnectorStreamError(out.error, out.errorPayload) : null;
}

type DelayedChunkEmitter = ReturnType<typeof createDelayedChunkEmitter>;
type ToolDeltaAccumulator = ReturnType<typeof createToolDeltaAccumulator>;

/**
 * Abort-signal/controller wiring for one send. With an externalSignal the
 * caller owns cancellation and `controller` is null; otherwise the hook owns
 * an AbortController that abort()/unmount can cancel. `readerController` is
 * always hook-owned and bounds the SSE reader; `forwardAbort` is the
 * pre-installed listener that propagates the outer signal into the reader.
 */
type StreamSession = {
  signal: AbortSignal;
  controller: AbortController | null;
  readerController: AbortController;
  forwardAbort: (() => void) | null;
};

function startStreamSession(
  externalSignal: AbortSignal | undefined,
  controllerRef: React.MutableRefObject<AbortController | null>,
): StreamSession {
  let controller: AbortController | null = null;
  let signal: AbortSignal;

  if (externalSignal) {
    signal = externalSignal;
    controllerRef.current = null;
  } else {
    controller = new AbortController();
    controllerRef.current = controller;
    signal = controller.signal;
  }

  const readerController = new AbortController();
  let forwardAbort: (() => void) | null = null;
  if (signal.aborted) {
    readerController.abort();
  } else {
    forwardAbort = () => readerController.abort();
    signal.addEventListener('abort', forwardAbort, { once: true });
  }

  return { signal, controller, readerController, forwardAbort };
}

function endStreamSession(
  session: StreamSession,
  controllerRef: React.MutableRefObject<AbortController | null>,
) {
  if (session.forwardAbort) session.signal.removeEventListener('abort', session.forwardAbort);
  if (controllerRef.current === session.controller) controllerRef.current = null;
}

function createConnectorResultDeliverer(
  delayedChunks: DelayedChunkEmitter,
  accumulateToolDelta: ToolDeltaAccumulator,
) {
  return (out: ConnectorResult | null | undefined): boolean => {
    if (!out) return false;

    const chunk = out.text || '';
    if (chunk) delayedChunks.handleChunk(chunk);

    const reasoning = out.reasoning || '';
    if (reasoning) delayedChunks.handleReasoning(reasoning);

    const toolDeltas = out.toolDeltas?.length ? out.toolDeltas : out.toolDelta ? [out.toolDelta] : [];
    for (const toolDelta of toolDeltas) delayedChunks.handleToolDelta(accumulateToolDelta(toolDelta));

    // Non-fatal connector signals (truncation, safety ratings, telemetry events). Logged in
    // dev so they're discoverable; not yet routed to a typed callback. Stream keeps flowing.
    if (out.warning) warnInDev(`[Chorus] connector warning (${out.warning.code}): ${out.warning.message}`, out.warning.payload);

    const connectorError = connectorErrorFromResult(out);
    if (connectorError) throw connectorError;
    return Boolean(out.done);
  };
}

type StreamPromiseRef = { current: Promise<void> | null };

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
async function runSendStream<TMeta>(args: {
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
    if (eventName === 'heartbeat' || eventName === 'ping') return;
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
async function handleSendError(args: {
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

export function useChorusStream<TMeta = Record<string, unknown>>(transport: Transport<TMeta>, opts?: StreamOptions) {
  const connector = getConnector(opts?.connector);
  const transportRef = useLatestRef(transport);
  const connectorRef = useLatestRef(connector);

  const [sending, setSending] = React.useState(false);
  const isSendingRef = React.useRef(false);
  const controllerRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => {
    if (isSendingRef.current && !controllerRef.current) {
      warnInDev('[Chorus] useChorusStream unmounted while a send started with an externalSignal was in flight; the hook cannot cancel it. Abort the externalSignal you passed to send() from your own cleanup to stop the stream.');
    }
    controllerRef.current?.abort();
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
    setSending(true);

    const startedAt = Date.now();
    const delayedChunks = createDelayedChunkEmitter(cb, startedAt, session.signal);
    const accumulateToolDelta = createToolDeltaAccumulator();
    const activeConnector = connectorRef.current;
    const deliverConnectorResult = createConnectorResultDeliverer(delayedChunks, accumulateToolDelta);

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
      endStreamSession(session, controllerRef);
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
