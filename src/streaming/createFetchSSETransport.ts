import type { Message } from '../types';
import type { Transport } from '../hooks/useChorusStream';

export interface FetchSSETransportOptions<TMeta = Record<string, unknown>> extends Omit<RequestInit, 'body' | 'method' | 'signal'> {
  /**
   * Serialize the outgoing request body.
   * Defaults to `JSON.stringify({ prompt, history })` for backwards compatibility.
   *
   * IMPORTANT: `history` already contains the latest user turn — `prompt` is a
   * convenience copy of `history[history.length - 1].text`, not the next message
   * to append. Server handlers should map `history` directly (e.g. via
   * `toOpenAIChatCompletionsBody`) and ignore `prompt`; appending `prompt` to
   * `history` server-side will send the latest user turn to the model twice.
   * The duplicated field is kept for backwards compatibility and may be removed
   * in a future major; new backends should rely on `history` only.
   *
   * When omitted, the transport adds `Content-Type: application/json` unless the
   * caller supplied an explicit Content-Type header. When provided, set headers
   * yourself for JSON bodies; FormData/Blob/URLSearchParams are not forced to JSON.
   *
   * @example OpenAI-compatible backend
   * ```ts
   * import { formatOpenAIChatCompletionsBody } from 'react-chorus/provider-requests';
   *
   * formatBody: formatOpenAIChatCompletionsBody({ model: 'gpt-4o-mini' })
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
