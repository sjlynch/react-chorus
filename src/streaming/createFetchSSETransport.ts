import type { Message } from '../types';
import type { Transport } from '../hooks/useChorusStream';

export interface FetchSSETransportOptions extends Omit<RequestInit, 'body' | 'method' | 'signal'> {
  /**
   * Serialize the outgoing request body.
   * Defaults to `JSON.stringify({ prompt, history })` for backwards compatibility.
   *
   * @example OpenAI-compatible backend
   * ```ts
   * formatBody: (text, history) => JSON.stringify({ model: 'gpt-4o', messages: history, stream: true })
   * ```
   */
  formatBody?: (text: string, history: Message[]) => BodyInit;
}

export function createFetchSSETransport(url: string, init?: FetchSSETransportOptions): Transport {
  const formatBody =
    init?.formatBody ??
    ((text, history) => JSON.stringify({ prompt: text, history }));

  const { formatBody: _removed, ...rest } = init ?? {};
  const headers = { 'Content-Type': 'application/json', ...(rest?.headers ?? {}) };

  return async (text: string, history: Message[], signal: AbortSignal) => {
    const body = formatBody(text, history);
    return fetch(url, { method: 'POST', headers, body, signal, ...rest });
  };
}
