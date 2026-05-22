import type { Message } from '../types';
import type { Transport } from '../hooks/useChorusStream';

// Local duplicate of `isChorusDevMode` from `src/utils/devMode.ts`. Importing the
// shared helper (or `streaming/internal/devMode.ts`) would add a cross-chunk
// dependency to the transport-only subpath and risk its tight size budget — the
// same trade-off `websocket/persistent.ts` documents for this chunk.
function isFetchSSETransportDevMode(): boolean {
  try {
    return typeof process !== 'undefined' && typeof process.env !== 'undefined' && process.env.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

// Warn at most once per process when a `formatBody` serializer is paired with a
// body-less method, mirroring `warnIgnoredConnectorOptions` in
// `src/connectors/registry.ts`: both surface a silently-dropped option in dev.
let warnedFormatBodyIgnoredForBodylessMethod = false;

export interface FetchSSETransportOptions<TMeta = Record<string, unknown>> extends Omit<RequestInit, 'body' | 'method' | 'signal'> {
  /**
   * HTTP method for the outgoing request. Defaults to `'POST'`.
   *
   * When set to a body-less method (`'GET'` or `'HEAD'`), the transport skips
   * `formatBody` and the default `Content-Type: application/json` header — the
   * URL is expected to carry any state (typically as query parameters). This
   * enables GET-based SSE proxies and EventSource-style endpoints.
   */
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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
   * SYSTEM PROMPT: when the `<Chorus systemPrompt>` prop is set, `history`
   * already begins with a synthetic `{ role: 'system' }` message carrying that
   * prompt — its id is the public `RESERVED_SYSTEM_PROMPT_ID` constant
   * (`'chorus-system-prompt'`, exported from `react-chorus`,
   * `react-chorus/server`, and `react-chorus/provider-requests`). A `formatBody`
   * that ignores `system`-role messages silently drops `systemPrompt`; the
   * provider mappers (`formatOpenAIChatCompletionsBody`,
   * `formatAiSdkModelMessagesBody`, `formatAnthropicMessagesBody`,
   * `formatGeminiGenerateContentBody`) already
   * map it for you. Do NOT also pass a provider-level `system` /
   * `systemInstruction` option: that double-specifies the system prompt and
   * trips a one-time dev-mode precedence warning, with the history-derived text
   * dropped in favour of the option.
   *
   * When omitted, the transport adds `Content-Type: application/json` unless the
   * caller supplied an explicit Content-Type header. When provided, set headers
   * yourself for JSON bodies; FormData/Blob/URLSearchParams are not forced to JSON.
   *
   * Ignored — with a one-time dev-mode warning — when `method` is `'GET'` or
   * `'HEAD'`.
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
  const method = init?.method ?? 'POST';
  const bodyless = method === 'GET' || method === 'HEAD';
  const hasCustomFormatBody = typeof init?.formatBody === 'function';

  if (
    bodyless &&
    hasCustomFormatBody &&
    !warnedFormatBodyIgnoredForBodylessMethod &&
    isFetchSSETransportDevMode()
  ) {
    warnedFormatBodyIgnoredForBodylessMethod = true;
    console.warn(
      `[react-chorus] createFetchSSETransport: \`formatBody\` was provided together with `
        + `\`method: '${method}'\`, but ${method} requests are body-less — the \`formatBody\` `
        + `serializer is ignored and the request is sent with no body. Drop \`formatBody\` and `
        + `carry request state in the URL (typically as query parameters) for GET/HEAD requests, `
        + `or switch to a body-carrying method such as POST. This warning fires once.`,
    );
  }

  const formatBody =
    init?.formatBody ??
    ((text: string, history: Message<TMeta>[]) => JSON.stringify({ prompt: text, history }));

  const { formatBody: _removed, headers: initHeaders, method: _removedMethod, ...rest } = init ?? {};

  return async (text: string, history: Message<TMeta>[], signal: AbortSignal) => {
    const headers = new Headers(initHeaders);
    if (bodyless) {
      return fetch(url, { ...rest, method, headers, signal });
    }
    const body = formatBody(text, history);
    if (!hasCustomFormatBody && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(url, { ...rest, method, headers, body, signal });
  };
}
