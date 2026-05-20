# react-chorus Vercel AI SDK example

A zero-backend Vite demo of the built-in **`ai-sdk`** connector. `src/App.tsx`
ships a mock `Transport` that streams Vercel AI SDK **UI message stream** events
— `reasoning-delta` and `text-delta` frames wrapped in the usual lifecycle
frames — so you can watch the connector parse a real AI SDK stream without an
API key.

This example reflects the [Vercel AI SDK stream format](../../README.md#vercel-ai-sdk-stream-format)
section of the root README.

## Prerequisites

- Node.js 20+
- No API keys — the reply is generated locally by the mock transport in `src/App.tsx`.

## Run from a fresh clone

```bash
# 1. Build react-chorus from the repository root — the example consumes the
#    local build via "react-chorus": "file:../..".
npm install
npm run build

# 2. Install and start the example
cd examples/with-vercel-ai-sdk
npm install
npm run dev
```

Vite prints the local URL (usually <http://localhost:5173>). Send a message and
watch the reasoning trace and reply stream in.

## Wiring a real Vercel AI SDK backend

The `ai-sdk` connector reads the AI SDK's **UI message stream**, which is
already SSE-formatted, so the default `transport="/api/chat"` shortcut works
with no extra wiring. Replace `mockAiSdkTransport` in `src/App.tsx` with:

```tsx
import { Chorus } from 'react-chorus';

<Chorus transport="/api/chat" connector="ai-sdk" />
```

Then add a Next.js App Router route that returns `toUIMessageStreamResponse()`:

```ts
// app/api/chat/route.ts  —  npm install ai @ai-sdk/openai
import { openai } from '@ai-sdk/openai';
import { streamText, convertToModelMessages } from 'ai';
import type { Message } from 'react-chorus';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json()) as { history?: Message[] };
  const history = Array.isArray(body.history) ? body.history : [];

  const result = streamText({
    model: openai('gpt-4o-mini'),
    messages: convertToModelMessages(
      history.map((m) => ({
        id: m.id,
        role: m.role,
        parts: [{ type: 'text', text: m.text ?? '' }],
      })),
    ),
  });

  // toUIMessageStreamResponse returns text/event-stream with `data: {...}` frames.
  return result.toUIMessageStreamResponse();
}
```

See [`examples/with-next`](../with-next) for a full Next.js App Router project
layout. The AI SDK v4 `toDataStreamResponse()` protocol is also supported — the
root README's [Vercel AI SDK stream format](../../README.md#vercel-ai-sdk-stream-format)
section covers the one-line server re-framing it needs.

## Where to look next

- [`src/App.tsx`](./src/App.tsx) — the mock transport and the `connector="ai-sdk"` wiring.
- [Root README](../../README.md) — full API reference and recipes.
