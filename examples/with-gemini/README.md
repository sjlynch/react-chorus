# react-chorus Gemini example

A zero-backend Vite demo of the built-in **`gemini`** connector. `src/App.tsx`
ships a mock `Transport` that streams Gemini `generateContent` SSE chunks — each
chunk carries a `candidates` array, a `thought: true` part maps to reasoning,
and the final chunk sets `finishReason: "STOP"` — so you can watch the connector
parse a real Gemini-shaped stream without an API key.

This example reflects the [Gemini SSE format](../../README.md#gemini-sse-format)
section of the root README.

## Prerequisites

- Node.js 20.19+ or 22.12+ (required by the example's `vite: ^8` toolchain)
- No API keys — the reply is generated locally by the mock transport in `src/App.tsx`.

## Run from a fresh clone

```bash
# 1. Build react-chorus from the repository root — the example consumes the
#    local build via "react-chorus": "file:../..".
npm install
npm run build

# 2. Install and start the example
cd examples/with-gemini
npm install
npm run dev
```

Vite prints the local URL (usually <http://localhost:5173>). Send a message and
watch the reasoning trace and reply stream in.

## Wiring a real Gemini backend

Keep your `GEMINI_API_KEY` on the server. Replace `mockGeminiTransport` in
`src/App.tsx` with the default fetch transport:

```tsx
import { Chorus } from 'react-chorus';

<Chorus transport="/api/chat" connector="gemini" />
```

Then add an SSE proxy that maps Chorus history with `toGeminiGenerateContentBody`
and frames the Gemini SDK stream with `react-chorus/server`:

```js
// server/index.js  —  npm install express @google/generative-ai
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { toGeminiGenerateContentBody } from 'react-chorus/provider-requests';
import { formatSSEDone, formatSSEError, formatSSEEvent, sseHeaders } from 'react-chorus/server';

const app = express();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); // keep server-side

app.use(express.json({ limit: '10mb' }));

app.post('/api/chat', async (req, res) => {
  // `history` already includes the new user turn — ignore `req.body.prompt`.
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  res.writeHead(200, sseHeaders);
  try {
    const result = await model.generateContentStream(toGeminiGenerateContentBody(history));
    for await (const chunk of result.stream) {
      res.write(formatSSEEvent(chunk));
    }
    // Always emit `[DONE]` — a turn that ends without a STOP/MAX_TOKENS
    // finishReason would otherwise leave the client waiting.
    res.write(formatSSEDone());
  } catch (err) {
    res.write(formatSSEError(err));
  } finally {
    res.end();
  }
});

app.listen(3001, () => console.log('Gemini proxy on http://localhost:3001'));
```

Proxy `/api` to the backend in `vite.config.ts` (see
[`examples/with-openai`](../with-openai) for the full two-terminal setup).

> A `MAX_TOKENS` finish reason completes the stream and produces a non-fatal
> `truncated` connector warning plus `metadata.finishReason: 'MAX_TOKENS'` on
> the finalized message; blocked reasons such as `SAFETY` surface through
> `onError`.

## Where to look next

- [`src/App.tsx`](./src/App.tsx) — the mock transport and the `connector="gemini"` wiring.
- [Root README](../../README.md) — full API reference and recipes.
