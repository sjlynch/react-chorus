# streaming guide

Transports are async functions used by the simple `transport` send path. They accept the current user text, message history, and abort signal, then return a `Response` whose body is a `ReadableStream` in SSE format.

## Transport type

```ts
(text: string, history: Message[], signal: AbortSignal) => Promise<Response>
```

The type is exported from `src/hooks/useChorusStream.ts` and re-exported from `Chorus.tsx`.

## Fetch SSE transport

`createFetchSSETransport(url, init?)` wraps an HTTP URL:

- POSTs to `url` with JSON by default: `{ prompt: text, history }`.
- Supports `formatBody(text, history)` for provider/backend-specific request bodies.
- Merges custom headers with `Content-Type: application/json`.
- Returns the `fetch()` `Response` directly; the server must stream SSE `data:` events.

## WebSocket transport

`createWebSocketTransport(url, opts?)` wraps a WebSocket URL:

- Opens a fresh socket per send and sends `formatMessage(text, history)`.
- Wraps each incoming WS message as `data: <message>\n\n` in a `ReadableStream`.
- Resolves a `Response` once the socket opens and closes/errors/aborts with the stream.

Both transports produce SSE-formatted output so `readSSEStream` and connector parsing work unchanged.
