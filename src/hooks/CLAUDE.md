# hooks guide

## `useAssistantSession`

`useAssistantSession.ts` remains the public facade for the built-in Chorus send lifecycle. Internal helpers live in `hooks/assistant-session/`:

- `types.ts` — public context/handler types and internal `UpdateMessagesOptions` / `UpdateSessionMessages` / `SubmittedUserTurn` aliases. The facade re-exports the public names so consumers continue importing from `useAssistantSession`.
- `messageUtils.ts` — message IDs, retry cloning, returned-message normalization, tool metadata helpers.
- `observer.ts` — guarded observer warning helper (`warnObserverError`).
- `observerCallbacks.ts` — `createObserverCallbacks` factory for the `safeOn*` try/catch wrappers around host observers.
- `assistantBuffer.ts` — `useAssistantBuffer` owns the RAF-buffered text/reasoning queues, pending-assistant/tool refs, and `startAssistant` / `append*Now` / `finalizeAssistantNow` / `resetStreamState` / `resetPendingAssistantState` mutators.
- `toolExecution.ts` — `useToolExecution` builds the tool message mutators (`appendToolDeltaNow`, `setToolOutput`, `setToolErrorOutput`), `createToolCallContext`, and the `runCompletedToolCalls` loop. The chunk-isolated `resolveToolHandlerLocal` helper lives here too — see the comment on the function.
- `sessionHelpers.ts` — `createSessionHelpers` plain factory that returns the `ChorusSendHelpers` exposed to `onSend`, including `minAssistantDelayMs` buffering and auto-finalize logic.
- `onSendLifecycle.ts` — `startOnSendLifecycle` owns the custom `onSend` branch once the facade selects it: abort-controller setup, `createSessionHelpers`, returned-message normalization, auto-finalize warnings, non-abort error handling, and cleanup.
- `transportLifecycle.ts` — `useTransportLifecycle` owns `historyForTransport`, `startTransportStream`, `decideToolLoopContinuation`, and the internal `finishTransportStream` that runs queued tool calls and continues or releases the loop.
- `sessionCommands.ts` — `useSessionCommands` builds the user-facing `send` / `retry` / `stop` / `clear` / `handleEdit` / `handleRegenerate` / `handleDelete` callbacks from refs and lifecycle callbacks supplied by the facade.
- `sessionOrchestrator.ts` — `useSessionOrchestrator` owns the active session/path/controller bookkeeping and exposes `beginAssistantSession` / `isAssistantSessionActive` / `invalidateAssistantSession` / `completeActiveSession` / `removePendingAssistant` / `abortActiveAssistant` / `triggerAssistant` / `warnMissingResponseHandler` so the facade composes refs + buffer + orchestrator + toolExec + transportLifecycle + sessionCommands instead of inlining the lifecycle glue.
- `toolLoop.ts` — `maxToolIterations` normalization (`Infinity` is the explicit unlimited sentinel) and defaults.
- `transport.ts` — string-URL transport shortcut. It intentionally mirrors the default fetch SSE request locally to keep transport-only bundles isolated.

The facade owns React lifecycle wiring (state setters, refs, `useChorusStream` integration) and delegates provider-specific lifecycles plus user-facing command handlers to the submodules above.

## `useChorusStream`

Core streaming hook for the simple `transport` path. The facade is `useChorusStream.ts`; focused hook internals live in `hooks/chorus-stream/` (see its CLAUDE.md):

- `types.ts` — public `SendCallbacks`, `StreamOptions`, and `Transport` types re-exported by the facade.
- `session.ts` — abort-controller/session wiring and forward-abort listener teardown.
- `namedSSEEvents.ts` — named SSE `event:` handling before connector extraction.
- `connectorDelivery.ts` — connector-result delivery, warning routing, and connector error promotion.
- `sendLifecycle.ts` — transport/HTTP validation, SSE pumping, connector `flush()`, onDone success path, and error teardown.

Shared streaming primitives stay in `src/streaming/`: `readSSEStream.ts` parses SSE frames, `delayedStreamEvents.ts` owns `minDelayMs` buffering and callback-error propagation, `errors.ts` defines `ChorusStreamError`/HTTP snippets, and `toolDeltaAccumulator.ts` merges streamed tool-call deltas. The hook creates connector state once per send, feeds SSE payloads through `extract()`, calls connector `flush()` at EOF, delivers text/reasoning/tool events, and finalizes or reports errors. Named SSE `event:` frames are routed before `extract()`: `event: error` is surfaced as a `ChorusStreamError` (even for a bare-string payload), `event: heartbeat`/`event: ping` keepalives are dropped, and unnamed/`event: message` frames go to the connector unchanged.

## `useChorusPersistence`

Loads and saves message arrays through a `StorageAdapter`. Internals mirror `useConversations`:

- `persistence/messageCodec.ts` — JSON defaults, parse/sanitize, raw-to-state conversion.
- `persistence/errors.ts` — `ChorusPersistenceError` normalization and dev warnings using shared error helpers.
- `persistence/writeQueue.ts` — debounced/serialized writes plus page-lifecycle flush support.

The facade keeps storage resolution, initial sync/async read coordination, pre-load `onChange` deferral, and the public result shape.

## `useConversations`

Conversation index persistence is split into focused helpers (see `conversations/CLAUDE.md` for invariants):

- `conversations/types.ts` — public conversation/result/options/storage error types re-exported by the facade.
- `conversations/storageSource.ts` and `conversations/indexReadLifecycle.ts` — default storage/key setup and sync/async index read orchestration.
- `conversations/lifecycle.ts` and `conversations/crossTabSync.ts` — page/unmount flushes and localStorage cross-tab sync.
- `conversations/actions.ts` — create/select/rename/delete/pin callbacks plus transcript deletion.
- `conversations/indexCodec.ts` plus `parse.ts`/`sanitize.ts`/`activeId.ts`/`timestamp.ts`/`pendingCreates.ts`/`title.ts` — conversation index parsing/migration/serialization, default title derivation, and active-id/timestamp/pending-create helpers.
- `conversations/storageErrors.ts` — storage error normalization.
- `conversations/indexWriteQueue.ts` — debounced/serialized index writes.
- `conversations/storageAdapter.ts` — transcript storage wrapper that touches conversation timestamps.

## `useLatestRef`

Small helper that stores the latest callback/value in a ref. The ref is assigned during render (in the hook body), so synchronous reads in the same commit — including layout effects and callbacks fired before passive effects flush — see the latest value rather than lagging one render behind. It is used by stable callbacks and async closures so they can read current props/state without changing callback identity.

## `useMirroredState`

Small helper that returns `[value, setMirrored, ref]` — a `useState` whose ref is kept in sync synchronously inside the setter so synchronous reads from event handlers and async closures see the latest value without waiting for the next render. The setter identity is stable for `useCallback` deps.

## Closure pattern

Prefer `useLatestRef` for captured callbacks or values that must stay fresh inside stable callbacks/async work. Use manual refs for mutable lifecycle state or imperative handles (`isSendingRef`, `controllerRef`, scroll refs) rather than stale-closure avoidance.
