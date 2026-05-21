# websocket transport guide

Internals behind `createWebSocketTransport` (see `../createWebSocketTransport.ts`). The factory picks `persistent.ts` when `opts.persistent === true`, otherwise `transient.ts`. Both produce SSE-formatted response bodies so `readSSEStream` and connectors work unchanged — see `../CLAUDE.md` for the surrounding pipeline.

## Files

- `transient.ts` — one WebSocket per send. Opens on call, sends the formatted payload on `onopen`, streams inbound frames into the response body, closes on done/abort.
- `persistent.ts` — one shared socket across sends. Coordinates socket lifecycle, exposes `transport.close()`, and registers a `FinalizationRegistry` finalizer to close the socket if the transport is GC'd.
- `openWaiters.ts` — waiter pool used by persistent mode so concurrent sends share a single connect and abort-before-open listeners are cleaned up consistently.
- `persistentStreamRouter.ts` — persistent-mode active response stream registry, correlation-id router, close/error fan-out, and the one-time overlap dev warning.
- `managedResponseStream.ts` — `ReadableStream` wrapper used by both modes. Idempotent `close`/`error`, swallows post-close enqueue, runs caller-supplied cleanup on cancel.
- `shared.ts` — SSE event encoding, message decoding (string/Blob/ArrayBuffer/typed array), abort/close-code helpers, `safeCloseSocket`, `normalizeFormatMessageResult`.

## Correlation contract (persistent mode only)

`formatMessage` may return either a `string` payload or `{ payload, correlationId }`. When it returns an id and `opts.correlate(frame)` is supplied, inbound frames are routed only to the stream registered under the matching id; frames whose `correlate` returns `null`/`undefined` fall through to broadcast (server-pushed messages).

Without `correlate`, every inbound frame is broadcast to every active stream — fine for serial sends, but overlapping sends will see each other's payloads duplicated into their assistant messages. `persistent.ts` emits a one-time `console.warn` (dev mode only) the first time a second send starts while another is still streaming on a transport that has no `correlate`. Transient mode has no correlation concept: each send owns its own socket.

## Close-code semantics

`isNormalCloseCode` treats only `1000` as a clean end-of-stream. On a *server*-initiated `ws.onclose`:

- Normal code → call `stream.close()` on active streams (clean EOF).
- Abnormal code (1001/1006/1011/etc.) → call `stream.error(createAbnormalCloseError(event))` so callers/telemetry can distinguish truncation from completion.

A close that fires while the socket is still `connecting` rejects pending `openWaiters` with `createClosedBeforeOpenError` instead.

### Client `transport.close()` vs server close

A *client*-initiated `transport.close()` is **not** a clean end-of-stream — the response was still streaming when the caller tore the socket down. It closes the socket with code 1000 by default, so the `ws.onclose` handler alone cannot tell it apart from a real server EOF. Both modes therefore settle in-flight sends explicitly when `transport.close()` is called, rather than relying on `onclose`:

- `transient.ts` keeps a `WebSocket → fail` map (`activeSends`) and calls each `fail` with `createTransportClosedError`. `fail` errors the response stream if the send already resolved, otherwise rejects its outer promise.
- `persistent.ts` calls `errorActiveStreams(createTransportClosedError(...))` from `closePersistentSocket` instead of `closeActiveStreams()`.

Net contract: **server closed normally → reader sees `done`; client called `close()` → reader rejects** with a transport-closed error. The `code`/`reason` passed to `transport.close()` are still forwarded to the socket close frame.

## Dev-mode duplication (do not "fix")

`persistent.ts` defines a local `isPersistentWebSocketDevMode()` and intentionally does **not** import `isChorusDevMode` from `src/utils/devMode.ts`. Importing the shared helper pulls the utils chunk into the transport-only subpath and blows its bundle-size budget tracked in the root README. See `../CLAUDE.md` and the inline comment in `persistent.ts` before changing this.
