# streaming guide

Transports are async functions used by the simple `transport` send path. They accept the current user text, message history, and abort signal, then return a `Response` whose body is a `ReadableStream` in SSE format.

## Transport type

```ts
(text: string, history: Message<TMeta>[], signal: AbortSignal) => Promise<Response>
```

The type is exported from `src/hooks/useChorusStream.ts` and re-exported from `Chorus.tsx`.

## Streaming pipeline modules

- `readSSEStream.ts` exposes the stream-independent `createSSEParser` state machine for line splitting, one-leading-BOM handling, `data:`/`event:` fields, comments/keepalives, EOF flush, and named-event dispatch. `readSSEStream` is the `Response`/`ReadableStream` adapter plus abort handling and the end-of-stream "no Server-Sent Events" guard; `text/event-stream` bodies with any SSE-shaped line (`data:` / `event:` / `:` comment) remain valid, so keepalive/event-only streams resolve cleanly.
- `delayedStreamEvents.ts` buffers first text/reasoning/tool events for `minDelayMs`; internals are split into release scheduling, delayed event queue, abort cancellation, and callback delivery/error propagation helpers while preserving callback-error semantics.
- `errors.ts` defines `ChorusStreamError`, HTTP error-body snippet/timeout handling, and connector `errorPayload` preservation.
- `toolDeltaAccumulator.ts` merges streamed tool-call deltas before callbacks see them.
## Fetch SSE transport

`createFetchSSETransport(url, init?)` wraps an HTTP URL:

- POSTs to `url` with JSON by default: `{ prompt: text, history }`.
- Supports `formatBody(text, history)` for provider/backend-specific request bodies.
- Normalizes custom headers with the Headers API.
- Adds `Content-Type: application/json` only for the default JSON body unless the caller already supplied Content-Type; custom `formatBody` serializers must set their own JSON headers and FormData/Blob/URLSearchParams are not forced to JSON.
- Returns the `fetch()` `Response` directly; the server must stream SSE `data:` events.

## WebSocket transport

`createWebSocketTransport.ts` is the public facade. Internals are split under `streaming/websocket/`:

- `shared.ts` — SSE event encoding, message decoding, abort/close helpers, safe socket close.
- `managedResponseStream.ts` — response-body stream wrapper and cleanup/error handling.
- `transient.ts` — one-socket-per-send lifecycle.
- `persistent.ts` — reusable socket/open-waiter lifecycle and `transport.close()`.

Both transports produce SSE-formatted output so `readSSEStream` and connector parsing work unchanged.
