import { extractErrorMessage } from '../../connectors/error';
import { createConnectorStreamError } from '../../streaming/errors';

/**
 * Build a ChorusStreamError from the `data` payload of a named `event: error`
 * SSE frame. The payload may be JSON (`{ "error": ... }`, `{ "message": ... }`,
 * a bare JSON string) or non-JSON text; either way the frame is surfaced as an
 * error instead of being rendered as assistant text.
 */
export function errorFromEventErrorFrame(payload: string) {
  let parsed: unknown = payload;
  try { parsed = JSON.parse(payload); } catch { /* non-JSON payload: keep the raw text */ }
  const message = (typeof parsed === 'string' ? parsed : extractErrorMessage(parsed))
    || payload || 'SSE `event: error` frame';
  return createConnectorStreamError(message, parsed);
}

export function isIgnoredKeepaliveEvent(eventName: string | undefined): boolean {
  return eventName === 'heartbeat' || eventName === 'ping';
}
