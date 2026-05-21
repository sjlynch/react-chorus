# react-chorus guide

react-chorus is a composable React chat UI library with batteries-included message rendering, input, streaming, persistence, and theming. It can be used as a full `<Chorus>` widget or by importing headless/component pieces for custom shells.

## Directory map

- `src/index.ts` — root public barrel; update it when the exported API surface changes.
- `src/types.ts` — core public types for messages, roles, attachments, tool calls, connectors, and storage adapters.
- `src/Chorus.tsx` — main public component and `ChorusProps`; coordinates state, streaming, persistence, errors, retry/stop/edit/regenerate while delegating shell-derived state/composer actions.
- `src/chorus-shell/` — internal helpers for `<Chorus>` shell derived flags, composer draft/reset state, and UI action handlers; see `src/chorus-shell/CLAUDE.md`.
- `src/headless.ts` / `src/ChorusHeadless.tsx` — `react-chorus/headless` entry and wrapper that default supported components to `headless: true`.
- `src/providerRequests.ts` — outbound request mappers and `formatXyzBody` helpers for OpenAI Chat/Responses, Anthropic Messages, and Gemini GenerateContent, exported via root and `react-chorus/provider-requests`.
- `src/transport.ts` — `react-chorus/transport` barrel for transport factories and the `Transport` type.
- `src/server.ts` — `react-chorus/server` barrel for SSE framing helpers (`sseHeaders`, `formatSSEEvent`/`encodeSSEEvent`, `formatSSEDone`/`encodeSSEDone`, `formatSSEError`/`encodeSSEError`) used by proxy routes (Next.js, Express, etc.).
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
- Coverage: `npm run test:coverage` (enforces thresholds — see below)
- Dev playground: `npm run dev`
- Build: `npm run build`

## Coverage thresholds

`vitest.config.ts` sets v8 coverage thresholds that `npm run test:coverage` (and therefore `prepublishOnly`) enforces. Current floors: `statements: 82`, `branches: 73`, `functions: 87`, `lines: 86`. They are intentionally a couple of points below measured coverage at the time they were introduced so the gate catches regressions without flapping on small natural drift. To raise them, run `npm run test:coverage`, take the new percentages from the `Coverage summary` block, subtract ~1–2pp of headroom, and bump the values in `vitest.config.ts` — do this as its own commit so reviewers can see the new floor. Don't lower a threshold to make a failing run pass; investigate the regression instead.

## Design invariant

Public API stability matters: never break `ChorusProps` or exported component/hook contracts without a major version bump.
