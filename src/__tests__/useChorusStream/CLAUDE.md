# useChorusStream tests

Behavior-focused suites for the streaming hook:

- `callbacks.test.ts` — basic sending state, text/reasoning/tool callback ordering, and onDone observer behavior.
- `connector-delivery.test.ts` — connector options, warnings, tool deltas, per-stream connector state isolation, and connector flush behavior.
- `transport-completion.test.ts` — fetch/WebSocket transports that complete when connectors emit done sentinels.
- `errors.test.ts` — in-band connector errors, HTTP/malformed response errors, transport failures, and onError teardown.
- `lifecycle.test.tsx` — concurrent sends, stable callback identity, abort/unmount semantics, and external AbortSignal listener cleanup.
- `min-delay-and-sse-events.test.tsx` — `minDelayMs` behavior, delayed callback failures, and named SSE `event:` handling.
- `fixtures.ts` — shared Response/SSE/WebSocket fixtures plus test-environment reset helper.
