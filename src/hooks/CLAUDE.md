# hooks guide

## `useChorusStream`

Core streaming hook for the simple `transport` path.

- Accepts a `Transport` and optional connector (`auto`, `openai`, `anthropic`, `gemini`, or custom `Connector`).
- Manages the send lifecycle: sets `sending`, creates/stores an `AbortController`, streams SSE events, and finalizes or reports errors.
- Uses `isSendingRef` as a guard so overlapping sends are ignored.
- Supports `minDelayMs` in callbacks to keep typing UI visible for a minimum duration.
- `readSSEStream` handles line-by-line SSE parsing across chunk boundaries.

## `useChorusPersistence`

Loads and saves message arrays through a `StorageAdapter`.

- Defaults to `window.localStorage` when available.
- Supports sync adapters (`localStorage`, `sessionStorage`) during initial state setup.
- Supports async adapters (for example IndexedDB wrappers) via effect-based loading and promise-aware saving.
- Returns `{ value, onChange }` so callers can spread persistence into `<Chorus>`.

## Closure pattern

Callbacks or values used inside stable callbacks/async closures should be read from refs to avoid stale closure bugs. This codebase currently uses manual `ref` + assignment/effect patterns rather than a shared `useLatestRef` helper.
