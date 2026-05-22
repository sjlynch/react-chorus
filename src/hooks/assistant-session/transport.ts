import type { Message } from '../../types';
import type { Transport } from '../useChorusStream';

/**
 * Object form of the simple `transport` shorthand. Lets the URL string shorthand
 * grow auth headers, cookies, an HTTP method, and other `fetch` options without
 * dropping the batteries-included streaming path.
 *
 * `body` and `signal` are reserved by Chorus: the request always carries the
 * streaming `AbortSignal`, and the body is serialized by the default
 * `JSON.stringify({ prompt, history })` (or your `formatBody`).
 */
export interface FetchTransportInit<TMeta = Record<string, unknown>> extends Omit<RequestInit, 'body' | 'method' | 'signal' | 'headers'> {
  /** Endpoint Chorus sends the request to. */
  url: string;
  /**
   * HTTP method for the outgoing request. Defaults to `'POST'`.
   *
   * When set to a body-less method (`'GET'` or `'HEAD'`), the transport skips
   * `formatBody` and the default `Content-Type: application/json` header — the
   * URL is expected to carry any state (typically as query parameters). This
   * enables GET-based SSE proxies and EventSource-style endpoints.
   *
   * Mirrors `createFetchSSETransport`'s `method` option so the object shorthand
   * and the standalone factory stay in lockstep.
   */
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /**
   * Extra request headers forwarded verbatim to `fetch`.
   *
   * If you set a `Content-Type` header, the transport will not override it —
   * caller headers always win. Because the default body is
   * `JSON.stringify({ prompt, history })`, overriding `Content-Type` without
   * also overriding `formatBody` will send JSON bytes under the wrong media
   * type and confuse the upstream backend. To use the default JSON body and a
   * custom `Content-Type`, override `formatBody` as well.
   */
  headers?: HeadersInit;
  /**
   * Serialize the outgoing request body.
   * Defaults to `JSON.stringify({ prompt, history })`.
   *
   * SYSTEM PROMPT: when the `<Chorus systemPrompt>` prop is set, `history`
   * already begins with a synthetic `{ role: 'system' }` message carrying that
   * prompt — its id is the public `RESERVED_SYSTEM_PROMPT_ID` constant
   * (`'chorus-system-prompt'`, exported from `react-chorus`,
   * `react-chorus/server`, and `react-chorus/provider-requests`). A `formatBody`
   * that ignores `system`-role messages silently drops `systemPrompt`; the
   * provider mappers (`formatOpenAIChatCompletionsBody`,
   * `formatAnthropicMessagesBody`, `formatGeminiGenerateContentBody`) already
   * map it for you. Do NOT also pass a provider-level `system` /
   * `systemInstruction` option: that double-specifies the system prompt and
   * trips a one-time dev-mode precedence warning, with the history-derived text
   * dropped in favour of the option.
   *
   * When omitted, the transport adds `Content-Type: application/json` unless the
   * caller supplied an explicit Content-Type header. When provided, set headers
   * yourself for JSON bodies; FormData/Blob/URLSearchParams are not forced to JSON.
   *
   * Ignored when `method` is `'GET'` or `'HEAD'`.
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
  const { url, formatBody, headers: initHeaders, method = 'POST', ...rest } = init;
  const bodyless = method === 'GET' || method === 'HEAD';
  const hasCustomFormatBody = typeof formatBody === 'function';
  const serializeBody = formatBody
    ?? ((text: string, history: Message<TMeta>[]) => JSON.stringify({ prompt: text, history }));

  return async (text: string, history: Message<TMeta>[], signal: AbortSignal) => {
    const headers = new Headers(initHeaders);
    if (bodyless) {
      return fetch(url, { ...rest, method, headers, signal });
    }
    const body = serializeBody(text, history);
    if (!hasCustomFormatBody && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(url, { ...rest, method, headers, body, signal });
  };
}
