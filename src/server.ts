/**
 * `react-chorus/server` — server-safe SSE framing helpers for proxy routes
 * (Next.js App Router, Express, etc.) that stream provider chunks into a
 * Chorus `<connector>` on the client.
 *
 * These helpers have zero React/UI dependencies and can be imported from any
 * Node or Web Streams runtime. They handle the wire-format details that every
 * production proxy needs to get right:
 *
 *   - the canonical SSE response headers (incl. `no-transform` so reverse
 *     proxies don't buffer chunks),
 *   - per-event `data: <payload>\n\n` framing,
 *   - multi-line string payloads split per the SSE spec (one `data:` line per
 *     line of the value, with CRLF/CR normalized to LF),
 *   - the `[DONE]` sentinel that Chorus connectors look for, and
 *   - the in-band `{ error: string }` envelope that surfaces upstream failures
 *     through `onError` / `errorMessage`.
 */

/**
 * Canonical SSE response headers for a Chorus proxy route.
 *
 * `no-transform` and `X-Accel-Buffering: no` are the two settings that most
 * commonly need to be set explicitly — without them, intermediaries (CDN
 * compression, nginx) can buffer or rewrite the stream so the client never
 * sees chunks arrive incrementally.
 */
export const sseHeaders = Object.freeze({
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
}) as Readonly<Record<string, string>>;

const textEncoder = new TextEncoder();

function buildDataLines(text: string): string {
  // Per the SSE spec, the value of a `data:` field that contains newlines is
  // serialized as multiple `data:` lines (one per line of the value). CRLF
  // and bare CR are normalized to LF first so the framing is unambiguous.
  const normalized = text.replace(/\r\n|\r/g, '\n');
  const lines = normalized.split('\n');
  return lines.map(line => `data: ${line}`).join('\n') + '\n\n';
}

/**
 * Format one SSE event from any JSON-serializable payload.
 *
 * Strings are written verbatim (after newline normalization), so the `[DONE]`
 * sentinel and other string markers pass through without quoting. Everything
 * else is `JSON.stringify`ed so connector parsers can `JSON.parse(data)` it.
 *
 * Throws a `TypeError` if the payload cannot be serialized — `undefined`,
 * functions, and symbols all cause `JSON.stringify` to return `undefined`,
 * which would otherwise blow up `buildDataLines` with a confusing
 * `Cannot read properties of undefined (reading 'replace')`. BigInt and
 * circular payloads continue to surface their native `JSON.stringify` errors
 * unchanged.
 */
export function formatSSEEvent(payload: unknown): string {
  if (typeof payload === 'string') return buildDataLines(payload);
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) {
    throw new TypeError('formatSSEEvent payload must be a string or JSON-serializable value');
  }
  return buildDataLines(serialized);
}

/** UTF-8 bytes of `formatSSEEvent(payload)` — for `ReadableStream` / Edge runtimes. */
export function encodeSSEEvent(payload: unknown): Uint8Array {
  return textEncoder.encode(formatSSEEvent(payload));
}

/**
 * Format the Chorus done sentinel (defaults to `[DONE]`, matching the OpenAI
 * Chat Completions wire format that every Chorus connector recognises).
 */
export function formatSSEDone(token: string = '[DONE]'): string {
  return formatSSEEvent(token);
}

/** UTF-8 bytes of `formatSSEDone(token)`. */
export function encodeSSEDone(token?: string): Uint8Array {
  return textEncoder.encode(formatSSEDone(token));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

/**
 * Format an in-band error envelope `{ error: <message> }`. Chorus connectors
 * read this and surface it through `onError` / `errorMessage` so failures
 * during streaming look the same as upstream provider errors.
 */
export function formatSSEError(error: unknown): string {
  return formatSSEEvent({ error: toErrorMessage(error) });
}

/** UTF-8 bytes of `formatSSEError(error)`. */
export function encodeSSEError(error: unknown): Uint8Array {
  return textEncoder.encode(formatSSEError(error));
}
