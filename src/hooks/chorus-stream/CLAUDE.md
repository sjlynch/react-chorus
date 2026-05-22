# chorus-stream internals

Focused helpers for `useChorusStream.ts`, which remains the public facade and re-exports `SendCallbacks`, `StreamOptions`, `Transport`, `readSSEStream`, and `ChorusStreamError`.

- `types.ts` — public stream callback/options/transport types re-exported by the facade.
- `session.ts` — per-send AbortController/session wiring, forward-abort listener cleanup, and ref teardown.
- `namedSSEEvents.ts` — named SSE `event:` handling before connector extraction (`error` frames become `ChorusStreamError`, heartbeat/ping are ignored).
- `connectorDelivery.ts` — connector result delivery to delayed text/reasoning/source/tool callbacks, warning and metadata routing, and connector error promotion.
- `sendLifecycle.ts` — transport/HTTP validation, SSE reader pump, connector `flush()`, onDone success path, and error teardown/onError routing.
- `observer.ts` — shared dev warning for observer callbacks that throw while a stream error is already being handled.
