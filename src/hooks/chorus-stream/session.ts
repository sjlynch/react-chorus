import type { MutableRefObject } from 'react';

/**
 * Abort-signal/controller wiring for one send. With an externalSignal the
 * caller owns cancellation and `controller` is null; otherwise the hook owns
 * an AbortController that abort()/unmount can cancel. `readerController` is
 * always hook-owned and bounds the SSE reader; `forwardAbort` is the
 * pre-installed listener that propagates the outer signal into the reader.
 */
export type StreamSession = {
  signal: AbortSignal;
  controller: AbortController | null;
  readerController: AbortController;
  forwardAbort: (() => void) | null;
};

export function startStreamSession(
  externalSignal: AbortSignal | undefined,
  controllerRef: MutableRefObject<AbortController | null>,
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

/**
 * Detach the `forwardAbort` listener from the (possibly caller-owned) outer
 * signal and forget it so the registration is dropped exactly once. Safe to
 * call repeatedly: both the per-send teardown and the unmount cleanup invoke
 * it, and the second call is a no-op.
 */
export function removeForwardAbort(session: StreamSession) {
  if (session.forwardAbort) {
    session.signal.removeEventListener('abort', session.forwardAbort);
    session.forwardAbort = null;
  }
}

export function endStreamSession(
  session: StreamSession,
  controllerRef: MutableRefObject<AbortController | null>,
  sessionRef: MutableRefObject<StreamSession | null>,
) {
  removeForwardAbort(session);
  if (controllerRef.current === session.controller) controllerRef.current = null;
  if (sessionRef.current === session) sessionRef.current = null;
}
