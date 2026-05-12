import type { Message } from '../types';
import type { Transport } from '../hooks/useChorusStream';

export interface FetchSSETransportOptions<TMeta = Record<string, unknown>> extends Omit<RequestInit, 'body' | 'method' | 'signal'> {
  /**
   * Serialize the outgoing request body.
   * Defaults to `JSON.stringify({ prompt, history })` for backwards compatibility.
   * `history` includes the current user turn; `prompt` is a convenience copy.
   *
   * When omitted, the transport adds `Content-Type: application/json` unless the
   * caller supplied an explicit Content-Type header. When provided, set headers
   * yourself for JSON bodies; FormData/Blob/URLSearchParams are not forced to JSON.
   *
   * @example OpenAI-compatible backend
   * ```ts
   * formatBody: (text, history) => JSON.stringify({ model: 'gpt-4o', messages: history, stream: true })
   * ```
   */
  formatBody?: (text: string, history: Message<TMeta>[]) => BodyInit;
}

export function createFetchSSETransport<TMeta = Record<string, unknown>>(
  url: string,
  init?: FetchSSETransportOptions<TMeta>,
): Transport<TMeta> {
  const hasCustomFormatBody = typeof init?.formatBody === 'function';
  const formatBody =
    init?.formatBody ??
    ((text: string, history: Message<TMeta>[]) => JSON.stringify({ prompt: text, history }));

  const { formatBody: _removed, headers: initHeaders, ...rest } = init ?? {};

  return async (text: string, history: Message<TMeta>[], signal: AbortSignal) => {
    const body = formatBody(text, history);
    const headers = new Headers(initHeaders);
    if (!hasCustomFormatBody && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(url, { ...rest, method: 'POST', headers, body, signal });
  };
}
