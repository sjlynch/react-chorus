# react-chorus multi-provider example

A zero-backend Vite demo of the new `<Chorus providers>` registry. Three mock
transports drive the built-in **`openai`**, **`anthropic`**, and **`gemini`**
connectors side-by-side in a single conversation. Each assistant message is
tagged with the routed provider so the bubble model badge identifies which
provider produced the reply.

The composer renders an inline provider dropdown next to the send button.
You can also type the slash command `/model:<id>` (e.g. `/model:anthropic`)
to switch the next turn without leaving the keyboard. The conversation
itself remains a single transcript across provider switches — the differ
from Open WebUI's per-conversation picker.

## Prerequisites

- Node.js 20.19+ or 22.12+
- No API keys — all replies are generated locally by the mock transports in
  `src/App.tsx`.

## Run from a fresh clone

```bash
# 1. Build react-chorus from the repository root.
npm install
npm run build

# 2. Install and start the example.
cd examples/multi-provider
npm install
npm run dev
```

Vite prints the local URL (usually <http://localhost:5173>). Use the
dropdown in the composer to switch providers between turns; assistant
bubbles carry a small badge showing which provider answered.

## Wiring real backends

Each provider entry takes the same `transport` shape as the conversation-
level `transport` prop, so the migration is mechanical:

```tsx
<Chorus
  providers={{
    openai:    { transport: '/api/openai/chat',    connector: 'openai',    label: 'OpenAI',    modelId: 'gpt-4o-mini' },
    anthropic: { transport: '/api/anthropic/chat', connector: 'anthropic', label: 'Claude',    modelId: 'claude-3-5-sonnet' },
    gemini:    { transport: '/api/gemini/chat',    connector: 'gemini',    label: 'Gemini',    modelId: 'gemini-2.5-flash' },
  }}
  defaultProvider="openai"
/>
```

Each route can use the matching `formatOpenAIChatCompletionsBody`,
`formatAnthropicMessagesBody`, or `formatGeminiGenerateContentBody` helper
re-exported from `react-chorus/provider-requests` to map the Chorus
`history` into the provider's expected request shape, and frame the
upstream SSE stream with `react-chorus/server` (see the per-provider
examples — `with-openai`, `with-anthropic`, `with-gemini` — for the
single-provider proxy patterns).
