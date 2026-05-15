# streaming guide

Transports are async functions used by the simple `transport` send path. They accept the current user text, message history, and abort signal, then return a `Response` whose body is a `ReadableStream` in SSE format.

## Transport type

```ts
(text: string, history: Message<TMeta>[], signal: AbortSignal) => Promise<Response>
```

The type is exported from `src/hooks/useChorusStream.ts` and re-exported from `Chorus.tsx`.

## Fetch SSE transport

`createFetchSSETransport(url, init?)` wraps an HTTP URL:

- POSTs to `url` with JSON by default: `{ prompt: text, history }`.
- Supports `formatBody(text, history)` for provider/backend-specific request bodies.
- Normalizes custom headers with the Headers API.
- Adds `Content-Type: application/json` only for the default JSON body unless the caller already supplied Content-Type; custom `formatBody` serializers must set their own JSON headers and FormData/Blob/URLSearchParams are not forced to JSON.
- Returns the `fetch()` `Response` directly; the server must stream SSE `data:` events.

## WebSocket transport

`createWebSocketTransport(url, opts?)` wraps a WebSocket URL:

- Opens a fresh socket per send by default and sends `formatMessage(text, history)`.
- With `{ persistent: true }`, opens one socket on first send, reuses it across sends, and exposes `transport.close(code?, reason?)` for explicit cleanup; runtimes with `FinalizationRegistry` also attempt cleanup when the transport is GC'd.
- Persistent mode keeps the socket open when an individual response stream ends, so application protocol code is responsible for reconnect/backoff, request/response correlation, and emitting done sentinels (or cancelling response bodies) to finish sends.
- Wraps each incoming WS message as `data: <message>\n\n` in a `ReadableStream`; `onMessage` can observe decoded pushed messages even when no send stream is active.
- Resolves a `Response` once the socket opens and the message sends, then closes/errors/aborts with the response stream.

Both transports produce SSE-formatted output so `readSSEStream` and connector parsing work unchanged.
