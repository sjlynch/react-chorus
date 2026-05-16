import React from 'react';
import type { ConnectorName, Message } from '../types';
import { getConnector, type Connector, type ConnectorResult, type ConnectorToolDelta } from '../connectors/connectors';
import { useLatestRef } from './useLatestRef';
import { readSSEStream } from '../streaming/readSSEStream';
import { createDelayedChunkEmitter } from '../streaming/delayedStreamEvents';
import { createToolDeltaAccumulator } from '../streaming/toolDeltaAccumulator';
import { ChorusStreamError, createConnectorStreamError, createHttpResponseError } from '../streaming/errors';

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

// Local duplicates keep useChorusStream root imports free of UI-owned utility chunks.
function isStreamDevMode() {
  try {
    return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

function warnInDev(message: string, ...args: unknown[]): void {
  if (!isStreamDevMode()) return;
  console.warn(message, ...args);
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) return error as Error;
  return new Error(String(error));
}

function isAbortError(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name?: unknown }).name === 'AbortError';
}

function safeOnObserverError(callbackName: string, error: unknown) {
  warnInDev(`[Chorus] \`${callbackName}\` callback threw and was ignored so the original stream error could be re-thrown.`, error);
}

function connectorErrorFromResult(out: ConnectorResult) {
  return out.error ? createConnectorStreamError(out.error, out.errorPayload) : null;
}

export function useChorusStream<TMeta = Record<string, unknown>>(transport: Transport<TMeta>, opts?: StreamOptions) {
  const connector = getConnector(opts?.connector);
  const transportRef = useLatestRef(transport);
  const connectorRef = useLatestRef(connector);

  const [sending, setSending] = React.useState(false);
  const isSendingRef = React.useRef(false);
  const controllerRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => {
    controllerRef.current?.abort();
  }, []);

  const send = React.useCallback(async (text: string, history: Message<TMeta>[], cb: SendCallbacks, externalSignal?: AbortSignal) => {
    if (externalSignal?.aborted) return;

    if (isSendingRef.current) {
      warnInDev('[Chorus] useChorusStream.send was called while a previous send is still in flight; the new call was ignored. Wait for the previous send to finish (await the promise) or call abort() before re-sending.');
      return;
    }

    isSendingRef.current = true;

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

    setSending(true);
    const startedAt = Date.now();
    const delayedChunks = createDelayedChunkEmitter(cb, startedAt, signal);
    const accumulateToolDelta = createToolDeltaAccumulator();
    const activeConnector = connectorRef.current;
    const connectorState = activeConnector.createState?.();
    let errorToThrow: unknown;
    let streamPromise: Promise<void> | null = null;

    const deliverConnectorResult = (out: ConnectorResult | null | undefined) => {
      if (!out) return false;

      const chunk = out.text || '';
      if (chunk) delayedChunks.handleChunk(chunk);

      const reasoning = out.reasoning || '';
      if (reasoning) delayedChunks.handleReasoning(reasoning);

      const toolDeltas = out.toolDeltas?.length ? out.toolDeltas : out.toolDelta ? [out.toolDelta] : [];
      for (const toolDelta of toolDeltas) delayedChunks.handleToolDelta(accumulateToolDelta(toolDelta));

      const connectorError = connectorErrorFromResult(out);
      if (connectorError) throw connectorError;
      return Boolean(out.done);
    };

    try {
      const res = await transportRef.current(text, history, signal);
      if (!res.ok) throw await createHttpResponseError(res);
      if (!res.body) throw new ChorusStreamError(`Response body was missing for HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);

      streamPromise = readSSEStream(res, (payload) => {
        const done = deliverConnectorResult(activeConnector.extract(payload, connectorState));
        if (done) return false;
      }, readerController.signal);
      await Promise.race([streamPromise, delayedChunks.callbackErrorPromise]);
      await streamPromise;

      deliverConnectorResult(activeConnector.flush?.(connectorState));
      await delayedChunks.flushBeforeDone();
      try {
        cb.onDone?.(res);
      } catch (callbackError) {
        // Completion observers run after the stream has succeeded. Preserve the
        // historical contract that their failures reject send(), but do not route
        // them through onError because there is no underlying stream error.
        errorToThrow = callbackError;
      }
    } catch (e: unknown) {
      readerController.abort();
      if (streamPromise) await streamPromise.catch(() => undefined);
      const caughtError = delayedChunks.getCallbackError() ?? e;
      delayedChunks.cancel();
      if (!isAbortError(caughtError)) {
        const error = toError(caughtError);
        try {
          cb.onError?.(error);
        } catch (callbackError) {
          safeOnObserverError('onError', callbackError);
        }
        errorToThrow = error;
      }
    } finally {
      if (forwardAbort) signal.removeEventListener('abort', forwardAbort);
      isSendingRef.current = false;
      setSending(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }

    if (errorToThrow !== undefined) throw errorToThrow;
  }, [transportRef, connectorRef]);

  const abort = React.useCallback(() => { controllerRef.current?.abort(); }, []);
  return { send, abort, sending };
}
