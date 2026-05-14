# hooks guide

## `useChorusStream`

Core streaming hook for the simple `transport` path.

- Accepts a `Transport` and optional connector (`auto`, `openai`, `anthropic`, `gemini`, or custom `Connector`).
- Manages the send lifecycle: sets `sending`, creates/stores an `AbortController`, streams SSE events, and finalizes or reports errors.
- Uses `isSendingRef` as a guard so overlapping sends are ignored.
- Supports `minDelayMs` in callbacks by buffering the first streamed text/reasoning/tool events until the first-token delay elapses.
- Emits connector `reasoning` and accumulated `toolDelta` events through optional callbacks; `<Chorus>` turns those into `Message.reasoning` and `role: 'tool'` messages.
- `readSSEStream` handles line-by-line SSE parsing across chunk boundaries.

## `useChorusPersistence`

Loads and saves message arrays through a `StorageAdapter`.

- Defaults to `window.localStorage` when available.
- Supports sync adapters (`localStorage`, `sessionStorage`) during initial state setup.
- Supports async adapters (for example IndexedDB wrappers) via effect-based loading and promise-aware saving.
- Returns `{ value, onChange }` so callers can spread persistence into `<Chorus>`.

## `useLatestRef`

Small helper that stores the latest callback/value in a ref after each render. It is used by stable callbacks and async closures in `useChorusStream`, `useChorusMessages`, and `useRAFQueue` so they can read current props/state without changing callback identity.

## Closure pattern

Prefer `useLatestRef` for captured callbacks or values that must stay fresh inside stable callbacks/async work. Use manual refs for mutable lifecycle state or imperative handles (`isSendingRef`, `controllerRef`, scroll refs) rather than stale-closure avoidance.
