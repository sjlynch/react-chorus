# Chorus test suite map

Behavior-focused `<Chorus>` tests live in this folder:

- `transport-streaming.test.tsx` — basic transport streaming, connector options/warnings/metadata, timing, system prompts, and transport-vs-onSend precedence.
- `transport-tool-execution.test.tsx` / `transport-tool-auto-continue.test.tsx` — streamed tool rows, executable tool handlers, tool errors, and auto-continue loop limits/veto/abort behavior.
- `onSend-lifecycle.test.tsx`, `onSend-abort.test.tsx`, and `onSend-stop-guards.test.tsx` — custom `onSend` helper lifecycle, finish/abort semantics, and stale-helper protection.
- `message-actions.test.tsx` and `clear-delete-confirmations.test.tsx` — retry/stop/edit/regenerate/delete plus clear/delete confirmation flows.
- `imperative-ref.test.tsx`, `shell-rendering.test.tsx`, and `messages-change.test.tsx` — root chrome, disabled/read-only affordances, message observation, and `ChorusRef` contracts.
- `stream-bridge.test.tsx`, `error-bridging.test.tsx`, and `observer-errors.test.tsx` — documented `useChorusStream` bridge usage, UI/onError routing, and observer isolation.
- `persistence.test.tsx`, `abort-on-cleanup.test.tsx`, and `warnings.test.tsx` cover persistence, conversation-switch cleanup, and dev diagnostics.

Shared helper contract:

- Use `testUtils.tsx` for SSE response fixtures, deferred promises, sync storage, shared public types, and `sendMessage(user, text)` for the standard composer submit path.
- Keep helpers DOM-focused and provider-neutral; provider-specific chunk payloads should stay in the behavior test that exercises them.
