import type { Message } from '../../types';
import type { Transport } from '../useChorusStream';

/**
 * Object form of the simple `transport` shorthand. Lets the URL string shorthand
 * grow auth headers, cookies, and other `fetch` options without dropping the
 * batteries-included streaming path.
 *
 * `body`, `method`, and `signal` are reserved by Chorus: the request is always
 * `POST` with the streaming `AbortSignal`, and the body is serialized by the
 * default `JSON.stringify({ prompt, history })` (or your `formatBody`).
 */
export interface FetchTransportInit<TMeta = Record<string, unknown>> extends Omit<RequestInit, 'body' | 'method' | 'signal'> {
  /** Endpoint Chorus POSTs to. */
  url: string;
  /**
   * Serialize the outgoing request body.
   * Defaults to `JSON.stringify({ prompt, history })`.
   *
   * When omitted, the transport adds `Content-Type: application/json` unless the
   * caller supplied an explicit Content-Type header. When provided, set headers
   * yourself for JSON bodies; FormData/Blob/URLSearchParams are not forced to JSON.
   */
  formatBody?: (text: string, history: Message<TMeta>[]) => BodyInit;
}

// Keep the built-in string transport local to the widget path so the public
// react-chorus/transport subpath can stay free of hook/session chunks. This
// intentionally mirrors createFetchSSETransport's default request shape; sharing
// the tiny builder creates a static chunk edge that breaks the transport budget.
//
// Body shape: `history` already includes the latest user turn (`text` is a
// duplicate convenience copy). Backends should map `history` only. The duplicated
// `prompt` field is retained for backwards compatibility and is a candidate for
// removal in a future major release — see the `formatBody` JSDoc on
// `FetchSSETransportOptions` for the migration guidance, and keep this default
// in lockstep with `createFetchSSETransport` if it changes.
export function createDefaultFetchSSETransport<TMeta = Record<string, unknown>>(
  config: string | FetchTransportInit<TMeta>,
): Transport<TMeta> {
  const init: FetchTransportInit<TMeta> = typeof config === 'string' ? { url: config } : config;
  const { url, formatBody, headers: initHeaders, ...rest } = init;
  const hasCustomFormatBody = typeof formatBody === 'function';
  const serializeBody = formatBody
    ?? ((text: string, history: Message<TMeta>[]) => JSON.stringify({ prompt: text, history }));

  return async (text: string, history: Message<TMeta>[], signal: AbortSignal) => {
    const body = serializeBody(text, history);
    const headers = new Headers(initHeaders);
    if (!hasCustomFormatBody && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(url, { ...rest, method: 'POST', headers, body, signal });
  };
}
