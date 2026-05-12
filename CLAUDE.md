# react-chorus guide

react-chorus is a composable React chat UI library with batteries-included message rendering, input, streaming, persistence, and theming. It can be used as a full `<Chorus>` widget or by importing headless/component pieces for custom shells.

## Directory map

- `src/Chorus.tsx` — main public component and `ChorusProps`; coordinates state, streaming, persistence, errors, retry/stop/edit/regenerate.
- `src/components/` — UI pieces (`ChatWindow`, `ChatInput`, `Markdown`, `ChorusTheme`, `ToolCallBlock`, `MessageBubble`).
- `src/hooks/` — reusable streaming and persistence hooks.
- `src/connectors/` — provider-specific SSE payload parsers.
- `src/streaming/` — transport factories that return SSE-shaped `Response` streams.

## Send paths

- Simple path: pass `transport` (URL string or `Transport`) and Chorus handles POST/fetch/WebSocket-style SSE streaming through connectors.
- Advanced path: pass `onSend` for custom clients or non-SSE flows; use helpers (`appendAssistant`, `finalizeAssistant`, `signal`) to drive output.
- If both are provided, `transport` takes precedence.

## Commands

- Tests: `npm test`
- Dev playground: `npm run dev`
- Build: `npm run build`

## Design invariant

Public API stability matters: never break `ChorusProps` or exported component/hook contracts without a major version bump.
