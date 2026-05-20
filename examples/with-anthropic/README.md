# react-chorus Anthropic example

A zero-backend Vite demo of the built-in **`anthropic`** connector. `src/App.tsx`
ships a mock `Transport` that streams Anthropic Messages SSE events — a
`thinking_delta` followed by `text_delta`s, terminated by `message_stop` — so you
can watch the connector parse reasoning and text out of a real Anthropic-shaped
stream without an API key.

This example reflects the [Anthropic SSE format](../../README.md#anthropic-sse-format)
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
cd examples/with-anthropic
npm install
npm run dev
```

Vite prints the local URL (usually <http://localhost:5173>). Send a message and
watch the reasoning trace and reply stream in.

## Wiring a real Anthropic backend

Keep your `ANTHROPIC_API_KEY` on the server. Replace `mockAnthropicTransport` in
`src/App.tsx` with the default fetch transport:

```tsx
import { Chorus } from 'react-chorus';

<Chorus transport="/api/chat" connector="anthropic" />
```

Then add an SSE proxy that maps Chorus history with `toAnthropicMessagesBody`
and frames the Anthropic SDK stream with `react-chorus/server`:

```js
// server/index.js  —  npm install express @anthropic-ai/sdk
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { toAnthropicMessagesBody } from 'react-chorus/provider-requests';
import { formatSSEDone, formatSSEError, formatSSEEvent, sseHeaders } from 'react-chorus/server';

const app = express();
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

app.use(express.json({ limit: '10mb' }));

app.post('/api/chat', async (req, res) => {
  // `history` already includes the new user turn — ignore `req.body.prompt`.
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  res.writeHead(200, sseHeaders);
  try {
    const stream = await client.messages.stream(
      toAnthropicMessagesBody(history, { model: 'claude-sonnet-4-6', max_tokens: 1024 }),
      { signal: controller.signal },
    );
    for await (const event of stream) {
      if (controller.signal.aborted) break;
      res.write(formatSSEEvent(event));
    }
    if (!controller.signal.aborted) res.write(formatSSEDone());
  } catch (err) {
    if (!controller.signal.aborted) res.write(formatSSEError(err));
  } finally {
    res.end();
  }
});

app.listen(3001, () => console.log('Anthropic proxy on http://localhost:3001'));
```

Proxy `/api` to the backend in `vite.config.ts` (see
[`examples/with-openai`](../with-openai) for the full two-terminal setup).

## Where to look next

- [`src/App.tsx`](./src/App.tsx) — the mock transport and the `connector="anthropic"` wiring.
- [`examples/with-websocket`](../with-websocket) — the same `anthropic` connector over a WebSocket transport.
- [Root README](../../README.md) — full API reference and recipes.
