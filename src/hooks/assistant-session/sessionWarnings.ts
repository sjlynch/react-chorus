import React from 'react';
import { isChorusDevMode } from '../../utils/devMode';

const MISSING_RESPONSE_HANDLER_WARNING = '[Chorus] `send` was called but neither `transport` nor `onSend` was provided. Pass one of these props to produce an assistant response.';
const EMPTY_ON_SEND_WARNING = '[Chorus] `onSend` resolved without appending assistant chunks or returning a message; no `onFinish`/`onAbort` observer fires for this turn. Call `helpers.finalizeAssistant()` or return a `Message` from `onSend`.';
const TRANSPORT_ON_SEND_WARNING = '[Chorus] Both `transport` and `onSend` props were provided. `transport` takes precedence and `onSend` will be ignored. Remove one of the two props to silence this warning.';

function warnOnce(ref: React.MutableRefObject<boolean>, message: string): void {
  if (!isChorusDevMode() || ref.current) return;
  ref.current = true;
  console.warn(message);
}

export interface SessionWarnings {
  warnMissingResponseHandler: () => void;
  warnEmptyOnSend: () => void;
  warnTransportOnSend: () => void;
}

export function useSessionWarnings(): SessionWarnings {
  const warnedMissingHandlerRef = React.useRef(false);
  const warnedEmptyOnSendRef = React.useRef(false);
  const warnedTransportOnSendRef = React.useRef(false);

  const warnMissingResponseHandler = React.useCallback(() => {
    warnOnce(warnedMissingHandlerRef, MISSING_RESPONSE_HANDLER_WARNING);
  }, []);

  const warnEmptyOnSend = React.useCallback(() => {
    warnOnce(warnedEmptyOnSendRef, EMPTY_ON_SEND_WARNING);
  }, []);

  const warnTransportOnSend = React.useCallback(() => {
    warnOnce(warnedTransportOnSendRef, TRANSPORT_ON_SEND_WARNING);
  }, []);

  return {
    warnMissingResponseHandler,
    warnEmptyOnSend,
    warnTransportOnSend,
  };
}
