# react-chorus guide

react-chorus is a composable React chat UI library with batteries-included message rendering, input, streaming, persistence, and theming. It can be used as a full `<Chorus>` widget or by importing headless/component pieces for custom shells.

## Directory map

- `src/index.ts` — root public barrel; update it when the exported API surface changes.
- `src/types.ts` — core public types for messages, roles, attachments, tool calls, connectors, and storage adapters.
- `src/Chorus.tsx` — main public component and `ChorusProps`; coordinates state, streaming, persistence, errors, retry/stop/edit/regenerate.
- `src/headless.ts` / `src/ChorusHeadless.tsx` — `react-chorus/headless` entry and wrapper that default supported components to `headless: true`.
- `src/providerRequests.ts` — outbound request mappers and `formatXyzBody` helpers for OpenAI Chat/Responses, Anthropic Messages, and Gemini GenerateContent, exported via root and `react-chorus/provider-requests`.
- `src/transport.ts` — `react-chorus/transport` barrel for transport factories and the `Transport` type.
- `src/components/` — UI pieces (`ChatWindow`, `ChatInput`, `Markdown`, `ChorusTheme`, `ToolCallBlock`, `MessageBubble`).
- `src/hooks/` — reusable streaming and persistence hooks.
- `src/connectors/` — provider-specific SSE payload parsers.
- `src/streaming/` — transport factories that return SSE-shaped `Response` streams.
- `src/utils/` — shared helpers for attachment previews, dev gates, markdown/code highlighting, and copy UX; see `src/utils/CLAUDE.md`.

## Send paths

- Simple path: pass `transport` (URL string or `Transport`) and Chorus handles POST/fetch/WebSocket-style SSE streaming through connectors.
- Advanced path: pass `onSend` for custom clients or non-SSE flows; use helpers (`appendAssistant`, `finalizeAssistant`, `signal`) to drive output.
- If both are provided, `transport` takes precedence.

## Provider mapping vs connectors

`providerRequests.ts` builds outbound provider request bodies; `connectors/` parses inbound SSE chunks. Keep provider-specific request mapping and response parsing paired conceptually but implemented separately.

## Commands

- Tests: `npm test`
- Dev playground: `npm run dev`
- Build: `npm run build`

## CI gate (run before pushing)

Recurring CI failures: lint errors (`no-explicit-any`, `prefer-const`, `no-this-alias`), README bundle-size drift, and `examples/*` build failures. Lint runs first with `--max-warnings=0` and skips everything else on failure, so one error masks the rest. Any `src/` change can shift the README bundle-size table (~line 692) and playground sentence below it — refresh the numbers from stdout or `.cache/react-chorus/*-bundle-size-report.json`. Example builds run each example's own `next build`/`vite build` against its pinned typings, so type refactors in `src/` (and the library's React 19 typings) can surface in examples even though the root typecheck passes; bump `@types/react`/`@types/react-dom` in an example if it pins v18 and hits a `ReactPortal`/`ReactNode` mismatch. For unavoidable `any` (e.g. `Connector<State = any>` bivariance), use a focused `// eslint-disable-next-line` with a one-line reason.

Pre-push one-liner: `npm run lint && npm run typecheck && npm run build && npm run verify:bundle-size && npm run build:playground && npm run verify:examples`.

## Design invariant

Public API stability matters: never break `ChorusProps` or exported component/hook contracts without a major version bump.
