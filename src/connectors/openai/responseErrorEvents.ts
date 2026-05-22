import { extractErrorMessage } from '../error';
import type { ConnectorResult } from '../types';
import { collectTextFragments, stringFromUnknown } from './shared';

/**
 * Failure / error events: `response.failed` and `response.error`.
 *
 * `response.failed` is the protocol's terminal failure; `response.error` is an
 * inline error event (non-terminal in the protocol, but terminal for our UI).
 * Both return `{ error, errorPayload }` so the original provider JSON reaches
 * `onError` / `streamRawError`.
 */
export function handleResponseErrorEvent(obj: Record<string, unknown>): ConnectorResult {
  if (obj.type === 'response.failed') {
    // The provider's real failure message lives at `response.error.message`;
    // `extractErrorMessage` only inspects a top-level `error` and
    // `collectTextFragments` digs for text/summary/content, so without this the
    // generic fallback always wins.
    const response = obj.response && typeof obj.response === 'object'
      ? obj.response as Record<string, unknown>
      : undefined;
    const responseError = response?.error && typeof response.error === 'object'
      ? response.error as Record<string, unknown>
      : undefined;
    const error = stringFromUnknown(responseError?.message)
      || extractErrorMessage(obj)
      || collectTextFragments(obj.response)
      || 'OpenAI response failed';
    return { error, errorPayload: obj };
  }

  // `response.error`
  const error = extractErrorMessage(obj) || stringFromUnknown(obj.message) || stringFromUnknown(obj.code) || 'OpenAI response error';
  return { error, errorPayload: obj };
}
