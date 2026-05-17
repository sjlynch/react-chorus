# assistant-session internals

- Keep public types and `useAssistantSession` exported from `../useAssistantSession.ts`.
- `messageUtils.ts` holds pure message/id/normalization helpers only.
- `transport.ts` is the string-URL / `FetchTransportInit` object shortcut for the `<Chorus transport=...>` prop. It deliberately duplicates the tiny default fetch request shape instead of importing the public transport chunk, preserving the transport subpath budget; keep it aligned with `createFetchSSETransport` when the default body or option surface changes.
- `toolLoop.ts` owns the automatic tool-loop cap rules; `Infinity` means unlimited and invalid values warn once in dev.
- `observer.ts` contains guarded callback warning helpers; observer failures must not interrupt rendering.
