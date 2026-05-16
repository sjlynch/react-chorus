# hooks guide

## `useAssistantSession`

`useAssistantSession.ts` remains the public facade for the built-in Chorus send lifecycle. Internal helpers live in `hooks/assistant-session/`:

- `messageUtils.ts` — message IDs, retry cloning, returned-message normalization, tool metadata helpers.
- `observer.ts` — guarded observer warning helpers.
- `toolLoop.ts` — `maxToolIterations` normalization (`Infinity` is the explicit unlimited sentinel) and defaults.
- `transport.ts` — string-URL transport shortcut. It intentionally mirrors the default fetch SSE request locally to keep transport-only bundles isolated.

The facade owns React lifecycle wiring: send/retry/stop/clear/edit/regenerate/delete, assistant buffering, transport/onSend orchestration, abort callbacks, and tool execution.

## `useChorusStream`

Core streaming hook for the simple `transport` path. The facade is `useChorusStream.ts`; focused internals are in `src/streaming/`:

- `readSSEStream.ts` — line-by-line SSE parser (BOM, colonless fields, CR/LF, chunk boundaries).
- `delayedStreamEvents.ts` — `minDelayMs` buffering and callback-error propagation.
- `errors.ts` — `ChorusStreamError`, HTTP error-body snippets/timeouts, connector `errorPayload` preservation.
- `toolDeltaAccumulator.ts` — merges streamed tool-call argument/output deltas.

The hook creates connector state once per send, feeds SSE payloads through `extract()`, calls connector `flush()` at EOF, delivers text/reasoning/tool events, and finalizes or reports errors.

## `useChorusPersistence`

Loads and saves message arrays through a `StorageAdapter`. Internals mirror `useConversations`:

- `persistence/messageCodec.ts` — JSON defaults, parse/sanitize, raw-to-state conversion.
- `persistence/errors.ts` — `ChorusPersistenceError` normalization and dev warnings using shared error helpers.
- `persistence/writeQueue.ts` — debounced/serialized writes plus page-lifecycle flush support.

The facade keeps storage resolution, initial sync/async read coordination, pre-load `onChange` deferral, and the public result shape.

## `useConversations`

Conversation index persistence is split into:

- `conversations/indexCodec.ts` — index parsing/migration, title derivation, active-id selection.
- `conversations/storageErrors.ts` — storage error normalization.
- `conversations/indexWriteQueue.ts` — debounced/serialized index writes.
- `conversations/storageAdapter.ts` — transcript storage wrapper that touches conversation timestamps.

## `useLatestRef`

Small helper that stores the latest callback/value in a ref after each render. It is used by stable callbacks and async closures so they can read current props/state without changing callback identity.

## Closure pattern

Prefer `useLatestRef` for captured callbacks or values that must stay fresh inside stable callbacks/async work. Use manual refs for mutable lifecycle state or imperative handles (`isSendingRef`, `controllerRef`, scroll refs) rather than stale-closure avoidance.
