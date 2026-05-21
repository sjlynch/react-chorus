# react-chorus

Drop a polished, streaming AI chat experience into React — then peel back the layers when you need custom transport, rendering, persistence, tools, attachments, or theming.

[![CI](https://github.com/sjlynch/react-chorus/actions/workflows/ci.yml/badge.svg)](https://github.com/sjlynch/react-chorus/actions/workflows/ci.yml)

**[→ Try the live demo](https://sjlynch.github.io/react-chorus/)** &nbsp;·&nbsp; [![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/sjlynch/react-chorus?file=src%2Fmain.tsx)

The live demo runs entirely in your browser — no backend needed. It drives `<Chorus>` through a mock OpenAI-format SSE transport so you can see streaming replies, reasoning traces, tool calls, multi-conversation persistence, and palette theming with one click. Open it in StackBlitz if you want to edit the source side-by-side, or run `npm run dev` locally.

## Contents

- [Why react-chorus?](#why-react-chorus)
- [Install](#install)
- [Quick start](#quick-start)
- [Two usage paths](#two-usage-paths) — the `transport` prop, the `onSend` callback, and auth headers
- [Provider request/body helpers](#provider-requestbody-helpers)
- [Connectors](#connectors)
- Streaming formats — [OpenAI](#openai-sse-format) · [Anthropic](#anthropic-sse-format) · [Gemini](#gemini-sse-format) · [Vercel AI SDK](#vercel-ai-sdk-stream-format)
- [Examples](#examples)
- [Bundle size](#bundle-size)
- [SSR and Markdown sanitization](#ssr-and-markdown-sanitization)
- [Security and CSP](#security-and-csp)
- [API](#api) — `<Chorus>` props, `ChorusRef`, persistence, `useChorusStream`, and the transport factories
- [Serializing multimodal and tool-call history](#serializing-multimodal-and-tool-call-history)
- [Tool calls and agent steps](#tool-calls-and-agent-steps)
- [Theming](#theming)
- [Individual Components](#individual-components)
- [Message Shape](#message-shape)
- [Migration and Upgrading](#migration-and-upgrading)
- [Development and release](#development-and-release)
- [License](#license)

## Why react-chorus?

react-chorus is for React developers who want a drop-in AI chat UI that stays composable. Use the batteries-included `<Chorus>` widget for a production-ready shell, or import the headless/hooks/components when your product needs a custom layout.

- **Versus Vercel AI SDK:** react-chorus focuses on the visible chat UI and composer UX; pair it with any backend or SDK, including Vercel AI SDK, instead of adopting a specific transport stack. A dedicated [`'ai-sdk'` connector](#vercel-ai-sdk-stream-format) understands both AI SDK UI-message-stream JSON and the prefix-coded data-stream protocol so AI SDK routes work without writing a custom parser.
- **Versus assistant-ui:** react-chorus keeps the default path small and direct while still exposing message rendering, streaming, persistence, and theme primitives.
- **Versus rolling your own:** you get SSE parsing, retry/edit/regenerate flows, Markdown, attachment handling, and local persistence without rebuilding the common edge cases.

## Install

react-chorus requires Node.js 20.19+ or 22.12+ for package installation, server-side usage, and the Vite-powered dev/build tooling. Installing on an older Node 20 release (20.0–20.18) emits an `npm WARN EBADENGINE` warning.

```bash
npm install react-chorus
```

Import the stylesheet once at your app entry point:

```tsx
import 'react-chorus/styles.css';
```

## Quick start

Start with the **simple `transport` path**: point Chorus at a server-side SSE endpoint and name the connector that matches your model provider.

```tsx
import 'react-chorus/styles.css';
import { Chorus } from 'react-chorus';

export default function App() {
  return (
    <div style={{ height: '100dvh' }}>
      <Chorus transport="/api/chat" connector="openai" />
    </div>
  );
}
```

`transport` requires an endpoint that returns Server-Sent Events. Chorus POSTs `{ prompt: string, history: Message[] }` to the URL and streams the SSE response into the assistant message automatically. **`history` already includes the latest user turn** — `prompt` is a duplicate convenience copy of that same text, not the next message to append. Map `history` directly on the server and ignore `prompt`; appending `prompt` to `history` will send the new user message to the model twice. See the [Next.js App Router route handler](#nextjs-app-router-route-handler), the [Minimal Express + OpenAI backend](#minimal-express--openai-backend), or the runnable [`examples/with-next`](./examples/with-next) and [`examples/with-openai`](./examples/with-openai) apps for server-safe proxies.

> **Layout footgun — give Chorus an explicit height.** `<Chorus>` fills its parent, so the wrapper needs an explicit height (for example `100dvh`) for the transcript to scroll internally instead of growing the page. Two things commonly break this when you embed `<Chorus>` in a flex parent. First, the browser-default `margin` on `<body>` makes a `100dvh` child overflow the viewport by exactly that margin and show a stray outer scrollbar — reset it with `body { margin: 0 }`. Second, a flex child will not shrink below its content size by default: inside a `display: flex` parent, give the Chorus wrapper `flex: 1; min-height: 0` rather than a fixed `100dvh` so it fills the remaining space without overflowing.

### Advanced — customize the request with `onSend`

When you need direct control — proxying through a custom client, a non-SSE transport, or modifying messages before they are sent — use the advanced `onSend` callback instead of `transport`. Because `onSend` is just a function, it can also stream a reply with no backend at all, which is handy for prototypes, demos, and tests:

```tsx
import 'react-chorus/styles.css';
import { Chorus, type ChorusOnSend } from 'react-chorus';

const demoReply: ChorusOnSend = async (_text, _messages, helpers) => {
  for (const chunk of ['This quick start runs ', 'without a backend ', 'and still streams.']) {
    if (helpers.signal.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
    helpers.appendAssistant(chunk);
  }
  helpers.finalizeAssistant();
};

export default function App() {
  return (
    <div style={{ height: '100dvh' }}>
      <Chorus
        onSend={demoReply}
        suggestedPrompts={[
          'Summarize today’s release notes',
          'Draft a customer support reply',
          'Brainstorm three product ideas',
        ]}
      />
    </div>
  );
}
```

When the transcript is empty, `suggestedPrompts` renders starter buttons that fill and focus the composer without auto-sending. The [Two usage paths](#two-usage-paths) section documents `transport` and `onSend` in full — including auth headers, the WebSocket transport, and driving Chorus with `useChorusStream` directly.

## Two usage paths

### Simple path — `transport` prop

Pass a URL string, a `{ url, headers, credentials, ... }` config object, or a `Transport` function. Chorus handles everything:

```tsx
// String: Chorus POSTs { prompt, history } and reads the SSE stream.
// `history` already includes the new user turn; `prompt` is a duplicate
// of `history[last].text`. Read `history` on the server and ignore `prompt`.
<Chorus transport="/api/chat" />

// Object form: same defaults, plus auth headers / cookies / any RequestInit field
<Chorus
  transport={{
    url: '/api/chat',
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'include',
  }}
/>

// Custom Transport function (for non-default request shapes)
import { createFetchSSETransport } from 'react-chorus';

const transport = createFetchSSETransport('/api/chat', {
  headers: { Authorization: `Bearer ${token}` },
});

<Chorus transport={transport} />
```

#### Adding auth headers / cookies

The string shorthand has no place to hang an `Authorization` header or `credentials: 'include'`. Pass the object form (or a `createFetchSSETransport` instance) the moment you need either:

```tsx
// Session cookies on a same-origin endpoint
<Chorus transport={{ url: '/api/chat', credentials: 'same-origin' }} />

// Bearer token + CSRF + cross-origin cookies
<Chorus
  transport={{
    url: 'https://api.example.com/chat',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-CSRF-Token': csrfToken,
    },
    credentials: 'include',
  }}
/>
```

`headers`, `credentials`, `cache`, `mode`, `referrer`, and the other [`RequestInit`](https://developer.mozilla.org/docs/Web/API/RequestInit) fields are forwarded straight to `fetch`. Chorus reserves `body` and `signal` (the body is `JSON.stringify({ prompt, history })` by default — pass a `formatBody` to override). `method` defaults to `'POST'` but can be set to any of `'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'`; bodyless methods (`'GET'`/`'HEAD'`) skip `formatBody` and the default JSON `Content-Type`, so encode any state in query params on `url`. Caller headers always win: if you set a `Content-Type` header, the transport will not override it, so overriding it without also overriding `formatBody` will send JSON bytes under the wrong media type. To use the default JSON body and a custom `Content-Type`, override `formatBody` as well. Annotate the config with `FetchTransportInit` if you want to extract it into a reusable constant.

Seed an uncontrolled chat with a welcome message and include a hidden system prompt in every transport request:

```tsx
<Chorus
  transport="/api/chat"
  initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Hi! How can I help?' }]}
  systemPrompt="You are a concise support assistant."
/>
```

`systemPrompt` is prepended to the request `history` sent through the `transport` prop but is not rendered in the transcript. On the advanced `onSend` path, Chorus does not mutate the `messages` array; read the same value from `helpers.systemPrompt` when building your custom request.

### Advanced path — `onSend` callback

Use `onSend` when you need direct control: proxying through a custom client, handling non-SSE transports, or modifying messages before they're added.

```tsx
import 'react-chorus/styles.css';
import React from 'react';
import { Chorus, createFetchSSETransport, useChorusStream } from 'react-chorus';
import type { ChorusOnSend, Message } from 'react-chorus';

const transport = createFetchSSETransport('/api/chat');

export default function App() {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const { send, sending } = useChorusStream(transport, { connector: 'openai' });

  const handleSend: ChorusOnSend = (text, msgs, helpers) => {
    const requestMessages = helpers.systemPrompt && !msgs.some((m) => m.role === 'system')
      ? [{ id: 'system', role: 'system' as const, text: helpers.systemPrompt }, ...msgs]
      : msgs;

    return send(
      text,
      requestMessages,
      helpers.streamCallbacks?.() ?? { onChunk: helpers.appendAssistant, onDone: helpers.finalizeAssistant },
      helpers.signal,
    );
  };

  return (
    <div style={{ height: '100dvh' }}>
      <Chorus
        value={messages}
        onChange={setMessages}
        sending={sending}
        onSend={handleSend}
        systemPrompt="You are a concise engineering assistant."
        placeholder="Type a message…"
        suggestedPrompts={['Explain this code path', 'Write a regression test', 'Summarize the latest logs']}
        errorMessage="The assistant could not complete that request. Please try again."
        onError={(error) => console.error(error)}
      />
    </div>
  );
}
```

`createFetchSSETransport(url)` posts `{ prompt, history }` to your endpoint and reads the response as a Server-Sent Events stream. **`history` already includes the latest user message** — `prompt` is a duplicate convenience copy, not a separate "new message" field. Backends should map `history` directly; appending `prompt` to `history` will deliver the latest user turn to the model twice, and using `prompt` alone will drop all prior context. Pass a `formatBody` option to customise the request shape for OpenAI, FastAPI, FormData uploads, or any other backend. The transport sets `Content-Type: application/json` only for its default JSON body; custom serializers should set JSON headers themselves and FormData/Blob/URLSearchParams are not forced to JSON. The `openai` connector parses the standard selected `choices[0]` text, reasoning, and tool-call delta shapes.

For reusable callbacks, import `ChorusOnSend<TMeta>` or the lower-level `ChorusSendHelpers` type instead of duplicating the helper shape. `ChorusOnSend<TMeta>` preserves your `Message<TMeta>.metadata` type through the `messages` argument and returned assistant message. If you pass `systemPrompt`, read it from `helpers.systemPrompt`; Chorus intentionally does not prepend it to `messages` on the `onSend` path so custom senders that already manage system messages do not get duplicates.

For a non-streaming client, `onSend` may return a complete assistant `Message`. Chorus appends it to the **live** transcript when the promise resolves (after `minAssistantDelayMs`). The `messages` argument is a snapshot taken at send time, so do not mutate the transcript while an `onSend` is in flight — resolving a delete confirmation, re-deriving the controlled array in `onChange`, or a persistence load mid-send lands the returned message on a transcript that no longer matches what `onSend` saw. Stream via `helpers.appendAssistant()` instead if the transcript can change during the turn:

```tsx
<Chorus
  onSend={async (text) => {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text }),
    });
    return {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: (await r.json()).reply,
    };
  }}
/>
```

Both paths render the same transcript, so the headless [`useChorusTranscriptActions`](#transcript-search-copy-and-export) hook — transcript-wide search, copy-conversation, and Markdown/JSON export — works the same whether you drive Chorus with `transport` or `onSend`.

### Next.js App Router route handler

For a production Next.js app, keep `OPENAI_API_KEY` on the server and expose an App Router route handler that speaks SSE to Chorus. Install `openai` in your app for this variant. A runnable version lives in [`examples/with-next`](./examples/with-next).

```ts
// app/api/chat/route.ts
import OpenAI from 'openai';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import { toOpenAIChatCompletionsBody } from 'react-chorus/provider-requests';
import { encodeSSEDone, encodeSSEError, encodeSSEEvent, sseHeaders } from 'react-chorus/server';
import type { Message } from 'react-chorus';

export const runtime = 'nodejs'; // required when using the official OpenAI Node client
export const maxDuration = 60; // optional on Vercel; choose a value your plan allows

export async function POST(request: Request) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Chorus POSTs `{ prompt, history }`. `history` already includes the new
        // user turn — don't also append `body.prompt`, or the message goes twice.
        const body = (await request.json()) as { history?: unknown };
        const history = Array.isArray(body.history) ? (body.history as Message[]) : [];
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

        const openai = new OpenAI({ apiKey });
        const completionBody = {
          ...toOpenAIChatCompletionsBody(history, { model: 'gpt-4o-mini' }),
          stream: true,
        } satisfies ChatCompletionCreateParamsStreaming;

        const upstream = await openai.chat.completions.create(completionBody, { signal: request.signal });

        for await (const chunk of upstream) {
          controller.enqueue(encodeSSEEvent(chunk));
        }

        controller.enqueue(encodeSSEDone());
      } catch (error) {
        if (!request.signal.aborted) {
          controller.enqueue(encodeSSEError(error));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
}
```

The route maps Chorus `history` with `toOpenAIChatCompletionsBody` and uses `react-chorus/server` helpers to handle the wire format: `sseHeaders` sets the correct `text/event-stream` / `no-transform` / `X-Accel-Buffering: no` headers, `encodeSSEEvent(chunk)` re-emits every OpenAI chunk as `data: <json>\n\n`, `encodeSSEDone()` forwards the `[DONE]` sentinel, and `encodeSSEError(error)` writes the `{ error: "..." }` envelope so `connector="openai"` can surface failures through `onError` / `errorMessage`. The helpers also split multi-line string payloads into one `data:` line per line per the SSE spec, so reasoning traces and other multi-line strings are framed correctly.

Runtime and serverless notes:

- Use `export const runtime = 'nodejs'` with the official `openai` package. If you need the Edge runtime, call OpenAI's REST endpoint with `fetch` instead and pipe `upstream.body` through the same SSE headers and `{ error }` envelope.
- Vercel Route Handlers stream Web `Response` bodies, but buffering can still be introduced by middleware, reverse proxies, or CDNs. Keep `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, and `X-Accel-Buffering: no`; do not read the whole provider stream before returning.
- Image attachments are sent as data URLs in the JSON `history` unless you provide a custom upload flow. Vercel/serverless request body limits (commonly around 4.5 MB) can be hit quickly, and App Router route handlers do not have Express-style `json({ limit })`. Keep `maxAttachmentBytes` below your host limit, compress images, or upload large files to object storage and send URLs instead.

### Minimal Express + OpenAI backend

```js
// server/index.js
import express from 'express';
import OpenAI from 'openai';
import { toOpenAIChatCompletionsBody } from 'react-chorus/provider-requests';
import { formatSSEDone, formatSSEError, formatSSEEvent, sseHeaders } from 'react-chorus/server';

const app = express();
const openai = new OpenAI(); // reads OPENAI_API_KEY from env; keep this server-side

app.use(express.json({ limit: '10mb' })); // data URL image attachments can be large

app.post('/api/chat', async (req, res) => {
  // Chorus POSTs `{ prompt, history }`. `history` already includes the new
  // user turn — don't also append `req.body.prompt`, or the message goes twice.
  const history = Array.isArray(req.body?.history) ? req.body.history : [];

  res.writeHead(200, sseHeaders);

  try {
    const stream = await openai.chat.completions.create(
      toOpenAIChatCompletionsBody(history, { model: 'gpt-4o-mini' }),
    );

    for await (const chunk of stream) {
      res.write(formatSSEEvent(chunk));
    }

    res.write(formatSSEDone());
  } catch (err) {
    res.write(formatSSEError(err));
  } finally {
    res.end();
  }
});

app.listen(3001);
```

## Using the WebSocket transport

For backends built on Socket.IO, `ws`, Ably, Pusher, or any other WebSocket server, use `createWebSocketTransport`:

```tsx
import 'react-chorus/styles.css';
import React from 'react';
import { Chorus, createWebSocketTransport, useChorusStream } from 'react-chorus';
import type { Message } from 'react-chorus';

export default function App() {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [connectionStatus, setConnectionStatus] = React.useState('idle');

  const transport = React.useMemo(
    () => createWebSocketTransport('wss://api.example.com/chat', {
      onOpen: () => setConnectionStatus('open'),
      onClose: (code, reason) =>
        setConnectionStatus(
          code === 1000 ? 'closed' : `disconnected (${code}: ${reason || 'no reason'})`,
        ),
      onError: () => setConnectionStatus('error'),
    }),
    [],
  );

  const { send, sending } = useChorusStream(transport, { connector: 'anthropic' });

  return (
    <div style={{ height: '100dvh' }}>
      {connectionStatus === 'connecting' && <div role="status">Connecting…</div>}
      {connectionStatus.startsWith('disconnected') && <div role="alert">Disconnected</div>}
      <Chorus
        value={messages}
        onChange={setMessages}
        sending={sending}
        onSend={async (text, msgs, helpers) => {
          setConnectionStatus('connecting');
          await send(
            text,
            msgs,
            helpers.streamCallbacks?.() ?? { onChunk: helpers.appendAssistant, onDone: helpers.finalizeAssistant },
            helpers.signal,
          );
        }}
        placeholder="Type a message…"
      />
    </div>
  );
}
```

Each incoming WebSocket message is treated as one SSE payload, so the same connector/extraction pipeline applies unchanged. By default a WebSocket transport opens a fresh socket for each send. For backends where the auth/subscribe handshake is expensive, pass `{ persistent: true }` to reuse one socket across sends and call `transport.close()` when your component/app no longer needs it.

> ⚠️ **Persistent mode has no built-in request/response correlation.** Every inbound frame is broadcast to every currently active response stream, so if two sends overlap (e.g. the user submits a second message before the first finishes, or a Stop-then-resend race) the same chunks are duplicated into both assistant messages. Either guarantee at the protocol layer that responses can never interleave, or pair a `formatMessage` that returns `{ payload, correlationId }` with a `correlate(frame)` callback so each frame is routed to the request that started it. In dev mode the transport will log a one-time `console.warn` the first time it sees overlapping sends without a `correlate` callback.

If you only need the non-React transport factories, import them from the transport-only subpath to avoid pulling UI or Markdown code into that bundle:

```ts
import { createFetchSSETransport, createWebSocketTransport } from 'react-chorus/transport';
```

### Minimal Node.js `ws` + Claude backend

```js
// server.js  —  npm install ws @anthropic-ai/sdk react-chorus
import { WebSocket, WebSocketServer } from 'ws';
import Anthropic from '@anthropic-ai/sdk';
import { toAnthropicMessagesBody } from 'react-chorus/provider-requests';

const wss = new WebSocketServer({ port: 8080 });
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env; keep this server-side

wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    // Chorus sends `{ prompt, history }` on every frame. `history` already
    // includes the new user turn; ignore `prompt` to avoid sending it twice.
    const { history = [] } = JSON.parse(raw.toString());

    // Cancel the upstream Anthropic stream if the browser disconnects or
    // hits Stop — otherwise the SDK keeps draining tokens (and billing) to
    // a socket that nobody is listening on.
    const controller = new AbortController();
    const cancel = () => controller.abort();
    ws.on('close', cancel);
    ws.on('error', cancel);

    const safeSend = (payload) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    try {
      const stream = await client.messages.stream(
        toAnthropicMessagesBody(Array.isArray(history) ? history : [], {
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
        }),
        { signal: controller.signal },
      );

      // Forward raw Anthropic SDK events verbatim — the front-end
      // `anthropic` connector parses `content_block_delta` / `message_stop`
      // directly, so no server-side reshaping is needed.
      for await (const event of stream) {
        if (controller.signal.aborted) break;
        safeSend(event);
      }
      // `client.messages.stream` already emits a `message_stop` event,
      // which the anthropic connector treats as the done sentinel. The
      // react-chorus WebSocket transport opens a fresh socket per send and
      // closes it client-side after that sentinel is processed.
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        safeSend({ error: message });
      }
    } finally {
      ws.off('close', cancel);
      ws.off('error', cancel);
    }
  });
});
```

Like the Express/OpenAI and Next.js App Router examples above, the backend cancels its upstream provider stream as soon as the client disconnects or stops. Without this, the Anthropic SDK keeps draining tokens to a closed socket — the server is billed for output that no UI is rendering, and the loop can sit on a half-open socket until the OS times it out. The `AbortController` is created per message, threaded into `client.messages.stream(..., { signal })`, and tripped by `'close'` / `'error'` listeners that are removed when the stream finishes. Every `ws.send` is guarded by `readyState === WebSocket.OPEN` so a late event after disconnect cannot throw.

The front-end pairs this with `connector: 'anthropic'` (see the React snippet above) so it reads `content_block_delta` / `message_stop` events out of each WebSocket frame the same way it would over an SSE stream.

> **Runnable example:** [`examples/with-websocket`](./examples/with-websocket) wires `createWebSocketTransport` to a tiny local `ws` server that streams canned Claude-style frames, so you can see this recipe end-to-end without an API key — and its README shows the one-line swap to the real Anthropic backend above.

## Provider request/body helpers

Connectors parse provider streams on the way back; request helpers serialize Chorus `Message[]` on the way out. Use them on your server proxy (recommended) or as `createFetchSSETransport(..., { formatBody })` body formatters when posting to your own backend.

```ts
import {
  formatAnthropicMessagesBody,
  formatGeminiGenerateContentBody,
  formatOpenAIChatCompletionsBody,
  formatOpenAIResponsesBody,
  toAnthropicMessagesBody,
  toGeminiGenerateContentBody,
  toOpenAIChatCompletionsBody,
  toOpenAIResponsesBody,
} from 'react-chorus/provider-requests';
```

These helpers are also re-exported from `react-chorus` for browser apps; the `react-chorus/provider-requests` subpath avoids loading React peer imports in server-only code.

| Helper | Provider request shape | Notes |
|--------|------------------------|-------|
| `toOpenAIChatCompletionsBody(history, opts)` / `formatOpenAIChatCompletionsBody(opts)` | `{ model, messages, stream }` | Maps `system`/`user`/`assistant`, user image attachments to `image_url`, and `tool` messages with `metadata.openai.toolCallId` (or `metadata.tool_call_id`) to OpenAI `role: 'tool'`. Image URLs are taken from `attachment.url` then `attachment.data`; accepted shapes are absolute `http(s):` URLs, well-formed base64 `data:` URLs, and relative paths without a scheme (e.g. `/uploads/abc.png`, forwarded verbatim so OpenAI fetches them from the proxy host). Other URI schemes (`gs:`, `file:`, `blob:`, …) and malformed `data:` URLs fall back to text notes and log a dev-mode warning. Attachments other than images are not supported by the Chat Completions content spec and fall back to text notes. Without a provider tool id, tool results become safe system context instead of invalid OpenAI messages. |
| `toOpenAIResponsesBody(history, opts)` / `formatOpenAIResponsesBody(opts)` | `{ model, input, stream }` | Uses Responses `input_text` / `input_image` / `output_text` items and `function_call_output` when an OpenAI call id is present in metadata. Image attachments accept the same URL shapes as `toOpenAIChatCompletionsBody` (`http(s):`, base64 `data:`, or relative paths). Non-image attachments with an uploaded `id` map to `{ type: 'input_file', file_id }` and ones with an uploaded `url` map to `{ type: 'input_file', file_url }`; otherwise they fall back to text notes (base64 file data is not inlined). |
| `toAnthropicMessagesBody(history, opts)` / `formatAnthropicMessagesBody(opts)` | `{ model, max_tokens, system, messages, stream }` | Joins Chorus `system` messages into Anthropic's top-level `system`, maps data-URL images to base64 `image` blocks, maps `application/pdf` data URLs to base64 `document` blocks, and maps `metadata.anthropic.toolUseId` (or `metadata.tool_use_id`) to `tool_result`. Other non-image MIME types still fall back to text notes. When `metadata.anthropic.isError === true` (or top-level `metadata.isError === true`), the emitted `tool_result` block includes `is_error: true` so Claude knows the tool execution failed. The OpenAI and Gemini helpers accept the same `isError` metadata, but their request shapes have no equivalent slot, so the flag is currently Anthropic-only. Built-in tool execution via `autoContinueTools` + a `tools` handler sets this flag automatically when a handler throws. |
| `toGeminiGenerateContentBody(history, opts)` / `formatGeminiGenerateContentBody(opts)` | `{ systemInstruction, contents, ...opts }` | Maps `system` to `systemInstruction`, `assistant` to Gemini `model`, and Chorus tool outputs to `functionResponse` parts when `toolCall.name` is available. Any user attachment with a data URL maps to `inlineData` and any with an uploaded URL/file id maps to `fileData` — both honour the attachment's actual MIME type, so PDFs, audio, and video all pass through. Only attachments lacking both data URL and uploaded URI fall back to text notes. |

All helpers preserve extra provider options you pass (for example `model`, `max_tokens`, `generationConfig`, `tools`) and default OpenAI/Anthropic `stream` to `true`. They insert explicit text fallbacks for unsupported attachments so request mapping failures are visible to the model instead of silently dropping context. Override that text with `unsupportedAttachmentText` when needed.

Keep provider API keys on the server. Browser code may use the `format*Body` helpers to post provider-shaped JSON to your own `/api/chat` proxy, but it should not call OpenAI, Anthropic, or Gemini directly with secret keys.

## Connectors

Connectors tell Chorus how to parse the streaming response from different AI providers. Pass a connector name or object via the `connector` prop on `<Chorus>` or the `connector` option on `useChorusStream`.

### Obtaining a connector

A connector name (`'openai'`, `'anthropic'`, `'gemini'`, `'ai-sdk'`, `'auto'`) is the canonical way to select a built-in connector — pass it as `connector` and Chorus resolves it internally. To customize a built-in connector, pass `connectorOptions` alongside the name (see [Custom reasoning tag pair](#custom-reasoning-tag-pair)).

If you need a connector *object* — to write a custom connector, or to pass one to a hand-rolled `useChorusStream`/`onSend` client — use the two exported accessors:

- **`getConnector(name, options?)`** resolves a built-in connector by name, applying `options` (currently `{ thinkTag }` for `'openai'`). `getConnector()` with no argument returns the auto-detecting connector.
- **`createOpenAIConnector(options?)`** builds a customized OpenAI connector object directly.

The provider connector objects themselves (`openaiConnector`, `anthropicConnector`, etc.) are internal: select them by name instead. See [Migration and Upgrading](#migration-and-upgrading) for the rationale.

### Built-in connectors

| Name | Provider | SSE format |
|------|----------|------------|
| `'openai'` | OpenAI Chat Completions / Responses-compatible streams | selected `choices[0].delta.content`, reasoning fields, `tool_calls`, and common Responses API deltas |
| `'anthropic'` | Anthropic Messages API | `content_block_delta` text/thinking deltas plus `tool_use` / `input_json_delta` |
| `'gemini'` | Google Gemini (AI / Vertex AI) | selected `candidates[0].content.parts[*].text`, thought parts, and `functionCall` parts |
| `'ai-sdk'` | Vercel AI SDK (`toUIMessageStreamResponse` / `toDataStreamResponse`) | `text-delta` / `reasoning-delta` / `tool-input-*` / `tool-output-*` JSON events, plus prefix-coded data-stream frames (`0:"..."`, `g:"..."`, `9:{...}`, `c:{...}`, `a:{...}`, `d:`/`e:` finish, `3:"..."` error) |
| `'auto'` *(default)* | Auto-detect | Tries OpenAI, then Gemini, known Anthropic events, known Vercel AI SDK events (UI-message-stream JSON and data-stream prefix lines), generic JSON text fields (`text`/`content`/`delta`), then raw plain text |

All built-in connectors also recognise in-band stream errors. If a backend has already started a `200` SSE/WebSocket stream, send `data: {"error":"message"}` (or `{"error":{"message":"message"}}`) to abort the response, call `onError` with an `Error`, and show the configured error banner. Unknown JSON events with a `type` field are no longer assumed to be Anthropic; `{ "type": "delta", "text": "hi" }` renders `hi`, and unknown JSON without a text-like field falls back to the raw payload string.

Built-in connectors emit three additive delta types:

- `text` appends to the active assistant bubble.
- `reasoning` appends to `message.reasoning` and renders as a collapsed **Reasoning** details block above the assistant bubble.
- `toolDelta` becomes/updates a `role: 'tool'` message with `message.toolCall`, so the existing `<ToolCallBlock>` renderer shows streaming tool calls automatically in `<Chorus>`. Providers can emit multiple tool calls in one event via `toolDeltas`; the singular `toolDelta` is still populated with the first call for compatibility.

Custom connectors can return the same shape:

```ts
type ConnectorResult = {
  text?: string;
  reasoning?: string;
  toolDelta?: { id: string; name?: string; input?: unknown; output?: unknown; providerId?: string; generated?: boolean };
  toolDeltas?: Array<{ id: string; name?: string; input?: unknown; output?: unknown; providerId?: string; generated?: boolean }>;
  done?: boolean;
  error?: string;
};
```

Connector parser state is per send. Stateless connectors can keep a simple `extract(data)` function; stateful connectors should expose `createState()` and accept that state as the second `extract(data, state)` argument. `useChorusStream` creates a fresh state object for every `send()` call, so concurrent widgets/streams do not share buffers, `<think>` state, or provider tool-id maps.

When providers return multiple alternatives (`choices` / `candidates`), the built-in OpenAI and Gemini connectors select alternative index `0` by default. They do **not** concatenate alternatives into one message. If your app intentionally requests `n > 1` / `candidateCount > 1`, provide a custom `Connector` (or multiple UI messages) that models those alternatives explicitly.

### Usage

```tsx
import { useChorusStream, createFetchSSETransport } from 'react-chorus';

// OpenAI
const { send } = useChorusStream(transport, { connector: 'openai' });

// Anthropic (Claude)
const { send } = useChorusStream(transport, { connector: 'anthropic' });

// Google Gemini
const { send } = useChorusStream(transport, { connector: 'gemini' });

// Vercel AI SDK (toUIMessageStreamResponse / wrapped toDataStreamResponse)
const { send } = useChorusStream(transport, { connector: 'ai-sdk' });

// Auto-detect (default)
const { send } = useChorusStream(transport);
```

## Named SSE events

The SSE spec lets a stream pair a named `event:` line with its `data:` payload. Chorus captures the event name while parsing and routes on it before the connector runs:

```
event: error
data: rate limited

event: heartbeat
data: {}

data: {"choices":[{"index":0,"delta":{"content":"Hello"}}]}
```

- `event: error` — the frame is surfaced as a `ChorusStreamError` (rejecting `send()` and calling `onError`) **even when the `data:` payload is a bare string**, instead of the connector typing `rate limited` into the assistant message. If the payload is JSON, the error message is taken from `{ error }` / `{ error: { message } }` / `{ message }`; otherwise the raw payload text is used.
- `event: heartbeat` and `event: ping` — treated as keepalives and skipped, so a `{}` or empty payload is never rendered as text and no connector dispatch is wasted.
- No `event:` line, or `event: message` (the SSE default) — routed to the connector exactly as before. Provider streams such as Anthropic that name their events (`event: content_block_delta`) are unaffected: those connectors key off the JSON `type` field, not the SSE event name.

A spec-valid `text/event-stream` may also consist entirely of `:` keepalive comments or named `event:` lines with no `data:` field (for example heartbeats before a turn that produced no streamed output). Such a response now resolves cleanly; the "no Server-Sent Events" guard still fires for non-SSE bodies (a JSON or plain-text error body served with the wrong `Content-Type`).

## OpenAI SSE format

The `'openai'` connector reads the selected Chat Completions alternative (`choices[index === 0]`, or the first array entry when indexes are omitted). It maps:

- `choices[0].delta.content` → assistant text. DeepSeek-style `<think>...</think>` spans inside content are split into `reasoning` instead of being rendered in the answer.
- `choices[0].delta.reasoning`, `reasoning_content`, or `reasoning_summary` → assistant `reasoning`.
- `choices[0].delta.tool_calls[*].id/function.name/function.arguments` → one `toolDelta { id, name, input }` per call (and `toolDeltas` when multiple calls arrive in the same chunk). Argument string fragments are accumulated and parsed as JSON when complete before they are written to the tool message.

```
data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search","arguments":"{\"q\":"}}]}}]}

data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"react-chorus\"}"}}]}}]}

data: {"choices":[{"index":0,"delta":{"content":"Done"}}]}

data: [DONE]
```

That tool stream becomes a Chorus message similar to:

```ts
{ role: 'tool', text: '', toolCall: { name: 'search', input: { q: 'react-chorus' } } }
```

For OpenAI Responses API-style streams, common `response.output_text.delta`, `response.reasoning_summary_text.delta`, `response.output_item.added`, and `response.function_call_arguments.delta` events are also recognised.

### Custom reasoning tag pair

The `<think>...</think>` pair is matched case-insensitively by default and tolerates whitespace inside the angle brackets, so DeepSeek-style proxies that emit `<Think>`, `<THINK>`, or `< think >` are split into `reasoning` correctly. To use a different delimiter pair (for example, `<reasoning>...</reasoning>` or `<scratchpad>...</scratchpad>`), pass `connectorOptions` alongside `connector="openai"`. The `<Chorus>` widget forwards it to the connector:

```tsx
<Chorus
  transport="/api/chat"
  connector="openai"
  connectorOptions={{ thinkTag: { start: '<reasoning>', end: '</reasoning>' } }}
/>
```

The same option works on the standalone `useChorusStream` hook:

```ts
const { send } = useChorusStream(transport, {
  connector: 'openai',
  connectorOptions: { thinkTag: { start: '<reasoning>', end: '</reasoning>' } },
});
```

`connectorOptions` only applies to the built-in `'openai'` connector. If you need a connector *object* — for a custom `onSend` client, or to pass as `connector={...}` — build one with `createOpenAIConnector`:

```ts
import { createOpenAIConnector } from 'react-chorus';

const connector = createOpenAIConnector({
  thinkTag: { start: '<reasoning>', end: '</reasoning>' },
});
```

Set `thinkTag.caseInsensitive: false` if you need to match the literal casing only. This option only affects the OpenAI connector; Anthropic and Gemini convey reasoning via structured fields, not embedded tags.

## Anthropic SSE format

The Anthropic Messages API streams server-sent events. The `'anthropic'` connector extracts text and thinking/tool-use deltas from content block events and signals completion on `message_stop`:

```
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"thinking_delta","thinking":"Checking tools"}}

event: content_block_start
data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_1","name":"search","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"q\":\"react-chorus\"}"}}

event: message_stop
data: {"type":"message_stop"}
```

Anthropic `tool_use` maps to a Chorus tool message by `content_block.id` (`toolDelta.id`), `content_block.name` (`toolCall.name`), and accumulated `input_json_delta.partial_json` (`toolCall.input`).

> **Runnable example:** [`examples/with-anthropic`](./examples/with-anthropic) drives the `anthropic` connector from a built-in mock that streams the events above, so it runs with no API key; its README documents the matching Express + `@anthropic-ai/sdk` proxy.

## Gemini SSE format

The Google Gemini streaming API (Google AI and Vertex AI) sends server-sent events where each chunk contains a `candidates` array. The `'gemini'` connector reads only candidate index `0`, collects text from `content.parts[*].text`, maps `thought: true` text/thinking fields to reasoning, maps every `functionCall` part to a tool message, and signals completion for normal `STOP` / `MAX_TOKENS` finish reasons:

```
data: {"candidates":[{"index":0,"content":{"parts":[{"text":"Thinking","thought":true}]}}]}

data: {"candidates":[{"index":0,"content":{"parts":[{"functionCall":{"name":"search","args":{"q":"react-chorus"}}}]}}]}

data: {"candidates":[{"index":0,"content":{"parts":[{"text":"Hello world"}]},"finishReason":"STOP"}],"usageMetadata":{...}}
```

Gemini `functionCall.name` maps to `toolCall.name`, `functionCall.args` maps to `toolCall.input`, and the connector generates a stable tool delta id from the candidate/part index when Gemini does not provide one.

> **Runnable example:** [`examples/with-gemini`](./examples/with-gemini) drives the `gemini` connector from a built-in mock that streams the `candidates` chunks above, so it runs with no API key; its README documents the matching Express + `@google/generative-ai` proxy.

Gemini blocked finish reasons such as `SAFETY`, `RECITATION`, `BLOCKLIST`, or `PROHIBITED_CONTENT` are treated as stream errors instead of silent completion. The `Error` passed to `onError` includes the raw `finishReason` (for example `finishReason: SAFETY`); the default UI still shows the generic `errorMessage`. `MAX_TOKENS` is treated as a completed response and additionally produces a non-fatal connector `warning` (a `ConnectorWarning` with `code: 'truncated'`) plus connector `metadata` carrying `finishReason: 'MAX_TOKENS'`. To react to truncation in app code, observe the warning via the `onStreamWarning` prop and the metadata via the `onStreamMetadata` prop (or `send(..., { onWarning, onMetadata })` when driving `useChorusStream` directly). When you drive the hook directly and omit `onWarning`, the warning is logged once in development so the signal stays discoverable.

Example backend proxy (Express + `@google/generative-ai`):

```js
import { GoogleGenerativeAI } from '@google/generative-ai';
import { toGeminiGenerateContentBody } from 'react-chorus/provider-requests';
import { formatSSEDone, formatSSEError, formatSSEEvent, sseHeaders } from 'react-chorus/server';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); // keep this server-side

app.post('/api/chat', async (req, res) => {
  // Chorus POSTs `{ prompt, history }`. `history` already includes the new
  // user turn — don't also append `req.body.prompt`, or the message goes twice.
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  res.writeHead(200, sseHeaders);
  try {
    const result = await model.generateContentStream(toGeminiGenerateContentBody(history));
    for await (const chunk of result.stream) {
      res.write(formatSSEEvent(chunk));
    }
    // Emit `[DONE]` so the client always sees a terminal frame — a Gemini turn
    // that ends without a STOP/MAX_TOKENS finishReason would otherwise hang.
    res.write(formatSSEDone());
  } catch (err) {
    res.write(formatSSEError(err));
  } finally {
    res.end();
  }
});
```

## Vercel AI SDK stream format

The `'ai-sdk'` connector understands both shapes the Vercel AI SDK can emit:

- **UI message stream** (`result.toUIMessageStreamResponse()`, AI SDK v5+) is already SSE-formatted, so `createFetchSSETransport` and the default `transport="/api/chat"` shortcut work without any extra wiring. Each frame is a JSON object such as `{"type":"text-delta","id":"...","delta":"hi"}` or `{"type":"tool-input-available","toolCallId":"...","toolName":"...","input":{...}}`. The connector maps `text-delta` to assistant text, `reasoning-delta` to reasoning, `tool-input-*` / `tool-input-available` / `tool-output-available` to streaming tool messages, `finish` / `finish-message` to done, and `{"type":"error","errorText":"..."}` to the in-band error path. Lifecycle frames such as `start`, `start-step`, `text-start`, `text-end`, `reasoning-start`, `reasoning-end`, and `finish-step` are silently ignored so the user never sees protocol text.
- **Data-stream protocol** (`result.toDataStreamResponse()`, AI SDK v4) emits prefix-coded lines like `0:"hi"`, `g:"considering"`, `9:{...}`, `c:{...}`, `a:{...}`, `d:{...}`, `e:{...}`, and `3:"error message"`. The pipeline expects each frame to arrive as the value of an SSE `data:` field, so wrap each line as `data: <line>\n\n` when streaming the AI SDK response yourself (one-line server snippet below). Unknown / annotation-only frames (`1`, `2`, `7`, `8`, `f`, `h`, `i`, `j`) are ignored.

### Vercel AI SDK with Next.js App Router (UI message stream — recommended)

```ts
// app/api/chat/route.ts
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
    messages: convertToModelMessages(history.map(m => ({
      id: m.id,
      role: m.role,
      parts: [{ type: 'text', text: m.text ?? '' }],
    }))),
  });

  // toUIMessageStreamResponse returns text/event-stream with `data: {...}\n\n` frames.
  return result.toUIMessageStreamResponse();
}
```

```tsx
// app/page.tsx
'use client';
import { Chorus } from 'react-chorus';

export default function Page() {
  return (
    <main style={{ height: '100dvh' }}>
      <Chorus transport="/api/chat" connector="ai-sdk" />
    </main>
  );
}
```

The default `connector="auto"` also dispatches AI SDK frames correctly; spelling out `connector="ai-sdk"` just makes the intent explicit.

### Vercel AI SDK data-stream protocol (legacy `toDataStreamResponse`)

The AI SDK v4 data stream is plain `text/plain`, not SSE — its lines start with `0:`, `9:`, `e:`, etc. instead of `data:`. Re-emit each line as an SSE frame in your route so it reaches the connector:

```ts
// app/api/chat/route.ts
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

export async function POST(request: Request) {
  const body = (await request.json()) as { history?: Array<{ role: string; text?: string }> };
  const result = streamText({
    model: openai('gpt-4o-mini'),
    messages: (body.history ?? []).map(m => ({ role: m.role as 'user' | 'assistant', content: m.text ?? '' })),
  });

  // AI SDK v4 exposes the data stream through `toDataStreamResponse()`, whose
  // `Response.body` is the `ReadableStream` of newline-delimited prefix lines.
  const upstream = result.toDataStreamResponse().body;
  if (!upstream) return new Response('No stream body', { status: 500 });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffered = '';

  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          let newline = buffered.indexOf('\n');
          while (newline !== -1) {
            const line = buffered.slice(0, newline);
            buffered = buffered.slice(newline + 1);
            if (line) controller.enqueue(encoder.encode(`data: ${line}\n\n`));
            newline = buffered.indexOf('\n');
          }
        }
        if (buffered) controller.enqueue(encoder.encode(`data: ${buffered}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(sse, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
  });
}
```

With either route the client just needs `<Chorus transport="/api/chat" connector="ai-sdk" />`. The connector returns the same `text` / `reasoning` / `toolDelta` / `done` / `error` shape as the other built-in connectors, so retry/stop/edit/regenerate, `<ToolCallBlock>`, and `onError` all work unchanged.

> **Runnable example:** [`examples/with-vercel-ai-sdk`](./examples/with-vercel-ai-sdk) drives the `ai-sdk` connector from a built-in mock that streams UI-message-stream frames, so it runs with no API key; its README documents the matching Next.js App Router route shown above.

## Examples

Runnable examples live in the [`/examples`](./examples) directory. They declare a Node.js 20.19+ or 22.12+ floor — matching what their `vite: ^8` toolchain requires — and consume the local build after `npm run build`. `npm run verify:examples` recursively checks example `package.json` metadata (including nested packages such as `examples/with-openai/server`), build-smokes every example with a `build` script (including the Next.js App Router example), and, for start-only example packages (such as the Express proxy server), syntax-checks the entry file and import-resolves any `react-chorus` subpath exports it uses so a breaking change to `react-chorus/server` or `react-chorus/provider-requests` fails CI. Each example that ships a committed `package-lock.json` is installed with `npm ci`, so a registry-side dependency release cannot silently change what CI builds.

| Example | Description |
|---------|-------------|
| [`examples/basic`](./examples/basic/README.md) | Zero-backend demo using a simulated streaming response, local persistence, clear/reset, and a custom error banner — great for local development |
| [`examples/multi-conversation`](./examples/multi-conversation/README.md) | Sidebar-driven local conversations with pinned chats, per-chat persistence, and first-message auto-titles |
| [`examples/with-next`](./examples/with-next/README.md) | Next.js App Router example with a serverless `/api/chat` SSE route handler proxying to OpenAI |
| [`examples/with-openai`](./examples/with-openai/README.md) | Full-stack example: Vite frontend + Express backend proxying to OpenAI |
| [`examples/with-websocket`](./examples/with-websocket/README.md) | `createWebSocketTransport` + the `anthropic` connector talking to a tiny local `ws` server (canned Claude-style frames; README shows the real Anthropic swap) |
| [`examples/with-anthropic`](./examples/with-anthropic/README.md) | The `anthropic` connector parsing Anthropic Messages SSE — runs with a built-in mock stream, README documents the Express proxy |
| [`examples/with-gemini`](./examples/with-gemini/README.md) | The `gemini` connector parsing Gemini `generateContent` SSE — runs with a built-in mock stream, README documents the Express proxy |
| [`examples/with-vercel-ai-sdk`](./examples/with-vercel-ai-sdk/README.md) | The `ai-sdk` connector parsing a Vercel AI SDK UI-message stream — runs with a built-in mock stream, README documents the Next.js route |

### Running the basic example

```bash
# Build the library first
npm run build

# Install and start
cd examples/basic
npm install
npm run dev
```

### Running the multi-conversation example

```bash
# Build the library first
npm run build

# Install and start
cd examples/multi-conversation
npm install
npm run dev
```

### Running the Next.js App Router example

Build the library first:

```bash
npm run build
```

Install and run the app:

```bash
cd examples/with-next
npm install
```

Set your API key with the command for your shell, then start Next.js:

```bash
# macOS/Linux/POSIX shells
OPENAI_API_KEY=sk-... npm run dev

# Windows PowerShell
$env:OPENAI_API_KEY="sk-..."; npm run dev

# Windows cmd.exe
set OPENAI_API_KEY=sk-... && npm run dev
```

The example uses `app/api/chat/route.ts` with `runtime = 'nodejs'`, SSE headers that discourage buffering, and a 2 MB client-side attachment cap so image data URLs stay below common serverless request limits.

### Running the Vite + Express OpenAI example

Build the library first:

```bash
npm run build
```

Terminal 1 — backend:

```bash
cd examples/with-openai/server
npm install
```

Set your API key with the command for your shell, then start the server:

```bash
# macOS/Linux/POSIX shells
OPENAI_API_KEY=sk-... npm start

# Windows PowerShell
$env:OPENAI_API_KEY="sk-..."; npm start

# Windows cmd.exe
set OPENAI_API_KEY=sk-... && npm start
```

The Express server sets `X-Accel-Buffering: no` so nginx-style reverse proxies do not buffer SSE chunks and make the assistant response appear all at once.

Terminal 2 — frontend (proxies `/api` to `http://localhost:3001`):

```bash
cd examples/with-openai
npm install
npm run dev
```

The Vite examples intentionally allow react-chorus's lazy `highlight.js` code-fence chunk up to the same 950 kB documented budget as the playground. The verification script fails if Vite emits a large-chunk warning above that limit, so example builds stay warning-clean while the lazy Markdown cost remains visible.

### Running the WebSocket, Anthropic, Gemini, and Vercel AI SDK examples

[`examples/with-anthropic`](./examples/with-anthropic), [`examples/with-gemini`](./examples/with-gemini), and [`examples/with-vercel-ai-sdk`](./examples/with-vercel-ai-sdk) are zero-backend Vite apps. Each ships a built-in mock transport that streams provider-shaped frames, so you can see the matching connector (`anthropic`, `gemini`, `ai-sdk`) parse a real stream without an API key. Each example's README documents how to swap the mock for the live proxy described in the sections above.

```bash
npm run build               # build react-chorus from the repository root first
cd examples/with-anthropic  # or with-gemini / with-vercel-ai-sdk
npm install
npm run dev
```

[`examples/with-websocket`](./examples/with-websocket) additionally ships a tiny `ws` server so you can exercise `createWebSocketTransport` end-to-end. Run the server in one terminal and the Vite app in another — see [`examples/with-websocket/README.md`](./examples/with-websocket/README.md) for the two-terminal walkthrough.

## Bundle size

react-chorus keeps React/ReactDOM as peer dependencies and externalizes runtime packages (`dompurify`, `marked`, `marked-highlight`, `lucide-react`, and `highlight.js`) from the published library build. They remain regular `dependencies` so installs work out of the box, while app bundlers can dedupe them and pick up compatible dependency fixes without a react-chorus republish.

`npm run verify:bundle-size` builds tiny consumer bundles from the published entry points with React peers excluded, reports minified/gzip sizes, writes a machine-readable report to `.cache/react-chorus/library-bundle-size-report.json`, and fails CI if budgets are exceeded, external/lazy dependencies move into the wrong graph, root named imports stop tree-shaking, or this README's numbers drift from the report. Root named imports are expected to tree-shake in modern side-effects-aware bundlers; the low-cost transport and provider helper paths are also available as subpaths for server/utility code. Current numbers:

| Entry | Initial JS | gzip | Notes |
|-------|------------|------|-------|
| `react-chorus` (`<Chorus>`) | 221.2 kB | 70.8 kB | Full widget path; includes Markdown parsing/sanitization and icons. |
| `react-chorus/headless` | 221.5 kB | 71.0 kB | Headless defaults, same behavior surface. |
| `react-chorus` (`useChorusStream`) | 67.5 kB | 20.2 kB | Root hook import; CI fails if it pulls UI, Markdown, or icon dependencies. |
| `react-chorus` (`Markdown`) | 76.0 kB | 25.7 kB | Standalone Markdown renderer; includes Markdown parsing/sanitization, not chat icons. |
| `react-chorus` (`ChatWindow`) | 129.7 kB | 43.0 kB | Transcript renderer with Markdown and message action icons, without the composer/widget shell. |
| `react-chorus` (`ConversationList`) | 8.7 kB | 3.0 kB | Conversation sidebar component only; no Markdown/icon graph. |
| `react-chorus/transport` | 6.8 kB | 2.8 kB | Transport factories only; no React/UI/Markdown runtime. |
| `react-chorus/provider-requests` | 11.5 kB | 3.6 kB | Provider request mappers and tool serializers; no React/UI/Markdown runtime. |
| `react-chorus/server` | 0.7 kB | 0.4 kB | SSE framing helpers for proxy routes (headers, encode/format, [DONE], error envelope); no React/UI runtime. |
| Lazy `highlight.js` runtime | 891.4 kB | 295.9 kB | Async code-fence chunk, never part of initial JS. |

`highlight.js` is only fetched the first time a fenced code block (` ``` ` or `~~~`) appears in rendered text. The matching GitHub dark/light token-color stylesheet is also injected on demand based on `codeBlockTheme`; code renders immediately as plain text and is re-rendered with syntax highlighting once the chunk arrives. While an assistant message is actively streaming, Chorus renders that growing message as React-escaped plain text and switches to full Markdown parsing/sanitization when the stream finalizes.

The playground has a separate budget because it intentionally bundles a complete demo app. `npm run build:playground` also runs `npm run verify:playground-size`, writes `.cache/react-chorus/playground-bundle-size-report.json`, and checks this paragraph. The current playground initial JS graph is 444.3 kB / 138.9 kB gzip and its largest lazy chunk (highlight.js) is 890.9 kB / 295.7 kB gzip. Vite's chunk warning limit is raised to that documented lazy budget so the playground build stays free of Vite chunk warnings while the budget script tracks regressions.

To refresh the published size claims after dependency or feature changes, run `npm run build`, `npm run verify:bundle-size`, and `npm run build:playground`, then copy the updated values from stdout or the `.cache/react-chorus/*-bundle-size-report.json` files into this section. The verification commands may fail until the README values are updated to match their reports.

## SSR and Markdown sanitization

`<Markdown>` sanitizes rendered HTML before using `dangerouslySetInnerHTML`. In the browser it uses `dompurify` (or initializes the DOMPurify factory with `window` when needed). During SSR, if no real DOMPurify-compatible sanitizer is available, react-chorus does **not** attempt regex-based HTML sanitization; it switches to a safe no-raw-HTML renderer that drops raw HTML tokens and only emits Markdown-generated links/images with safe URL protocols. Ordinary Markdown (`**bold**`, headings, lists, code, safe `http`/`https` links) renders the same on server and client.

If your SSR app wants to allow sanitized raw HTML, create an isomorphic DOMPurify instance (for example with your framework's DOM/window or jsdom on the server) and pass it to the standalone renderer: `<Markdown sanitizer={purify} />` or `<Markdown sanitizer={(html) => purify.sanitize(html)} />`. The built-in chat renderer accepts the same customization via `<Chorus markdownSanitizer={purify} />` / `<ChatWindow markdownSanitizer={purify} />`, or through `markdownProps={{ sanitizer: purify }}`. You can also pass `markedOptions` and `markedExtensions` directly to `<Markdown>` or via `markdownProps` to adjust parsing and register marked extensions without mutating marked's global singleton.

Code-block copy buttons flash `Copied!` on success and `Copy failed` when the Clipboard API rejects. Pass `<Markdown onCopyError={(error) => ...} />` — or `markdownProps={{ onCopyError }}` on `<Chorus>` / `<ChatWindow>` — to show your own toast or fallback alert.

The copy chrome is a real, keyboard-focusable `<button>`: it activates with Enter/Space, keeps its accessible name (`aria-label`) in sync with the Copy / Copied / Failed state, and announces each transition through a polite `aria-live` status region next to it.

Use `codeBlockCopy` on `<Markdown>` (or `markdownProps={{ codeBlockCopy }}` on `<Chorus>` / `<ChatWindow>`) to control that chrome — its prop type is the exported `CodeBlockCopy` union:

- `'default'` (or `true`, or omitted) keeps the built-in copy button.
- `false` opts out entirely — no copy button is rendered, while the styled `.chorus-codeblock` wrapper stays.
- a function `(ctx) => htmlString` — the exported `CodeBlockCopyRenderer` type — renders your own chrome. `ctx` is a `CodeBlockCopyContext` (`{ theme, labels }`); the returned HTML is inserted ahead of the `<pre>`. Include a `chorus-copy-btn` element to reuse the built-in clipboard wiring, and a `chorus-copy-status` element (ideally `aria-live="polite"`) to receive screen-reader status updates. The returned markup is trusted and inserted without sanitization, so pass a stable function reference.

```tsx
// Opt out of the copy button entirely
<Markdown text={md} codeBlockCopy={false} />

// Render your own chrome (defined once, outside render)
const renderCopy = ({ labels }) =>
  `<button type="button" class="chorus-copy-btn" aria-label="${labels.ariaLabel}">⧉</button>` +
  `<span class="chorus-copy-status" role="status" aria-live="polite"></span>`;
<Markdown text={md} codeBlockCopy={renderCopy} />
```

## Security and CSP

react-chorus is designed to run under a strict Content-Security-Policy. Concretely:

- **No inline scripts.** The library never injects `<script>` tags, never uses `eval` / `new Function`, and DOMPurify is the underlying-API-only build that runs entirely on DOM nodes. `script-src 'self'` (no `'unsafe-inline'`, no `'unsafe-eval'`) is sufficient — DOMPurify does **not** require `'unsafe-eval'`.
- **`highlight.js` is a dynamic `import()`.** It is shipped as a regular script chunk loaded from your own origin (or wherever your bundler emits assets), so `script-src 'self'` already covers it. If you serve bundles from a CDN, add that origin to `script-src`. The chunk is only fetched the first time a fenced code block appears in rendered text — apps that never render fenced code never download it.
- **Sanitized HTML is rendered, not executed.** Markdown is parsed, the resulting HTML is sanitized with DOMPurify (or the SSR no-raw-HTML fallback described above), and only then mounted via `dangerouslySetInnerHTML`. DOMPurify strips `<script>`, `on*` handlers, and unsafe URL protocols; Markdown-emitted `<a>` / `<img>` URLs are restricted to safe protocols.
- **Default styling injects inline styles, so `style-src` needs `'unsafe-inline'` (or a nonce + headless).** The default (non-headless) render path adds two runtime-injected `<style>` elements — `#chorus-md-styles` (Markdown code-block chrome, from `components/Markdown.tsx`) and `#chorus-hljs-theme-<theme>` (highlight.js token colors, from `utils/hljs/theme.ts`) — and a number of inline `style=""` attributes (palette CSS variables on the `<Chorus>` root and `<ChorusTheme>`, and a few layout properties on internal elements). `style-src 'self'` alone blocks all of these. See *Strict CSP without `'unsafe-inline'`* below for nonce and headless escape hatches. DOMPurify also keeps `style` attributes on whitelisted tags by default, so Markdown-rendered output may carry sanitized inline styles; remove them with `<Markdown sanitizer={(html) => purify.sanitize(html, { FORBID_ATTR: ['style'] })} />` if you want to strip user-authored ones.
- **`connect-src` is whatever you POST/upgrade to.** Chorus only talks to the URL you give `transport`, so list your own API origin (and any WebSocket origin) under `connect-src`.

A minimal CSP for an app embedding the default `<Chorus />` against a same-origin `/api/chat` proxy:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self';
worker-src 'self';
frame-ancestors 'none';
base-uri 'self';
object-src 'none';
```

Notes for tightening or relaxing this baseline:

- Add `data:` / `blob:` to `img-src` if you accept image attachments (the composer previews dropped/pasted files as `blob:` URLs, and image data URLs can show up in rendered Markdown).
- Add your provider origin(s) to `connect-src` only if the browser talks directly to a provider; the recommended `react-chorus/server` proxy pattern keeps `connect-src 'self'`.
- Add a WebSocket origin (e.g. `connect-src 'self' wss://api.example.com`) when using `createWebSocketTransport` against a different host.

### Strict CSP without `'unsafe-inline'`

To drop `'unsafe-inline'` from `style-src`, both runtime style surfaces need to be removed or whitelisted:

1. **Allow the two injected `<style>` blocks with a nonce.** Generate a per-response CSP nonce, set it on the page (e.g. `<meta property="csp-nonce" content="...">` plus `style-src 'self' 'nonce-XYZ'`), and call `setChorusStyleNonce(nonce)` once during app startup before any `<Markdown>` / `<Chorus>` renders or highlight.js theme loads. The nonce is applied to the `chorus-md-styles` and `chorus-hljs-theme-*` `<style>` tags as they are created. (`setChorusStyleNonce` also reads a global `__chorusStyleNonce` if you prefer to set it from an inline bootstrap script.) Nonces are *not* honored on inline `style=""` attributes by browsers — see step 2.
2. **Avoid inline `style=""` attributes.** `style-src-attr` (CSP3) blocks element-level inline styles even when a nonce is provided. The default `<Chorus>` root and `<ChorusTheme>` apply palette CSS variables through React's `style` prop, and several built-in widgets set narrow layout properties the same way. Use the `react-chorus/headless` entry (no default `<style>` injection and no built-in code-block chrome), omit `palette` (define `--chorus-*` variables in your own stylesheet instead), and supply your own CSS for the components you mount. If you cannot avoid attribute styles, allow them explicitly with `style-src-attr 'unsafe-inline'` while keeping `style-src 'self' 'nonce-XYZ'` for `<style>` elements.

A strict-CSP example built around nonce + headless looks like:

```
default-src 'self';
script-src 'self';
style-src 'self' 'nonce-XYZ';
style-src-attr 'none';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self';
worker-src 'self';
frame-ancestors 'none';
base-uri 'self';
object-src 'none';
```

Paired with `import { Chorus, setChorusStyleNonce } from 'react-chorus/headless'; setChorusStyleNonce('XYZ');` and an app-owned stylesheet that defines the `--chorus-*` palette variables.

## API

### `<Chorus>`

`ChorusProps` is generic: `ChorusProps<TMeta = Record<string, unknown>>`. Use `<Chorus<MyMeta> ... />` when your `Message.metadata` has a structured shape; `value`, `onChange`, `onSend`, `transport`, and `renderMessage` will all preserve `Message<MyMeta>`.

Message source modes are mutually exclusive:

- Controlled: pass `value` + `onChange` and keep the canonical message list in your state.
- Uncontrolled with a seed: pass `initialMessages` (or legacy `messages`) and let Chorus manage subsequent updates internally.
- Uncontrolled with persistence: pass `persistenceKey` without `value`; passing both makes `value` win, so built-in persistence is bypassed without reading the ignored key.

`initialMessages` (and legacy `messages`) follow a **frozen-seed contract**: the seed is captured once at mount and never re-derived. If a parent rebuilds the seed array after mount — for example regenerating welcome messages on a locale, theme, or persona change — the new array is silently ignored: the transcript does not re-seed, and `resetToInitialMessages` still restores the mount-time value. In development Chorus logs a one-time warning when the reference changes. To swap the transcript at runtime, use controlled mode (`value` + `onChange`), call `ChorusRef.clear()`, or force a fresh mount with `key={...}`.

When `persistenceKey` is combined with `initialMessages` (or legacy `messages`), stored history is checked first. If the key has no stored value, Chorus renders and saves the seed so welcome messages still appear with persistence enabled. If the key already exists, the stored value wins. Promise-based storage adapters keep the built-in composer and write actions disabled while the initial read is pending; the seed/empty-state prompts stay hidden until the read resolves so a pre-load Send cannot overwrite an existing transcript.

Persistence writes are debounced while assistant tokens stream, flushed when a message finalizes and on explicit edits/deletes/clears, and serialized for async adapters so older saves cannot overwrite newer transcripts. Pending debounced writes are also flushed on `pagehide` and `visibilitychange` → `hidden`; synchronous adapters such as `localStorage` can complete that final write during tab close, while Promise-based adapters cannot block navigation. If you wire `useChorusPersistence()` into your own controlled state, gate your custom composer on `persist.loaded` (or intentionally queue your own edits) before calling `persist.onChange`. For remote/IndexedDB persistence, prefer a synchronous localStorage fallback plus an async backup when data loss on close is unacceptable.

Built-in persistence uses `JSON.stringify` / `JSON.parse` by default. Message data must be JSON-serializable: Dates are restored as strings, classes are not revived, and values such as `BigInt` fail serialization and surface through `onPersistenceError` / `useChorusPersistence().error`. Read, deserialization, write, and remove failures are reported with `error.key` and `error.operation` (`'read' | 'deserialize' | 'write' | 'remove'`) while Chorus keeps rendering a safe empty fallback when needed. Pass `serializeMessages` and/or `deserializeMessages` to customize validation, compression, or Date revival.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `transport` | `string \| FetchTransportInit<TMeta> \| Transport<TMeta>` | — | Simple path: a URL to POST to, a `{ url, headers, credentials, method, … }` config object (`FetchTransportInit`), or a custom Transport function. Chorus handles all streaming. |
| `systemPrompt` | `string` | — | Hidden instruction for both send paths. With `transport`, Chorus prepends it as a `system` message in request history. With `onSend`, read it from `helpers.systemPrompt`; `messages` is left unchanged to avoid duplicates. |
| `connector` | `Connector \| 'auto' \| 'openai' \| 'anthropic' \| 'gemini' \| 'ai-sdk'` | `'auto'` | SSE connector used to parse the stream. `'auto'` detects OpenAI, Anthropic, Gemini, and Vercel AI SDK frames; pass an explicit name when the format is known. |
| `connectorOptions` | `OpenAIConnectorOptions` | — | Options forwarded to the built-in connector resolved from a `connector` string. Currently only the `'openai'` connector consumes options (e.g. `{ thinkTag }` for a custom reasoning tag pair). Ignored for other names and for custom `Connector` objects — build those with `createOpenAIConnector(options)`. |
| `onSend` | `(text, messages, helpers) => Message<TMeta> \| void \| Promise<Message<TMeta> \| void>` | — | Advanced path: called when the user submits a message. Use `helpers.appendAssistant`/`helpers.finalizeAssistant` to stream tokens, or return a complete assistant `Message` for non-streaming replies. |
| `value` | `Message<TMeta>[]` | — | Controlled message list. Pair with `onChange`; Chorus renders this array as the source of truth. |
| `onChange` | `(messages: Message<TMeta>[]) => void` | — | Called whenever Chorus wants to change the message list in controlled mode (`value` is provided). Not called for legacy `messages`-only uncontrolled state. |
| `onMessagesChange` | `(messages, context) => void` | — | Read-only transcript observer for controlled, uncontrolled, and persistence-backed modes. Fires for initial/loaded messages, sends, stream chunks, returned messages, edits, deletes, retry/regenerate truncation, and clear without making Chorus controlled. `context.source` is `'controlled'`, `'uncontrolled'`, or `'persistence'`. |
| `messages` | `Message<TMeta>[]` | — | Legacy initial-only seed for uncontrolled mode. Read once on mount; later prop changes are ignored (dev warns once on a reference change). Prefer `initialMessages` for seeding or `value` + `onChange` for controlled mode. |
| `initialMessages` | `Message<TMeta>[]` | — | Initial-only seed for uncontrolled mode, captured once at mount (frozen-seed contract — later reference changes are ignored and dev-warned once). Useful for welcome messages; `system` messages are hidden by default via `hiddenRoles`. Tool calls remain visible by default. |
| `emptyState` | `ReactNode` | — | Custom content shown in the transcript when the visible message list is empty and the assistant is not typing. |
| `suggestedPrompts` | `string[]` | — | Default empty-state prompt buttons. Clicking one fills and focuses the composer without sending. Ignored when `emptyState` is provided. |
| `placeholder` | `string` | `"Send a message"` | Input placeholder text. |
| `disabled` | `boolean` | `false` | Disables composer text input, attach/paste/drop ingestion, Send, suggested-prompt fills, retry/clear, and message write actions. If an assistant response is active, Stop remains available so work is not stranded. |
| `readOnly` | `boolean` | `false` | Keeps transcript read actions such as copy and scrolling available, but prevents compose, attachments, send, edit, regenerate, delete, retry, clear, feedback, and suggested-prompt fills. |
| `disabledReason` | `string` | — | Explanation shown through the composer placeholder/title and accessible description while `disabled` or `readOnly` is active (for example “Select a conversation first”). |
| `alwaysShowMessageActions` | `boolean` | `false` | Always render the per-message action buttons (edit/regenerate/copy/feedback/delete) instead of revealing them on hover. Coarse-pointer / `@media (hover: none)` devices get the same always-visible behavior automatically so touch users can discover and tap actions; this prop opts pointer devices in too. |
| `accept` | `string` | — | Enables attachments and is forwarded to the file-picker `<input accept>`. Paste/drop validation uses the same MIME/extension rules. Omitting the prop hides the attach button and disables paste/drop attachments. |
| `maxAttachmentBytes` | `number` | — | Reject files larger than this byte limit before reading/uploading them. |
| `maxAttachments` | `number` | — | Maximum attachments queued in the composer at once. Extra files trigger `onAttachmentError`. |
| `maxRenderedMessages` | `number` | — | Performance escape hatch: render only the latest N visible messages while keeping typing/error rows, auto-scroll, and actions wired to original message IDs. |
| `onAttachmentError` | `(error: AttachmentError) => void` | — | Called when a picker, paste, or drop file is rejected or cannot be read/uploaded. Reasons include `unsupported-type`, `too-large`, `too-many`, `read-failed`, and `upload-failed`. |
| `uploadAttachment` | `(file: File, options?: { signal: AbortSignal }) => AttachmentUploadResult \| Promise<AttachmentUploadResult>` | data URL reader | Optional transform/upload hook. Return a custom attachment (for example a CDN URL or provider file id) instead of the default data URL payload. The signal aborts when pending work is cancelled. |
| `sending` | `boolean` | — | Visual sending-state override for fully custom `onSend`/`useChorusStream` integrations. On the `transport` path, Chorus still owns the internal concurrency guard even if this is overridden. |
| `palette` | `Palette` | dark theme | Custom color palette for theming chat chrome, actions, errors, and built-in tool call blocks. |
| `codeBlockTheme` | `'dark' \| 'light'` | `'dark'` | Code block syntax-highlight theme. |
| `minAssistantDelayMs` | `number` | `300` | Minimum ms before showing the first assistant token. |
| `errorMessage` | `string` | `'Something went wrong. Please try again.'` | Friendly message shown in the error banner. Raw transport errors are never surfaced in the default UI. |
| `onError` | `(error: Error) => void` | — | Called for any non-abort error from a send or stream. The raw `Error` goes here; the UI shows `errorMessage`. |
| `onAbort` | `({ message, messages, reason, source, path }) => void` | — | Called when an active assistant generation is cancelled by Stop, `ref.stop()`, clear-while-sending, or a superseding session. `message` is the finalized partial assistant message or `null` before the first token; `path` is `'transport'` or `'onSend'`; `reason` is `'stop'`, `'clear'`, or `'superseded'`; `source` is `'user'` for built-in UI actions and `'programmatic'` for imperative/internal cancellation. |
| `renderError` | `({ error, rawError, retry, dismiss }) => ReactNode` | — | Replace the built-in error banner. `error` is the friendly UI string, `rawError` is the last raw `Error` when available, `retry()` resubmits the last turn, and `dismiss()` clears the banner. |
| `onChunk` | `(chunk: string, messageId: string) => void` | — | Observation hook called for each streamed token. Receives the assistant `messageId` so callers can correlate chunks with a specific message. Does **not** affect streaming behaviour. |
| `onToolDelta` | `({ delta, message, messages }) => void` | — | Observation hook called for every accumulated streamed tool-call delta on the `transport` path. Does **not** affect execution. Transport-path only — never fires on the `onSend` path (a dev warning flags this). |
| `onToolCall` | `({ id, name, input, output, message, messages, signal }) => unknown \| Promise<unknown>` | — | Called after stream input completes for each streamed tool call. If no matching `tools[name]` handler exists, a non-`undefined` return value is appended as `toolCall.output`. Transport-path only — never fires on the `onSend` path, where you execute tools yourself (a dev warning flags this). |
| `tools` | `Record<string, (input, context) => unknown \| Promise<unknown>>` | — | Executable tool registry keyed by tool name. Matching handlers run after the stream completes; their return value is appended to the tool message as output. Transport-path only — registered handlers never run on the `onSend` path, where you execute tools yourself (a dev warning flags this). |
| `autoContinueTools` | `boolean` | `false` | Opt in to an automatic tool-execution → model-continuation loop on the `transport` path after all completed tool calls have outputs. |
| `maxToolIterations` | `number` | `4` | Maximum automatic tool iterations when `autoContinueTools` is enabled. Prevents infinite loops. |
| `continueOnToolError` | `boolean` | `false` | Treat a thrown tool handler (or `onToolCall`) error as a normal tool result instead of a terminal turn failure. The error is recorded on the tool row (`{ error: message }` output plus `metadata.isError`); with `autoContinueTools` enabled the loop continues, feeding the error tool result back to the model so it can self-recover. Abort errors (Stop) always end the turn. Transport-path only — has no effect on the `onSend` path, where you execute tools yourself (a dev warning flags this). |
| `shouldContinueToolLoop` | `(context) => boolean \| Promise<boolean>` | — | Optional gate before each automatic continuation. Return `false` to stop after rendering/executing the current tool batch. |
| `onStreamDone` | `({ assistantMessage, toolMessages, messages, response, reason, willContinue, iteration, maxToolIterations }) => void` | — | Called after each `transport` stream completes normally and tool handlers (if any) finish. Fires for tool-only turns where `onFinish` has no assistant message. `reason` is `'completed'`, `'tool-loop-continue'`, `'tool-loop-veto'`, or `'max-tool-iterations'` — use it to detect when `autoContinueTools` stops because the safety cap was reached. |
| `onStreamWarning` | `(warning: ConnectorWarning) => void` | — | Observation hook for non-fatal connector warnings on the `transport` path (`{ code, message, payload? }`) — e.g. a `truncated` warning when the model hit its max-token limit, or safety-rating notices. The stream still completes normally (`onFinish`/`onStreamDone` fire as usual); use it to tell the user the response may be cut off or partially blocked. A throwing handler is warned in development and otherwise ignored. |
| `onStreamMetadata` | `(metadata: Record<string, unknown>) => void` | — | Observation hook for free-form provider metadata on the `transport` path as connectors emit it — OpenAI Responses token `usage`, Anthropic `stopReason`/`stopSequence`, Gemini `safetyRatings`/`finishReason`, OpenAI Chat `finishReason`. Fires once per connector result that carries metadata, so it may be called several times per turn; the stream still completes normally. Wire it for usage/cost telemetry (e.g. a live budget meter) or to persist safety ratings. A throwing handler is warned in development and otherwise ignored. |
| `onCopy` | `(message: Message<TMeta>) => MessageCopyResult` | Clipboard copy when available | Overrides the built-in per-message Copy action. Return `false` (or `Promise<false>`) to show the "Copy failed" indicator; return `void` to keep the assume-success behavior. If omitted, Chorus copies `message.text` with `navigator.clipboard.writeText` when the Clipboard API is available. |
| `getMessageFeedback` | `(message: Message<TMeta>) => 'up' \| 'down' \| null \| undefined` | `message.metadata.feedback` | Seeds the pressed thumb state from persisted feedback. Return `null` for no selection; return `undefined` to fall back to `message.metadata.feedback` when it is `'up'` or `'down'`. |
| `onFeedback` | `(message: Message<TMeta>, feedback: 'up' \| 'down' \| null) => void` | — | Enables built-in thumbs-up / thumbs-down per-message feedback actions and reports changes. Clicking the already-selected thumb toggles the rating off and reports `null` so a mis-click can be undone. |
| `confirmDeleteMessage` | `({ message, messages }) => boolean \| void \| Promise<boolean \| void>` | — | Optional gate for built-in message delete actions. Return or resolve `false` to cancel; persistence is flushed only after deletion is confirmed. |
| `onFinish` | `({ message, messages, reason, response }) => void` | — | Called once when an assistant message completes normally. Use it for telemetry, persistence handoff, moderation, or post-response UI. Not called for tool-only turns, aborts, Stop, or errors; use `onAbort` for cancellation telemetry and `onStreamDone`/`onToolCall` for tool-only streams. |
| `persistenceKey` | `string` | — | Uncontrolled-mode persistence key. When set without `value`, Chorus saves/restores messages using this key (defaults to localStorage). If `value` is provided, controlled state wins and built-in persistence is not used. |
| `persistenceStorage` | `StorageAdapter` | `localStorage` | Custom storage adapter for persistenceKey. The default `localStorage` is resolved lazily; if browser storage is blocked or unavailable, Chorus keeps working without persistence. Implement optional `removeItem(key)` to delete unseeded empty transcripts and deleted conversation keys; seeded clears persist `[]` so the clear survives reloads. |
| `onPersistenceError` | `(error: Error & { key?: string; operation?: string }) => void` | — | Called when a persistence read, deserialization, write, or remove operation throws/rejects. The hook also exposes the latest error as `useChorusPersistence().error`. |
| `serializeMessages` | `(messages: Message<TMeta>[]) => string` | `JSON.stringify` | Optional persistence serializer. Use it for custom formats or to reject unsupported data explicitly. |
| `deserializeMessages` | `(raw: string) => Message<TMeta>[]` | JSON parse + array guard | Optional persistence deserializer/reviver. Use it to validate stored payloads or revive Dates/classes. |
| `showClearButton` | `boolean` | `false` | Shows a built-in clear/reset conversation button above the input. |
| `clearLabel` | `string` | `'Clear conversation'` | Label for the built-in clear/reset button. |
| `confirmClearConversation` | `({ messages, resetToInitialMessages, source, persistenceKey? }) => boolean \| void \| Promise<boolean \| void>` | — | Optional gate for the built-in clear/reset action. Return or resolve `false` to cancel before persistence is flushed. While an async confirmation is pending the clear button is disabled and duplicate clears (button or `ref.clear()`) are ignored. |
| `onClear` | `(messages: Message<TMeta>[]) => void` | — | Called with the reset message list after the built-in clear action runs. |
| `resetToInitialMessages` | `boolean` | `false` | When clearing, restore the initial `messages`/`initialMessages` seed instead of saving an empty transcript. Restores the mount-time seed (frozen-seed contract) even if the seed prop was swapped after mount. |
| `showJumpToBottomButton` | `boolean` | `!headless` | Shows the floating “Jump to latest” button when the user scrolls away from the bottom and new activity arrives. Pass `false` to disable it (for example when you own the scroll affordance); the headless exports default `headless={true}` so the button is off by default there. |
| `showTimestamps` | `boolean` | `false` | Render a locale-aware per-message time under each bubble, sourced from `Message.createdAt`. Messages without a `createdAt` render no time. No custom `renderMessage` is needed. |
| `formatTimestamp` | `(timestamp: string, message: Message<TMeta>) => ReactNode` | short locale-aware time | Overrides the built-in timestamp formatting used when `showTimestamps` is enabled. Receives the message's `createdAt` string and the message; return any node (for example a relative time, or date + time). |
| `headless` | `boolean` | `false` | Strip all default styles and inline style injection. |
| `renderMessage` | `(message: Message<TMeta>, ctx: RenderMessageContext<TMeta>) => ReactNode` | — | Custom per-message renderer. Return `null` to fall back to default rendering. `ctx` includes `isStreaming`, `isEditing` (true while the built-in inline editor is active — gate your own content on it so the editor replaces the row), `messageProps` for scroll targets, `defaultRender(slots?)`, and action callbacks/default action controls. Existing one-argument renderers continue to work. |
| `markdownProps` | `Omit<MarkdownProps, 'text' \| 'codeTheme' \| 'headless' \| 'streaming'>` | — | Props forwarded to the built-in Markdown renderer for every message, including `sanitizer`, `markedOptions`, `markedExtensions`, `onCopyError`, and `codeBlockCopy`. |
| `markdownSanitizer` | `MarkdownSanitizer` | — | Convenience alias for `markdownProps.sanitizer`; takes precedence when both are provided. |
| `hiddenRoles` | `Role[]` | `['system']` | Message roles hidden from the transcript. Tool calls are visible by default in `<Chorus>`; pass `['system', 'tool']` to hide them, or `[]` to show all roles. `<Chorus>` accepts `hiddenRoles` only — `showSystemMessages` exists on `<ChatWindow>` for backwards compatibility. |
| `labels` | `ChorusLabels` | English defaults | Localized strings for every built-in UI surface: composer placeholder/aria-labels/attach/drop-to-attach/send/stop, transcript aria-label/typing/retry/dismiss-error/jump-to-latest/empty-state title, message actions (edit/regenerate/copy/copy-failed/thumbs up/down/delete/save/cancel), per-role speaker SR labels, tool-call section headers, reasoning summary, code-fence copy chrome, conversation-list affordances, and the clear button. See [Localizing built-in strings](#localizing-built-in-strings). |

### Localizing built-in strings

Every built-in label defaults to English; pass `labels` to localize or rebrand without replacing components. The same `ChorusLabels` shape is accepted by `<Chorus>` and `<ChatWindow>`; the relevant slice is accepted by `<ChatInput labels={…}>`, `<ConversationList labels={…}>`, `<ToolCallBlock labels={…}>`, and the standalone `<Markdown codeCopyLabels={…} />`. Existing label-shaped props (`placeholder`, `clearLabel`, `newConversationLabel`, `emptyLabel`, `disabledReason`, `errorMessage`) keep precedence so adding `labels` is non-breaking.

```tsx
import { Chorus, type ChorusLabels } from 'react-chorus';

const fr: ChorusLabels = {
  composer: {
    placeholder: 'Écrivez un message',
    ariaLabel: 'Champ de message',
    attachFile: 'Joindre un fichier',
    dropToAttach: 'Déposer pour joindre',
    send: 'Envoyer',
    stop: 'Arrêter',
    disabledReason: 'Composer désactivé.',
    readOnlyReason: 'Composer en lecture seule.',
  },
  transcript: {
    ariaLabel: 'Historique de chat',
    typing: "L'assistant écrit",
    retry: 'Réessayer',
    dismissError: "Masquer l'erreur",
    jumpToLatest: '↓ Aller au plus récent',
    suggestedPromptsAriaLabel: 'Suggestions',
    emptyStateTitle: 'Comment puis-je aider ?',
  },
  messageActions: {
    edit: 'Modifier',
    regenerate: 'Régénérer',
    copy: 'Copier',
    copyFailed: 'Échec de la copie',
    thumbsUp: "J'aime",
    thumbsDown: "Je n'aime pas",
    delete: 'Supprimer',
    save: 'Enregistrer',
    cancel: 'Annuler',
    editTextareaAriaLabel: 'Modifier le message',
  },
  speakers: {
    user: 'Message utilisateur',
    assistant: "Message de l'assistant",
    system: 'Message système',
    tool: 'Message outil',
  },
  toolCall: { input: 'Entrée', output: 'Sortie', running: 'En cours…', empty: 'Aucune sortie' },
  reasoning: 'Raisonnement',
  codeCopy: { copy: 'Copier', copied: 'Copié !', failed: 'Échec', ariaLabel: 'Copier le code' },
  conversationList: {
    newConversation: 'Nouvelle conversation',
    empty: 'Aucune conversation',
    pin: 'Épingler',
    unpin: 'Désépingler',
    rename: 'Renommer',
    delete: 'Supprimer',
    save: 'Enregistrer',
    cancel: 'Annuler',
    navAriaLabel: 'Conversations',
    renameAriaLabel: title => `Renommer ${title}`,
    pinAriaLabel: (title, pinned) => `${pinned ? 'Désépingler' : 'Épingler'} ${title}`,
    deleteAriaLabel: title => `Supprimer ${title}`,
  },
  attachments: {
    readingStatus: name => `Lecture de ${name}`,
    uploadingStatus: name => `Envoi de ${name}`,
    completedAnnouncement: name => `${name} prêt`,
    failedAnnouncement: name => `Échec : ${name}`,
    removeAttachment: name => `Retirer ${name}`,
    dismissError: "Fermer l'erreur",
    describeImage: 'Décrire cette image',
    describeImageInputAriaLabel: name => `Description de ${name}`,
    describeImagePlaceholder: 'Décrivez cette image',
    imageFallbackAlt: name => `Image jointe : ${name}`,
    unsupportedTypeError: ({ name, accept }) =>
      `${name} n'est pas accepté${accept ? ` (${accept})` : ''}.`,
    tooLargeError: ({ name, size, limit }) => `${name} (${size}) dépasse la limite ${limit}.`,
    tooManyError: ({ name, max }) => `Limite ${max} pour ${name}.`,
    readFailedError: ({ name, detail }) => `Lecture impossible de ${name} : ${detail}`,
    uploadFailedError: ({ name, detail }) => `Envoi impossible de ${name} : ${detail}`,
  },
  clearConversation: 'Effacer la conversation',
};

<Chorus transport="/api/chat" labels={fr} />;
```

Labels are deep-merged with the defaults, so you only need to override the strings you actually want to change. **Partial overrides only:** `undefined`, `null`, and empty-string values fall back to the English default so a loose i18n catalog cannot accidentally erase a UI label. Pass a non-empty whitespace string (e.g. `' '`) when you genuinely want a visually empty value. `resolveChorusLabels(partial)` is exported when you want to compute the resolved set yourself (for storybook fixtures, `<ChatWindow>` outside of `<Chorus>`, or fully custom shells).

The `attachments` slice localizes the attachment composer end-to-end: chip remove-button labels, the pending read/upload polite-live status text and `aria-busy` chips, the polite-live completion announcements that confirm "attached" / "failed" after a pending chip resolves, the dismiss-error button, the "describe this image" affordance (visible next to image chips so users can supply alt text before sending), validation/read/upload error messages with `{name, accept, size, limit, max, detail}` interpolation, and the role-hinted image fallback alt rendered in the transcript when `Attachment.alt` is absent. The English defaults for just this slice are exported as `DEFAULT_ATTACHMENT_LABELS` (a `ChorusAttachmentLabels`), handy when you want to extend the attachment strings rather than replace them.

### `helpers` (passed to `onSend`)

| Helper | Description |
|--------|-------------|
| `appendAssistant(chunk)` | Append a text chunk to the current assistant message. Chunks are buffered until `minAssistantDelayMs` has elapsed before the first token is shown. |
| `appendReasoning(chunk)` | Append a reasoning/thinking chunk to the current assistant message. |
| `appendToolDelta(delta)` | Create/update a `role: 'tool'` row from an accumulated connector tool delta. **Presentation only** — it does not execute registered `tools` handlers, fire `onToolCall`/`onToolDelta`, or drive the auto-continue loop, so `toolCall.output` stays unset. On the `onSend` path you run the tool yourself, then call `appendToolDelta` again with the same `delta.id` and an `output` to fill the row and `appendAssistant` for the follow-up turn. |
| `streamCallbacks()` | Convenience helper returning `{ onChunk, onReasoning, onToolDelta, onWarning, onMetadata, onDone }` for `useChorusStream(...).send()`. `onWarning` forwards non-fatal connector warnings to the `<Chorus onStreamWarning>` prop and `onMetadata` forwards free-form provider metadata to the `<Chorus onStreamMetadata>` prop. It is present at runtime; optional chaining keeps older hand-written helper mocks type-compatible. |
| `finalizeAssistant()` | Mark the assistant message complete. If first-token chunks are still buffered, completion waits until they flush. |
| `signal` | `AbortSignal` — aborted when Stop, clear-while-sending, or a superseding session cancels the active send. |
| `systemPrompt` | The optional `systemPrompt` prop. Use it when serializing custom `onSend` requests; Chorus does not insert it into the `messages` argument on this path. |

Call `finalizeAssistant()` when your custom stream is done. In development, Chorus warns if `onSend` appended chunks and then resolved without finalizing; it will still flush those chunks and reset the sending state so the UI cannot get stuck in Stop mode.

### Keyboard shortcuts

- Composer textarea: **Enter** sends, **Shift+Enter** inserts a newline.
- Inline edit textarea: **Enter** saves, **Shift+Enter** inserts a newline, and **Escape** cancels editing. Enter is ignored while an IME candidate is being composed, and Escape stops propagating so cancelling an edit inside a modal/drawer does not also close the ancestor.

### Imperative `ChorusRef`

Use a ref for suggested prompts, global focus shortcuts, external clear buttons, or scrolling to a known message:

```tsx
import React from 'react';
import { Chorus, type ChorusRef } from 'react-chorus';

export function SupportChat() {
  const chorusRef = React.useRef<ChorusRef>(null);
  const suggestions = ['Summarize my account', 'Explain my last invoice'];
  const exportTranscript = () => {
    const blob = new Blob([JSON.stringify(chorusRef.current?.getMessages() ?? [], null, 2)], {
      type: 'application/json',
    });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  return (
    <>
      {suggestions.map((text) => (
        <button key={text} type="button" onClick={() => chorusRef.current?.send(text)}>
          {text}
        </button>
      ))}
      <button type="button" onClick={() => chorusRef.current?.focus()}>Focus chat</button>
      <button type="button" onClick={exportTranscript}>
        Export transcript
      </button>
      <Chorus ref={chorusRef} transport="/api/chat" />
    </>
  );
}
```

The ref exposes `send(text, attachments?)`, `stop()`, `clear()`, `retry()`, `regenerate(messageId)`, `dismissError()`, `focus()`, `getMessages()`, and `scrollToMessage(id)`.

```ts
interface ChorusRef<TMeta = Record<string, unknown>> {
  send(text: string, attachments?: Attachment[]): boolean;
  stop(): void;
  clear(): boolean;
  retry(): boolean;
  regenerate(messageId: string): boolean;
  dismissError(): boolean;
  focus(): void;
  getMessages(): Message<TMeta>[];
  scrollToMessage(id: string): boolean;
}
```

`send()` returns `true` when Chorus accepted the message and started a turn, and `false` when the send was rejected — nothing was appended to the transcript and no transport/onSend call was made. Rejection cases:

- `<Chorus disabled>`, `<Chorus readOnly>`, or an async built-in persistence load is pending.
- Controlled mode (`value` provided) with no `onChange` prop, so the new message could not be reflected.
- A send or tool-loop turn is already in flight.
- The text is empty and no attachments were supplied.
- Neither `transport` nor `onSend` is configured.

`clear()` returns `true` when the clear path was kicked off and `false` when rejected. Rejection cases:

- `<Chorus disabled>`, `<Chorus readOnly>`, or an async built-in persistence load is pending.
- A previous `confirmClearConversation` promise is still pending.
- Controlled mode (`value` provided) with no `onChange` prop.

When `confirmClearConversation` is configured, `true` means the confirmation flow was started — the actual reset still depends on the callback resolving to anything other than `false`.

On an accepted send, `send()` also resets the composer the same way a UI-driven send does — the draft text is cleared, the textarea collapses to a single line, and any attachment chips the user had staged are discarded. (`send()` sends its own explicit `attachments` argument; staged chips are never sent by an imperative call.) An accepted `clear()` resets the composer the same way.

`retry()`, `regenerate(messageId)`, and `dismissError()` are the imperative equivalents of the built-in error-banner Retry / message-toolbar Regenerate / banner-dismiss controls, so a fully custom chat shell can drive them without simulating clicks on chrome it has hidden:

- `retry()` re-runs the last assistant turn after a stream error. It returns `false` when there is no current error to retry.
- `regenerate(messageId)` regenerates a specific assistant message, replaying from the user turn that preceded it. It returns `false` when `messageId` does not match a message or no user message precedes it.
- `dismissError()` clears the current stream error state. It returns `false` when there is no error to dismiss.

All three also return `false` for the shared rejection cases — `<Chorus disabled>`, `<Chorus readOnly>`, an async built-in persistence load still pending, or controlled mode (`value` provided) with no `onChange` prop.

`scrollToMessage(id)` returns `true` when it finds a rendered message row and `false` when the id is not currently mounted; check `hiddenRoles`, `maxRenderedMessages`, and custom `renderMessage` implementations that return a fragment/custom component without spreading `ctx.messageProps`. `stop()` always remains available for active responses.

### Disabled and read-only states

Use `disabled` when the user cannot currently compose (for example no active conversation or a missing API key), and `readOnly` when the transcript should remain browsable but immutable (for example an archived conversation):

```tsx
<Chorus
  transport={apiKey ? '/api/chat' : undefined}
  disabled={!activeConversationId || !apiKey}
  disabledReason={!activeConversationId ? 'Select a conversation first' : !apiKey ? 'Add an API key to chat' : undefined}
/>

<Chorus
  transport="/api/chat"
  readOnly={conversation.archived}
  disabledReason={conversation.archived ? 'This conversation is archived' : undefined}
/>
```

Disabled and read-only modes block Enter/click sends, file picker/paste/drop attachment work, suggested-prompt fills, retry/clear, and write message actions (edit/regenerate/delete/feedback). Copying messages, scrolling, and the Stop button for an active response remain available.

### Clearing/resetting a conversation

Use the built-in clear button for uncontrolled or persisted chats:

```tsx
<Chorus
  persistenceKey="support-chat"
  initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Hi! How can I help?' }]}
  showClearButton
  onPersistenceError={(err) => reportError(err)}
/>
```

By default, clearing writes an empty conversation. If the chat was seeded with `initialMessages`/legacy `messages`, Chorus persists `[]` even when the adapter supports `removeItem`; that explicit empty transcript prevents welcome messages from resurrecting on reload. If there is no seed, a `removeItem`-capable adapter may delete the key, while adapters without `removeItem` fall back to saving `[]`. Pass `resetToInitialMessages` to restore and persist the seed welcome messages instead. In controlled mode, the same button calls `onChange(resetMessages)` and `onClear(resetMessages)`; keep the canonical list in your state as usual.

Wire `confirmClearConversation` to gate the destructive action — the callback receives `{ messages, resetToInitialMessages, source, persistenceKey? }` and persistence is flushed only after it returns/resolves anything except `false`. While an async confirmation is pending, the clear button is disabled and duplicate clicks (or `ref.clear()` calls) are ignored.

```tsx
<Chorus
  persistenceKey="support-chat"
  showClearButton
  confirmClearConversation={async ({ messages }) => {
    if (!messages.length) return true;
    return window.confirm('Clear this saved conversation? This cannot be undone.');
  }}
/>
```

A storage adapter can be synchronous (like `localStorage`) or Promise-based:

```ts
interface StorageAdapter {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
}
```

For multiple saved chats, use `useConversations` with `ConversationList` and pass the active persistence key/storage into Chorus. The list renders pinned conversations first, formats timestamps for display while keeping ISO `dateTime` attributes, disables conversation mutations while `conversations.loaded === false`, and exposes pin/rename/delete affordances when you pass the corresponding hook actions:

```tsx
const conversations = useConversations({ defaultTitle: 'New chat' });

<ConversationList {...conversations} />
<Chorus
  persistenceKey={conversations.activePersistenceKey}
  persistenceStorage={conversations.storage ?? undefined}
  disabled={!conversations.loaded || !conversations.activeId}
  disabledReason={!conversations.loaded ? 'Loading conversations…' : !conversations.activeId ? 'Create or select a conversation first.' : undefined}
  onMessagesChange={(messages) => {
    if (conversations.activeId) conversations.renameFromFirstMessage(conversations.activeId, messages);
  }}
/>
```

`useConversations({ indexKey, messageKeyPrefix, storage, onError })` stores a JSON index of `{ id, title, createdAt, updatedAt, pinned, pristine }` records under `indexKey` (default `chorus-conversations-index`) and stores each transcript under `${messageKeyPrefix}${id}`. `pristine` tracks whether `renameFromFirstMessage()` may still auto-title the conversation; explicit renames and successful auto-renames clear it. Selecting a conversation bumps `updatedAt` so recency-sorted lists promote recently visited chats. `deleteConversation(id)` removes the transcript key via `removeItem` when available (or writes `[]` without it). To gate the built-in sidebar delete affordance, pass `confirmDeleteConversation={({ conversation }) => window.confirm('Delete ' + conversation.title + '?')}` to `ConversationList`; returning or resolving `false` cancels before `deleteConversation` updates storage. Index read/write and transcript delete failures surface through `result.error` and `onError(error)` with `error.key`, `error.operation` (`'read' | 'write' | 'delete'`), and `error.conversationId` for transcript deletes. With async storage, `createConversation()` calls made before `loaded` resolves are queued and merged into the loaded index; custom sidebars should still disable New/Rename/Delete controls while `loaded` is false to avoid surprising delayed mutations.

When the default `localStorage` adapter is used, both `useConversations` and `useChorusPersistence` listen for the browser's `storage` event so writes from another tab (a new conversation, a streamed reply, a deletion) are picked up automatically. Cross-tab sync is intentionally limited to the default adapter — if you pass a custom `StorageAdapter` (sessionStorage, IndexedDB, a remote API, etc.), the hooks do not subscribe to `storage` events and that adapter is responsible for its own change notification.

#### `useConversations` storage lifecycle

- **`loaded` transition.** `loaded` is `true` synchronously when the storage adapter returns the index synchronously (e.g. `localStorage`) and `false` while an async `getItem(indexKey)` is still resolving. While `loaded === false`, `conversations` is `[]` and `activeId` is `null`; render a skeleton/spinner instead of the empty state, and disable sidebar New/Rename/Delete controls. Once the index resolves, `loaded` flips to `true` once and stays true for the lifetime of the hook.
- **Pre-load mutations.** `createConversation()` calls made while `loaded === false` are queued and merged into the loaded index after the async read resolves; the returned id is stable so you can navigate immediately. Other mutations (`selectConversation`, `renameConversation`, `renameFromFirstMessage`, `pinConversation`, `deleteConversation`) are ignored while `loaded === false` to avoid clobbering an in-flight index.
- **Error routing.** Adapter failures surface as a `ConversationStorageError` on `result.error` and through `onError(error)`. Reads/writes never throw a promise out of the hook. Each error carries `error.key`, `error.operation` (`'read' | 'write' | 'delete'`), and `error.conversationId` (for transcript deletes), plus `error.cause` with the original adapter error. Per-message persistence failures from the active conversation's transcript flow through `<Chorus onPersistenceError>` instead (the wrapping storage adapter only touches index timestamps).
- **Write ordering.** Index writes triggered by user actions (create/rename/pin/delete/select) are flushed immediately; `touchConversation` bumps `updatedAt` and is debounced ~300 ms so rapid activity does not thrash storage. Selecting a conversation changes only the active ID — it never modifies any conversation's `updatedAt`, so recency-sorted lists stay stable when you merely open a conversation. Writes are serialized per-hook: a pending write waits for the previous one to resolve before issuing the next, so concurrent create/delete is safe and the final index always reflects the last action.
- **`onError` reentry.** `onError` is called synchronously after `result.error` is updated. It is safe to call the hook's actions from inside `onError`, but avoid throwing — a thrown handler is warned in development and ignored.

### Persistence examples

The basic runnable example enables `persistenceKey`, so it saves to `localStorage` by default. You can swap storage adapters without changing the rest of the chat:

```tsx
// localStorage (default)
<Chorus persistenceKey="support-chat" transport="/api/chat" />

// sessionStorage
<Chorus persistenceKey="support-chat" persistenceStorage={sessionStorage} transport="/api/chat" />

// Async adapter (IndexedDB, remote draft API, etc.)
const asyncStorage = {
  async getItem(key: string) {
    return await draftsApi.load(key);
  },
  async setItem(key: string, value: string) {
    await draftsApi.save(key, value);
  },
};

<Chorus
  persistenceKey="support-chat"
  persistenceStorage={asyncStorage}
  onPersistenceError={(error) => reportError(error)}
  transport="/api/chat"
/>
```

The built-in `<Chorus persistenceKey>` path disables its composer with the placeholder “Loading saved conversation…” until an async `getItem()` finishes. If you build a custom shell around the exported hooks, use each hook's `loaded` boolean the same way (for example `disabled={!persist.loaded}` or `disabled={!conversations.loaded}`) unless you explicitly merge queued edits yourself.

### Observing streamed tokens with `onChunk`

`onChunk` fires once per streamed token on both the `transport` and `onSend` paths. It's a pure observation hook — it does not interfere with rendering — so it's the right place for live token counting, analytics, or mirroring the stream into an external store:

```tsx
const tokensRef = React.useRef(0);

<Chorus
  transport="/api/chat"
  onChunk={(chunk, messageId) => {
    tokensRef.current += 1;
    // Mirror into an external store keyed by the assistant messageId.
    store.append(messageId, chunk);
  }}
/>
```

`chunk` is the **incremental** text delta the connector just produced — typically one SSE token, never the running accumulated transcript. Append `chunk` yourself (keyed by `messageId`) if you need the full running text. The delta is the raw connector text **before** Markdown parsing/highlighting — `onChunk` does not see sanitized HTML, code-block chrome, or any rendering side effects.

`onChunk` is called only for assistant `text` deltas; reasoning deltas, tool-call deltas, and provider error frames do not trigger it. Final-turn telemetry is reported separately via `onFinish` (successful completion with an assistant message), `onStreamDone` (every stream end, including tool-only turns), `onAbort` (Stop/clear/superseded), and `onError`.

When you drive `useChorusStream` directly, callbacks fire in this order for a single send:

1. `onStart(firstChunk)` — fires once on the first delivered event of any kind (text, reasoning, or tool-call delta), so reasoning-first and tool-only turns still get the signal. `firstChunk` carries the first text chunk when that event is text (also delivered to `onChunk`); otherwise it is an empty string.
2. `onChunk(chunk)` — fires for every non-empty text chunk in stream order.
3. `onDone(response?)` or `onError(error)` — exactly one of these after the stream finalizes (an aborted send rejects without calling `onError`).

`onReasoning` and `onToolDelta` interleave with `onChunk` independently. If `minDelayMs`/`minAssistantDelayMs` is non-zero, chunks are buffered until the delay elapses, then flushed in stream order before any are delivered.

`onWarning` fires for non-fatal connector warnings (`{ code, message, payload? }`) as the connector emits them — e.g. a `truncated` warning when the model stopped at its max-token limit, or safety-rating notices. Unlike `onError`, a warning does not abort the stream: `onDone` still fires afterwards. A throwing `onWarning` is warned in development and otherwise ignored, so a misbehaving warning observer cannot fail an otherwise-successful send. When you drive `useChorusStream` directly and omit `onWarning`, warnings are logged once in development so the signal stays discoverable; `<Chorus>` surfaces them through the `onStreamWarning` prop.

`onMetadata` fires for free-form provider metadata (`Record<string, unknown>`) as connectors emit it — OpenAI Responses token `usage`, Anthropic `stopReason`/`stopSequence`, Gemini `safetyRatings`/`finishReason`, OpenAI Chat `finishReason`. Like `onWarning` it never aborts the stream and a throwing handler is warned in development and otherwise ignored. Unlike `onWarning`, omitting it drops metadata silently — it is opt-in diagnostics, not a signal a developer needs surfaced — so directly-driven hooks see no dev log. `<Chorus>` surfaces it through the `onStreamMetadata` prop; wire it for usage/cost telemetry such as a live budget meter.

### Completion telemetry with `onFinish`

Use `onFinish` when you need the final assistant message rather than token-by-token observations:

```tsx
<Chorus
  transport="/api/chat"
  onFinish={({ message, messages, reason, response }) => {
    analytics.track('assistant_completed', {
      assistantMessageId: message.id,
      characters: message.text.length,
      turns: messages.filter((m) => m.role === 'user').length,
      reason,
      status: response?.status,
    });
  }}
/>
```

`onFinish` is not called for Stop/abort, transport errors, provider error payloads, tool-only streams, or other sends that produce no assistant message. Use `onAbort` for cancellation telemetry, and `onStreamDone` or `onToolCall` when you need completion telemetry for tool-only turns.

### Abort telemetry with `onAbort`

Use `onAbort` when you need to persist or measure cancelled generations:

```tsx
<Chorus
  transport="/api/chat"
  onAbort={({ message, messages, reason, source, path }) => {
    analytics.track('assistant_aborted', {
      assistantMessageId: message?.id,
      partialCharacters: message?.text.length ?? 0,
      turns: messages.filter((m) => m.role === 'user').length,
      reason, // 'stop' | 'clear' | 'superseded'
      source, // 'user' | 'programmatic'
      path, // 'transport' | 'onSend'
    });
  }}
/>
```

Built-in Stop reports `reason: 'stop'` and `source: 'user'`; `ref.stop()` reports `reason: 'stop'` and `source: 'programmatic'`. Clearing while sending reports `reason: 'clear'` before the transcript is reset, so `messages` can still include the partial assistant. Built-in send/edit/regenerate/retry actions do not start a second generation while one is active; if an integration supersedes an active session, Chorus reports `reason: 'superseded'` and `source: 'programmatic'`.

### Transcript observer and export

Use `onMessagesChange` when you want a drop-in `<Chorus>` but still need audit logging, analytics, live stats, or transcript export. Unlike `onChange`, it fires in every message-source mode and does not make the component controlled:

```tsx
const latestMessages = React.useRef<Message[]>([]);

<Chorus
  persistenceKey="support-chat"
  transport="/api/chat"
  onMessagesChange={(messages, context) => {
    latestMessages.current = messages;
    auditLog.enqueue({ source: context.source, reason: context.reason, messages });
  }}
/>

<button type="button" onClick={() => downloadTranscript(latestMessages.current)}>
  Download transcript
</button>
```

For one-off reads from outside React state, call `chorusRef.current?.getMessages()`.

### Transcript search, copy, and export

`useChorusTranscriptActions` is a headless utility hook for building a search box, a "copy conversation" button, or a "download transcript" affordance around `<Chorus>` or a custom headless shell — without writing the indexing, clipboard, and serialization layers yourself. Pass it the same `messages` array you render (from `chorusRef.getMessages()`, `onMessagesChange`, or your own state) and it returns four callbacks with stable identities:

- `searchMessages(query)` — case-insensitive substring search across each message's `text`, each attachment's file `name`, the `reasoning` of assistant messages, and — for tool messages — `toolCall.name` plus its serialized `input` and `output`. These are exactly the values `exportAs('markdown')` renders, so a string visible in the export is findable here and vice versa. Returns the matching `Message[]`; a blank/whitespace-only query returns `[]`. Pair it with `chorusRef.scrollToMessage(id)` to jump to a hit.
- `copyAll(format?)` — copies the whole transcript to the clipboard. Defaults to `'markdown'`; pass `'json'` for the raw structure. Resolves `false` without touching the clipboard when the transcript is empty (a non-error signal — `onCopyError` is not called — so you can disable the button). Also resolves `false`, and calls the optional `onCopyError`, when the Clipboard API is unavailable or the write rejects.
- `exportAs(format)` — serializes the transcript to a string. `'markdown'` renders a readable transcript with one heading per message (assistant messages include a `**Reasoning:**` block; tool calls include their input/output); `'json'` returns `JSON.stringify(messages, null, 2)`, which round-trips through `JSON.parse`.
- `downloadAs(format, filename?)` — serializes the transcript and saves it to a file by triggering a transient `<a download>`, so you skip the `Blob`/`createObjectURL`/anchor/`revokeObjectURL` dance. `filename` defaults to `transcript.md` / `transcript.json` per format (a name with no extension gets the format's appended); the MIME type is picked for you. Returns `false` without downloading when the transcript is empty or no DOM is available (e.g. SSR), and `true` once the download starts. The `TRANSCRIPT_FORMAT_INFO` record (`{ markdown, json }` → `{ mimeType, extension }`) is exported too if you need those values for your own download or upload code.

```tsx
import React from 'react';
import { Chorus, useChorusTranscriptActions, type ChorusRef, type Message } from 'react-chorus';

export function SearchableChat() {
  const chorusRef = React.useRef<ChorusRef>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const { searchMessages, copyAll, downloadAs } = useChorusTranscriptActions(messages);

  const jumpToFirstHit = (query: string) => {
    const [hit] = searchMessages(query);
    if (hit) chorusRef.current?.scrollToMessage(hit.id);
  };

  return (
    <>
      <input type="search" placeholder="Search transcript…" onChange={(e) => jumpToFirstHit(e.target.value)} />
      <button type="button" onClick={() => copyAll()}>Copy conversation</button>
      <button type="button" onClick={() => downloadAs('markdown')}>Download .md</button>
      <Chorus ref={chorusRef} transport="/api/chat" onMessagesChange={setMessages} />
    </>
  );
}
```

`useChorusTranscriptActions` is also re-exported from `react-chorus/headless`. Pass `{ roleLabels }` to relabel the Markdown headings (for example `{ user: 'Customer', assistant: 'Agent' }`) and `{ onCopyError }` to observe clipboard failures from `copyAll()`.

### Attachment composer UX

Passing `accept` enables the built-in attachment composer. Users can pick files, paste files from the clipboard, or drag/drop files anywhere over the chat surface — the transcript as well as the composer — and a "Drop to attach" overlay confirms the drop target while a file is dragged over it. All paths use the same `accept` matching (`image/*`, exact MIME types, and extensions such as `.pdf`). An empty or whitespace-only `accept` (and `maxAttachmentBytes={0}`) means "no attachments allowed": the attach button is hidden and stray drops are still neutralized so the browser never navigates away to a dropped file's URL.

By default, react-chorus reads accepted files into base64 **data URLs** and stores them in `Message.attachments`. That makes local demos and simple persistence easy, but data URLs can inflate request bodies and persisted history. For production, set size/count limits and consider `uploadAttachment` so large files are uploaded to your storage/provider before the message is sent.

Limit file size/count and surface actionable errors:

```tsx
<Chorus
  transport="/api/chat"
  accept="image/*"
  maxAttachmentBytes={2 * 1024 * 1024}
  maxAttachments={3}
  onAttachmentError={(error) => {
    // error.reason: 'unsupported-type' | 'too-large' | 'too-many' | 'read-failed' | 'upload-failed'
    toast.error(error.message);
  }}
/>
```

Upload/transform files before they enter message history:

```tsx
<Chorus
  transport="/api/chat"
  accept="image/*,.pdf"
  uploadAttachment={async (file, { signal } = {}) => {
    const form = new FormData();
    form.set('file', file);
    const uploaded = await fetch('/api/uploads', { method: 'POST', body: form, signal }).then(r => r.json());

    return {
      name: file.name,
      type: file.type,
      size: file.size,
      url: uploaded.url,      // used for previews when renderable
      id: uploaded.fileId,    // preserve provider/storage ids for your backend
      data: uploaded.url,     // optional; defaults to url or id when omitted
    };
  }}
/>
```

If you return only `url` or `id`, Chorus normalizes `attachment.data` to that value for backwards compatibility. Your backend should still prefer explicit `url`/`id` fields when present.

All accepted files first appear as pending attachment chips while they are read as data URLs or processed by `uploadAttachment`, and Send is disabled until every pending chip resolves. Removing a pending chip aborts its `AbortSignal`; late FileReader/upload completions are ignored and do not re-add the file. Read failures call `onAttachmentError` with `reason: 'read-failed'`; upload failures call `reason: 'upload-failed'`; user-initiated aborts are silent.

**Accessibility:** pending chips set `aria-busy="true"` and expose a polite live-region "Reading/Uploading {name}" status so screen-reader users hear the upload in progress. When a pending attachment completes, the composer emits a separate polite live-region "{name} attached" announcement so success is heard even though the spinner has been removed. A read/upload failure is announced exactly once — by the polite attachment error region (`role="status"`, `aria-live="polite"`) when it is rendered, or, when that region is suppressed with `renderAttachmentError={null}`, by the polite announcer span ("{name} failed to attach"). All of these strings flow through `labels.attachments` for localization.

**Image alt text.** `Attachment.alt` is an optional human-authored description used as the image `alt` when the message renders in the transcript. When `alt` is omitted, the renderer falls back to a role-hinted label (`Attached image: {name}` by default, localizable via `labels.attachments.imageFallbackAlt`) rather than the bare filename. Image attachment chips in the composer expose an inline "Describe this image" affordance that captures alt text before send; the typed value flows into the `Attachment.alt` passed to `onSend`. Custom upload flows can also set `alt` themselves before returning the attachment from `uploadAttachment`.

### Hiding or showing tool calls

`<Chorus>` uses `hiddenRoles` to control which roles appear in the transcript (`showSystemMessages` is only available on `<ChatWindow>`, for backwards compatibility). By default `<Chorus>` hides system prompts and shows tool call blocks, which is the usual agent-UI pattern:

```tsx
<Chorus
  transport="/api/chat"
  hiddenRoles={['system']} // default: show user, assistant, and tool — hide system prompts
/>
```

Pass `hiddenRoles={['system', 'tool']}` to hide tool calls as well, or `hiddenRoles={[]}` to show every role.

For controlled mode, seed your own state instead of using `initialMessages`, and include hidden system/tool messages directly when you want full control over the request history:

```tsx
const [messages, setMessages] = React.useState<Message[]>([
  { id: 'sys', role: 'system', text: 'You are a concise support assistant.' },
  { id: 'welcome', role: 'assistant', text: 'Hi! How can I help?' },
]);

<Chorus value={messages} onChange={setMessages} transport="/api/chat" />
```

### Showing message timestamps

Every `Message` accepts an optional `createdAt` ISO-8601 string (for example `new Date().toISOString()`). It is informational only — Chorus never sets it for you — and is ignored unless you opt in with `showTimestamps`:

```tsx
<Chorus
  transport="/api/chat"
  showTimestamps
  initialMessages={[
    { id: 'welcome', role: 'assistant', text: 'Hi! How can I help?', createdAt: new Date().toISOString() },
  ]}
/>
```

With `showTimestamps`, the default renderer adds a locale-aware `<time>` element below each bubble; messages without a `createdAt` render no time. The default formatter shows a short time of day (`Intl.DateTimeFormat`, with a `toLocaleTimeString` fallback). Pass `formatTimestamp` for a different format — for example a relative time or a date + time — and it also receives the message so you can vary by role. The prop's type is exported as `MessageTimestampFormatter<TMeta>` for typing a reusable formatter:

```tsx
<Chorus
  transport="/api/chat"
  showTimestamps
  formatTimestamp={(timestamp) => new Date(timestamp).toLocaleString()}
/>
```

No custom `renderMessage` is required. The `Reasoning` disclosure, by contrast, only ever renders for `assistant` messages — a `reasoning` field on a `user`, `system`, or `tool` message is ignored by the default renderer.

### Rendering long transcripts

By default, `<Chorus>` and `<ChatWindow>` render every visible message so browser find, screen-reader history, and custom layouts see the full transcript. For very long persisted chats with heavy Markdown, pass `maxRenderedMessages` to render only the latest N visible messages:

```tsx
<Chorus transport="/api/chat" maxRenderedMessages={100} />
```

This is a simple windowing escape hatch rather than full virtualization: earlier visible messages are not mounted until you remove/increase the limit, but typing/error rows stay accessible, bottom auto-scroll still tracks new output, and edit/regenerate/delete actions continue to target original message IDs.

### Driving Chorus with `useChorusStream` directly

`useChorusStream` is also useful without `<Chorus>` when you want a fully custom transcript shell:

```tsx
import React from 'react';
import { createFetchSSETransport, useChorusStream, type Message } from 'react-chorus';

const transport = createFetchSSETransport('/api/chat');

export function CustomChat() {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const { send, abort, sending } = useChorusStream(transport, { connector: 'openai' });

  async function submit(text: string) {
    const user: Message = { id: crypto.randomUUID(), role: 'user', text };
    const assistant: Message = { id: crypto.randomUUID(), role: 'assistant', text: '' };
    const history = [...messages, user];
    setMessages([...history, assistant]);

    try {
      await send(text, history, {
        onChunk: (chunk) => setMessages((prev) => prev.map((m) =>
          m.id === assistant.id ? { ...m, text: m.text + chunk } : m,
        )),
      });
    } catch (error) {
      setMessages((prev) => prev.filter((m) => m.id !== assistant.id));
      console.error(error);
    }
  }

  return (
    <section>
      {messages.map((m) => <p key={m.id}><b>{m.role}:</b> {m.text}</p>)}
      <button type="button" disabled={sending} onClick={() => submit('Hello')}>Send hello</button>
      {sending && <button type="button" onClick={abort}>Stop</button>}
    </section>
  );
}
```

### `useChorusStream(transport, opts?)`

```ts
const { send, abort, sending } = useChorusStream<MyMeta>(transport, { connector: 'openai' });
```

- `transport` — async function `(text, history: Message<TMeta>[], signal) => Promise<Response>`. Use `createFetchSSETransport<TMeta>(url)` or write your own.
- `send(..., { minDelayMs })` buffers the first streamed chunks until that many milliseconds have elapsed from send start, then flushes them before continuing normally.
- `send(..., { onReasoning, onToolDelta })` receives connector-emitted reasoning chunks and accumulated tool deltas when you use the hook directly. `<Chorus>` wires these into `Message.reasoning` and `role: 'tool'` messages automatically; advanced `onSend` bridges can pass `helpers.streamCallbacks?.()` to preserve the same behavior.
- `send(..., { onWarning })` receives non-fatal connector warnings (`ConnectorWarning` — `{ code, message, payload? }`) such as `truncated` (max-token stop) or safety notices. The stream is not aborted; `onDone` still fires. `<Chorus>` surfaces these through the `onStreamWarning` prop, and `helpers.streamCallbacks?.()` forwards them on the `onSend` bridge. When you drive the hook directly and omit `onWarning`, warnings are logged once in development instead.
- `send(..., { onMetadata })` receives free-form provider metadata (`Record<string, unknown>`) such as token `usage`, `finishReason`, `stopReason`, or `safetyRatings`. The stream is not aborted; `onDone` still fires. `<Chorus>` surfaces these through the `onStreamMetadata` prop, and `helpers.streamCallbacks?.()` forwards them on the `onSend` bridge. Omitting `onMetadata` drops the metadata silently.
- Non-abort transport, HTTP, connector, and in-band provider errors call `onError` when supplied and reject the returned `send()` promise. This lets README-style `await send(...)` bridges surface the friendly Chorus error banner through the surrounding `onSend` catch path.
- If `onError` itself throws while handling a stream error, Chorus warns in development and still rejects `send()` with the original stream error. If `onDone` throws after a successful stream, `send()` rejects with that completion callback error and does not call `onError`.
- `onError` receives raw transport details (including bounded HTTP response body snippets); the built-in UI continues to show only `errorMessage`.
- A 200 response that contains no SSE-shaped lines at all (for example a JSON `{"error":"missing key"}` or plain-text body served instead of `text/event-stream`) rejects `send()` with a `ChorusStreamError` whose message names Server-Sent Events, includes the response `Content-Type`, and previews the body — instead of completing silently with no chunks and no error. Truly empty/no-content bodies still resolve, and so does a valid `text/event-stream` that carried only `:` keepalive comments or named `event:` lines with no `data:` field (see [Named SSE events](#named-sse-events)).
- Calling `send()` while a previous `send()` is still in flight rejects the new call with a `ChorusStreamError` whose `code === 'concurrent-send'` (the previous send keeps running, the transport is not invoked a second time, and a dev-mode warning is logged). Custom shells that `await send(...)` can branch on `err instanceof ChorusStreamError && err.code === 'concurrent-send'` to keep their input/UI state intact, instead of mistaking the silent no-op for a successful empty stream. To start a fresh send, await the active promise or call `abort()` first.
- `opts.connector` — `'openai'` | `'anthropic'` | `'gemini'` | `'ai-sdk'` | `'auto'` | custom `Connector`. Defaults to `'auto'` which handles OpenAI, Gemini, Anthropic, and Vercel AI SDK JSON / data-stream frames, plain-text SSE, reasoning/tool deltas, and in-band `{ error }` payloads.
- `opts.connectorOptions` — options forwarded to the built-in connector named by `opts.connector`. Currently only `connector: 'openai'` consumes them (e.g. `{ thinkTag: { start: '<reasoning>', end: '</reasoning>' } }`). Ignored for other connector names and for custom `Connector` objects; in development a console warning fires when options are passed but the connector cannot apply them.
- If a connector exposes `createState()`, the hook creates one state object per `send()` and passes it to every `extract(data, state)` call for that stream. Do not store per-stream parser buffers in module globals; use connector state instead.

### `createFetchSSETransport(url, init?)`

Returns a `Transport` that POSTs to `url` and reads the response as a Server-Sent Events stream. With no `formatBody`, it sends JSON `{ prompt, history }` and defaults `Content-Type: application/json`. **`history` already includes the latest user turn; `prompt` is a duplicate convenience copy of `history[last].text`.** Server handlers should map `history` directly and ignore `prompt` — appending `prompt` to `history` will send the new user message to the model twice. With a custom `formatBody`, headers are left alone so FormData/Blob/URLSearchParams can set their own content type; add an explicit JSON Content-Type when your custom serializer returns JSON.

| Option | Type | Default | Description |
|---|---|---|---|
| `method` | `'GET' \| 'HEAD' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'` | `'POST'` | HTTP method. With `'GET'`/`'HEAD'`, `formatBody` and the default JSON `Content-Type` are skipped — encode state in query params on `url`. |
| `formatBody` | `(text, history: Message<TMeta>[]) => BodyInit` | `JSON.stringify({ prompt, history })` | Serialise the outgoing request body. `text` equals `history[last].text` — both arguments describe the same user turn. Custom serializers do not get an automatic JSON Content-Type. Ignored when `method` is `'GET'` or `'HEAD'`. |
| *(any `RequestInit` field)* | | | Forwarded to `fetch` (e.g. `headers`, `credentials`) |

```ts
import { createFetchSSETransport } from 'react-chorus';
import {
  formatAnthropicMessagesBody,
  formatGeminiGenerateContentBody,
  formatOpenAIChatCompletionsBody,
} from 'react-chorus/provider-requests';

// Provider-shaped JSON to your own server proxy (do not expose API keys in browser code)
const openAITransport = createFetchSSETransport('/api/openai-chat', {
  headers: { 'Content-Type': 'application/json' },
  formatBody: formatOpenAIChatCompletionsBody({ model: 'gpt-4o-mini' }),
});

const anthropicTransport = createFetchSSETransport('/api/anthropic-chat', {
  headers: { 'Content-Type': 'application/json' },
  formatBody: formatAnthropicMessagesBody({ model: 'claude-sonnet-4-6', max_tokens: 1024 }),
});

const geminiTransport = createFetchSSETransport('/api/gemini-chat', {
  headers: { 'Content-Type': 'application/json' },
  formatBody: formatGeminiGenerateContentBody({ generationConfig: { temperature: 0.2 } }),
});

// FastAPI / LangChain backend
const transport = createFetchSSETransport('/api/chat', {
  headers: { 'Content-Type': 'application/json' },
  formatBody: (_text, history) => JSON.stringify({ messages: history }),
});

// Multipart upload or custom body: no forced JSON Content-Type
const multipartTransport = createFetchSSETransport('/api/chat-with-files', {
  formatBody: (text, history) => {
    const form = new FormData();
    form.set('prompt', text);
    form.set('history', JSON.stringify(history));
    return form;
  },
});

// GET-based SSE proxy: state lives in the URL, no request body
const getTransport = createFetchSSETransport('/api/chat?conversationId=abc', { method: 'GET' });
```

### `createWebSocketTransport(url, opts?)`

Returns a `Transport` that connects over a native WebSocket. Each incoming message is wrapped as an SSE `data:` line so the existing connector pipeline works unchanged.

| Option | Type | Default | Description |
|---|---|---|---|
| `protocols` | `string \| string[]` | – | WebSocket sub-protocols passed to the constructor |
| `persistent` | `boolean` | `false` | Reuse one socket across sends instead of opening one socket per send |
| `onOpen` | `() => void` | – | Called once for each real WebSocket open transition |
| `onClose` | `(code: number, reason: string) => void` | – | Called once for each real WebSocket close transition, with the close code and reason |
| `onError` | `(event: Event) => void` | – | Called when the WebSocket reports an error |
| `onMessage` | `(data: string, event: MessageEvent) => void` | – | Observes every decoded WebSocket message; useful for persistent server-pushed updates when no send stream is active |
| `formatMessage` | `(text, history: Message<TMeta>[]) => string \| { payload: string; correlationId?: string \| null }` | `JSON.stringify({ prompt, history })` | Serialise the outgoing request. As with the fetch transport, `history` already includes the new user turn and `prompt`/`text` are duplicate copies — backends should consume `history` and ignore `prompt`. Return `{ payload, correlationId }` in persistent mode to register the active stream so `correlate` can route inbound frames to it |
| `correlate` | `(frame: string) => string \| null \| undefined` | – | Persistent mode only: extract the correlation id from each inbound frame. Non-null ids route the frame to the matching stream; `null`/`undefined` falls through to the legacy broadcast |

Default mode opens a fresh socket per send, then closes it when the response stream ends, the connector reports a done sentinel, or the `AbortSignal` fires. Serializer (`formatMessage`) and `ws.send()` failures reject the transport promise and close that socket, so they surface through `onError` like HTTP/SSE failures. Incoming string, `Blob`, `ArrayBuffer`, and typed-array messages are decoded as text; other message types error the response body instead of silently emitting an empty chunk.

Persistent mode opens a single socket on the first send and keeps it open across sends. The returned transport is still callable as a normal `Transport`, and also exposes `transport.close(code?, reason?)` for explicit cleanup; runtimes with `FinalizationRegistry` also attempt to close the persistent socket when the transport is garbage-collected, but UI code should call `close()` during unmount/dispose rather than relying on GC timing. `onOpen` and `onClose` fire for real socket transitions, not once per send. Because the socket stays open, application/server protocol code is responsible for reconnect/backoff and request/response correlation. **If sends can overlap (a second message starting before the first finishes, including the built-in Stop-then-resend flow) every inbound frame is broadcast to every active response stream, which duplicates payloads across assistant messages.** Pair a `formatMessage` that returns `{ payload, correlationId }` with `correlate(frame)` so each frame is dispatched to the request that started it; `correlate` returning `null`/`undefined` falls back to the broadcast (use this for server-pushed updates). The transport logs a one-time dev-mode warning the first time it sees overlapping sends without a `correlate` callback. Make sure each response emits a connector-specific done sentinel (or cancel the response body) so `useChorusStream` can finish the current send while the socket remains open.

```ts
let nextId = 0;
const transport = createWebSocketTransport('wss://api.example.com/chat', {
  persistent: true,
  formatMessage: (text, history) => {
    const id = String(++nextId);
    return { payload: JSON.stringify({ id, prompt: text, history }), correlationId: id };
  },
  correlate: (frame) => {
    try { return (JSON.parse(frame) as { id?: string }).id ?? null; } catch { return null; }
  },
});
```

### Custom connector

```ts
import type { Connector } from 'react-chorus';

const myConnector: Connector = {
  name: 'my-api',
  extract(data) {
    if (data === '[DONE]') return { done: true };
    const obj = JSON.parse(data);
    if (obj.error) return { error: typeof obj.error === 'string' ? obj.error : obj.error.message };
    return obj.token ? { text: obj.token } : null;
  },
};
```

Stateful connectors can isolate parser state per stream:

```ts
const bufferedConnector: Connector<{ buffer: string }> = {
  name: 'buffered-api',
  createState: () => ({ buffer: '' }),
  extract(data, state) {
    state!.buffer += data;
    // parse state.buffer and return { text }, { reasoning }, { toolDelta }, etc.
    return null;
  },
};
```

**In-band errors.** Connectors can surface a provider error by returning `{ error: string }` (and optionally `errorPayload` with the original frame). Chorus treats that as a stream error: the assistant message is finalized, `streamError` is set, the error banner renders, and `onError` is called with a `ChorusStreamError`. The original provider payload is preserved on `error.errorPayload`/`error.cause` and on `streamRawError` for hosts that want to surface a richer banner via `renderError`.

```ts
import type { Connector } from 'react-chorus';

const myConnector: Connector = {
  name: 'my-api',
  extract(data) {
    if (data === '[DONE]') return { done: true };
    const obj = JSON.parse(data);
    if (obj.error) {
      return {
        error: typeof obj.error === 'string' ? obj.error : obj.error.message ?? 'Stream error',
        errorPayload: obj,
      };
    }
    return obj.token ? { text: obj.token } : null;
  },
};

<Chorus
  transport="/api/chat"
  connector={myConnector}
  onError={(err) => {
    // err is a ChorusStreamError; err.errorPayload is the original frame.
    console.error('stream failed:', err.message, err.errorPayload);
  }}
  renderError={({ error, rawError, retry, dismiss }) => (
    <div role="alert">
      <p>{error}</p>
      {rawError && 'errorPayload' in rawError && rawError.errorPayload ? (
        <pre>{JSON.stringify(rawError.errorPayload, null, 2)}</pre>
      ) : null}
      <button onClick={retry}>Retry</button>
      <button onClick={dismiss}>Dismiss</button>
    </div>
  )}
/>
```

The built-in connectors emit `{ error, errorPayload }` the same way when they detect a provider error frame (OpenAI `{ error: { message } }`, Anthropic `{ type: 'error' }`, Gemini blocked finish reasons, etc.), so the same `onError`/`renderError` wiring works for built-in and custom connectors.

## Serializing multimodal and tool-call history

`Message` is react-chorus' UI/storage shape. Provider APIs have stricter role and content schemas, so do not blindly send every item as `{ role: m.role, content: m.text }`: `tool` messages often need provider-specific IDs, system prompts may be top-level fields, and attachments need multimodal content parts.

Recommended patterns:

- Keep the default transport body (`{ prompt, history }`) and map `history` safely on your server with `toOpenAIChatCompletionsBody`, `toAnthropicMessagesBody`, or `toGeminiGenerateContentBody`. `history` already includes the latest user turn — `prompt` is a duplicate copy and the provider helpers read `history` only.
- Or pass a `format*Body` helper to `createFetchSSETransport('/api/chat', { formatBody, headers })` when your own backend expects a provider-shaped JSON body.
- Keep API keys in that backend proxy. Client-side `formatBody` is for shaping requests to your server, not for calling provider APIs directly with secrets.

### End-to-end image attachment recipe (OpenAI Chat Completions)

Front end: enable image selection, paste, and drop. The `accept` prop makes `<ChatInput>` read image files into `Message.attachments` as data URLs by default, and the normal `transport` path sends those attachments in `history`.

```tsx
<Chorus
  transport="/api/chat"
  connector="openai"
  accept="image/*"
  maxAttachmentBytes={2 * 1024 * 1024}
/>
```

Backend: use the OpenAI helper. It maps user image attachments to `image_url` parts and inserts a text note for unsupported attachments.

```js
import { toOpenAIChatCompletionsBody } from 'react-chorus/provider-requests';

const history = Array.isArray(req.body?.history) ? req.body.history : [];
const body = toOpenAIChatCompletionsBody(history, { model: 'gpt-4o-mini' });
const stream = await openai.chat.completions.create(body);
```

The runnable [`examples/with-next`](./examples/with-next) and [`examples/with-openai`](./examples/with-openai) apps use this helper. The Express app sets `express.json({ limit: '10mb' })`; on Next.js/serverless hosts, keep `maxAttachmentBytes` under the platform request limit or upload large files separately.

### Tool-call history recipe

Chorus displays tool steps as `role: 'tool'` with `message.toolCall`, but those messages are not a provider-neutral wire format. Connectors store the streamed provider id on `message.toolCall.id` when available. For OpenAI and Anthropic streams, Chorus also writes provider-aware metadata when the id came from the provider (not a generated fallback), so the request helpers can replay tool results exactly. For manually-created tool messages, store the same metadata yourself:

```ts
{
  role: 'tool',
  text: '',
  toolCall: { name: 'search', output: { results: [] } },
  metadata: {
    openai: { toolCallId: 'call_abc' },       // OpenAI Chat/Responses
    anthropic: { toolUseId: 'toolu_abc' },    // Anthropic Messages
  },
}
```

The request helpers use those IDs for OpenAI `tool_call_id` / Responses `call_id` and Anthropic `tool_result.tool_use_id`. They also synthesize the provider-required assistant tool-call records (`assistant.tool_calls`, Responses `function_call`, Anthropic `tool_use`) before the tool result. When an ID is missing, they convert the tool result to safe text context instead of emitting an invalid provider-specific tool message. Gemini function responses use `toolCall.name` and the output payload.

## Tool calls and agent steps

For agentic UIs, react-chorus provides first-class support for tool call rendering via the `role: 'tool'` message type.

### Streaming and execution lifecycle

On the built-in `transport` path, connector `toolDelta` events are display-only by default: Chorus creates or updates a visible `role: 'tool'` message and leaves execution to your app. A streamed tool call is considered complete when the provider stream ends (`[DONE]`, `message_stop`, a normal Gemini finish reason, or the response body closing). Tool-only turns end the sending state cleanly; because there is no assistant message, `onFinish` does not fire, but `onStreamDone` and/or `onToolCall` can observe the completed tool context.

The default `<ToolCallBlock>` renders an expandable input/output panel once a call has either. Before its arguments arrive — or for a call that legitimately produces no input and no output — it shows an explicit status row instead of an empty control: `Running…` while the turn is still streaming, `No output` once it has settled. Both strings are localizable via `labels.toolCall.running` / `labels.toolCall.empty`.

To observe deltas without executing tools:

```tsx
<Chorus
  transport="/api/chat"
  connector="openai"
  onToolDelta={({ delta, message }) => {
    console.log('tool update', delta.id, message.toolCall.input);
  }}
  onStreamDone={({ toolMessages }) => {
    console.log('completed tool calls', toolMessages);
  }}
/>
```

To execute tools in the simple path, pass a `tools` registry. Handlers run after streaming input completes, receive the final parsed `input` plus an abortable context, and their return value is appended as `toolCall.output`. If the user clicks Stop while a handler is running, `context.signal` is aborted and late outputs are ignored. If a handler throws a non-abort error, Chorus keeps the tool row inspectable and writes `{ error: message }` to its output (and flags `metadata.isError`). By default it then ends the turn — calling `onError` and showing the friendly error banner; clicking Retry removes the failed assistant/tool attempt before rendering the fresh response.

To make a thrown tool error recoverable instead of terminal, set `continueOnToolError`. The error output is then treated as a normal tool result: the already-streamed assistant text from that iteration is kept, no error banner is shown, and — with `autoContinueTools` enabled — the loop continues and feeds the error tool result back to the model (as `is_error: true` for Anthropic) so it can apologize or try a different approach. Abort errors from Stop always end the turn regardless of this flag.

By default this remains display/manual mode: Chorus does not make a second model request after tool execution, so use `onToolCall`/`onStreamDone` or your backend to continue the agent loop when needed. To opt in to a built-in loop, set `autoContinueTools`. Chorus will run the handlers, append outputs, then send a continuation request with the updated history. `maxToolIterations` (default `4`) prevents runaway loops, `shouldContinueToolLoop(context)` can stop a specific continuation, and Stop aborts both tool execution and continuation streams. When the cap fires (or any other terminal condition), `onStreamDone` receives a `reason` (`'max-tool-iterations' | 'tool-loop-veto' | 'tool-loop-continue' | 'completed'`) plus `willContinue`, `iteration`, and `maxToolIterations` — hosts decide how to surface the cap in their UI (Chorus deliberately does not render a default banner).

#### One source of truth for schema + handler

`defineTool` produces a `ChorusToolDefinition` that pairs the model-facing name, description, and input JSON Schema with the local handler. Pass the same array to `<Chorus tools={...} />` to execute calls and to the provider-request helpers to advertise the schema — so a typo or schema drift can't slip in between client and server:

```ts
// tools.ts — shared by both the React app and your backend
import { defineTool } from 'react-chorus';

export const searchTool = defineTool({
  name: 'search',
  description: 'Search the docs for a query string',
  inputSchema: {
    type: 'object',
    properties: { q: { type: 'string', description: 'query text' } },
    required: ['q'],
  },
  // Optional per-provider overrides merged into the generated tool entry:
  // openai: { strict: true }, anthropic: { cache_control: { type: 'ephemeral' } },
  handler: async (input, { signal }) => {
    const { q } = input as { q: string };
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal });
    return res.json();
  },
});

export const tools = [searchTool];
```

```tsx
// client: register handlers + advertise to the model in one place
import { Chorus } from 'react-chorus';
import { tools } from './tools';

<Chorus
  transport="/api/chat"
  connector="openai"
  tools={tools}
  autoContinueTools
  maxToolIterations={2}
/>
```

```ts
// server: same array → provider-specific tool declarations
import { toOpenAIChatCompletionsBody } from 'react-chorus/provider-requests';
import { tools } from '../tools';

const body = toOpenAIChatCompletionsBody(history, { model: 'gpt-4o-mini', tools });
// body.tools === [{ type: 'function', function: { name: 'search', description: ..., parameters: ... } }]
const stream = await openai.chat.completions.create(body);
```

The body helpers detect Chorus-shaped definitions and serialize them. For Anthropic and Gemini the equivalent helpers (`toAnthropicMessagesBody`, `toGeminiGenerateContentBody`) emit `input_schema` and `functionDeclarations` respectively. Standalone serializers (`toOpenAIChatCompletionsTools`, `toOpenAIResponsesTools`, `toAnthropicTools`, `toGeminiTools`) are exported when you want the `tools` field on its own. If you pass an already-shaped provider tools array as `tools`, the helpers leave it untouched as an escape hatch.

The legacy `Record<name, handler>` shape still works for handler-only registries when you have no schema to advertise:

```tsx
<Chorus
  transport="/api/chat"
  connector="openai"
  tools={{
    search: async (input, { signal }) => { /* ... */ },
  }}
  onToolCall={({ name, input, output }) => {
    // When a matching tools[name] handler exists, this is an observer; its
    // return value is ignored. Without a tools handler, returning a value here
    // appends that value as toolCall.output.
    console.log(name, input, output);
  }}
/>
```

### Built-in rendering

Push a message with `role: 'tool'` and a `toolCall` payload. `ChatWindow` renders it as a collapsible block automatically:

```tsx
setMessages(prev => [
  ...prev,
  {
    id: crypto.randomUUID(),
    role: 'tool',
    text: '',
    toolCall: {
      name: 'search_web',
      input: { query: 'react streaming SSE' },
      output: { results: ['...'] },
    },
  },
]);
```

The block shows the tool name in a header. Clicking expands it to reveal the input and output formatted as JSON. `<Chorus>` shows tool messages by default while hiding system messages; pass `hiddenRoles={['system', 'tool']}` to hide them. Standalone `<ChatWindow>` keeps its historical default of hiding both `system` and `tool` unless you pass `hiddenRoles={['system']}`.

### Custom renderer via `renderMessage`

Supply a `renderMessage` render-prop to take full control of how any message is displayed. Return `null` to fall back to the default renderer for that message. The second argument is a `RenderMessageContext`:

```ts
interface RenderMessageContext<TMeta = Record<string, unknown>> {
  /** The message currently being rendered. */
  message: Message<TMeta>;
  /** True while this message is the active streaming assistant turn. */
  isStreaming: boolean;
  /**
   * True while this message's built-in inline editor is active (the Edit button has been clicked
   * and Save/Cancel has not yet fired). Skip rendering your own bubble/content when this is true
   * so the inline editor rendered by `ctx.actions.defaultRender()` replaces the row instead of
   * sitting alongside the original content.
   */
  isEditing: boolean;
  /** Calls the default Chorus renderer for this message; pass optional slots to decorate the bubble. */
  defaultRender: (slots?: MessageBubbleSlots) => React.ReactNode;
  /** Spread on a custom row root so `ChorusRef.scrollToMessage(id)` can target it. */
  messageProps: RenderMessageRootProps; // { 'data-chorus-message-id': string }
  /** Built-in actions (edit/regenerate/copy/delete/feedback) plus their default-rendered controls. */
  actions: MessageRenderActions;
}

interface MessageRenderActions {
  /** Per-action availability flags reflecting current Chorus state (disabled/read-only, role, sending). */
  canEdit: boolean;
  canRegenerate: boolean;
  canDelete: boolean;
  /** Saves a message edit. The built-in inline editor calls this with a non-empty trimmed string. */
  edit?: (newText: string) => void;
  regenerate?: () => void;
  delete?: () => void;
  /** Returns boolean | void | Promise<boolean | void>; built-in controls show "Copy failed" on explicit false. */
  copy?: () => MessageCopyResult;
  feedback?: (variant: MessageFeedback | null) => void; // null clears the rating
  /** Current persisted feedback selection used to seed the built-in thumb state. */
  initialFeedback?: MessageFeedback | null;
  /** Renders the built-in action controls (Copy/Edit/Regenerate/Delete/Feedback) for this message. */
  defaultRender: () => React.ReactNode;
}

interface MessageBubbleSlots {
  before?: React.ReactNode;       // before the bubble (avatars, etc.)
  headerSlot?: React.ReactNode;   // inside .chorus-msg-content, above .chorus-bubble
  footerSlot?: React.ReactNode;   // inside .chorus-msg-content, below .chorus-bubble
  after?: React.ReactNode;        // after the bubble
}

interface RenderMessageRootProps {
  'data-chorus-message-id': string;
}
```

`edit`, `regenerate`, `delete`, and `feedback` are only set when those actions are available for the message and the current Chorus state — for example `edit` is omitted while the chat is disabled/read-only or for non-user messages. Clicking the already-active thumb in the built-in controls toggles the rating off and calls `feedback(null)`; a custom row can clear feedback the same way by calling `feedback(null)`. `actions.defaultRender()` renders the built-in control row exactly as `defaultRender()` would.

The built-in inline editor owns edit trimming: when it saves, `edit` (and the underlying `onEdit`) receives a non-empty trimmed string, and an all-whitespace edit cancels instead of firing the callback. This holds for both default rendering and custom `renderMessage` rows, so optimistic UI can use the value directly. A fully custom editor that calls `ctx.actions.edit` itself is responsible for its own trimming.

#### Editing inside a custom row

`ctx.actions.defaultRender()` swaps the action row out for the built-in inline editor while editing is active, then restores keyboard focus to the originating Edit button after Save or Cancel (including Escape). To keep that contract working in a custom row, the renderer needs to hide its own bubble/content while editing so the editor replaces the original message instead of rendering alongside it:

- The exported `<MessageBubble>` already opts in automatically — it reads `ctx.isEditing` from context and returns `null` while its own message is being edited, so the README pattern (`<MessageBubble />` + `ctx.actions.defaultRender()`) needs no extra wiring.
- The built-in `ctx.defaultRender()` row drives `ctx.isEditing` too — clicking its own Edit button flips the context flag, so `{!ctx.isEditing && <MyBubble />}{ctx.defaultRender()}` hides the custom content instead of stacking it above the row's inline editor.
- Custom DOM rows should gate their content on `ctx.isEditing`, e.g. `{!ctx.isEditing && <MyBubble message={msg} />}`. While `ctx.isEditing` is true, render only `ctx.actions.defaultRender()` (or your own editor) for that message.

```tsx
renderMessage={(msg, ctx) => (
  <div {...ctx.messageProps} className="my-row">
    {!ctx.isEditing && <MyBubble message={msg} streaming={ctx.isStreaming} />}
    {ctx.actions.defaultRender()}
  </div>
)}
```

For fully custom DOM rows, spread `ctx.messageProps` on the outer element you want `ChorusRef.scrollToMessage(id)` to target. Chorus automatically adds those props to a single DOM element returned directly from `renderMessage`, but spread them yourself when returning a fragment or custom component. Built-in `ctx.defaultRender()` and `<MessageBubble>` already include a scroll target.

```tsx
<Chorus
  messages={messages}
  hiddenRoles={['system']} // show tool calls while still hiding system prompts
  renderMessage={(msg, ctx) => {
    if (msg.role === 'tool') {
      return (
        <div key={msg.id} {...ctx.messageProps} className="my-tool-step">
          <strong>{msg.toolCall.name}</strong>
          <pre>{JSON.stringify(msg.toolCall.output, null, 2)}</pre>
        </div>
      );
    }

    if (msg.role === 'assistant') {
      return (
        <>
          <MessageBubble message={msg} streaming={ctx.isStreaming} />
          {ctx.actions.defaultRender()}
        </>
      );
    }

    return null; // use default rendering for other messages
  }}
/>
```

Or use the exported `<ToolCallBlock>` component directly in your own layout:

```tsx
import { ToolCallBlock } from 'react-chorus';

<ToolCallBlock toolCall={{ name: 'read_file', input: { path: '/etc/hosts' }, output: '127.0.0.1 localhost' }} />
```

### `MessageBubble` component

`MessageBubble` renders the default bubble for a single message, including attachments. Import it to use as a base when you only need to add decoration (avatars, timestamps, status badges) around the existing look. It respects `headless` mode by forwarding `headless` to Markdown.

```tsx
import { MessageBubble } from 'react-chorus';

// props
interface MessageBubbleProps<TMeta = Record<string, unknown>> {
  message: Message<TMeta>;     // the message to render, including attachments
  className?: string;          // merged onto the outer .chorus-msg element
  style?: React.CSSProperties; // merged onto the outer .chorus-msg element
  codeTheme?: 'dark' | 'light'; // defaults to 'dark'
  headless?: boolean;          // forwards headless mode to Markdown; defaults to false
  streaming?: boolean;         // forwards Markdown's escaped plain-text streaming mode
  markdownProps?: MessageMarkdownProps;
  markdownSanitizer?: MarkdownSanitizer;
  before?: React.ReactNode;      // rendered before .chorus-msg-content (for avatars)
  headerSlot?: React.ReactNode;  // rendered above .chorus-bubble inside .chorus-msg-content
  footerSlot?: React.ReactNode;  // rendered below .chorus-bubble inside .chorus-msg-content
  after?: React.ReactNode;       // rendered after .chorus-msg-content
}
```

Example — custom bubble color per role without changing layout:

```tsx
<MessageBubble
  message={message}
  className="my-bubble"
  style={{ opacity: message.role === 'assistant' ? 0.9 : 1 }}
/>
```

Example — add decoration slots while preserving the default bubble and action layout:

```tsx
<MessageBubble
  message={message}
  before={<Avatar role={message.role} />}
  headerSlot={<span>{message.role === 'user' ? 'You' : 'Assistant'} · 14:32</span>}
  footerSlot={<span>{message.metadata?.model}</span>}
/>
```

When you only need slots around the built-in renderer from `renderMessage`, call `ctx.defaultRender({ before, headerSlot, footerSlot, after })` and return it.

### Default renderer

When neither `renderMessage` nor a custom `MessageBubble` is used, each message renders as:

```html
<div class="chorus-msg chorus-{role}" data-chorus-message-id="...">
  <span class="chorus-sr-only">User message</span>
  <div class="chorus-msg-content">
    <details class="chorus-reasoning"><!-- optional reasoning trace --></details>
    <div class="chorus-bubble"><!-- attachments + Markdown content --></div>
    <div class="chorus-actions"><!-- optional action buttons --></div>
  </div>
</div>
```

`<MessageBubble message={message} />` uses the same `.chorus-msg > .chorus-msg-content > .chorus-bubble` structure, so it preserves the default message width and role alignment when used from `renderMessage`.

Each built-in row and `<MessageBubble>` includes a visually hidden `.chorus-sr-only` speaker label (`User message`, `Assistant message`, `System message`, or `Tool message`) so screen readers announce who spoke without changing the visual layout.

`.chorus-actions` is hover-revealed on pointer devices but switches to always-visible under `@media (hover: none), (pointer: coarse)` so touch users can still discover Copy/Edit/Regenerate/Delete/Feedback. Set `alwaysShowMessageActions` on `<Chorus>` (or apply `.chorus--always-show-actions` to the root yourself) to keep actions visible on hover-capable devices too.

Target these classes in your CSS to restyle without a render prop:

```css
.chorus-msg.chorus-user   .chorus-bubble { background: #0070f3; color: #fff; }
.chorus-msg.chorus-assistant .chorus-bubble { background: #f0f0f0; color: #111; }
```

Reasoning blocks reuse existing palette variables (`--chorus-chat-bg`, `--chorus-chat-text`, `--chorus-border`, `--chorus-action-text`, and hover tokens), so they follow your `<Chorus palette={…}>` theme automatically.

### CSS custom properties for tool blocks

Built-in tool call blocks can be themed through palette keys (`toolBorder`, `toolHeaderBg`, `toolHeaderText`, `toolHeaderHover`, `toolNameText`, `toolBodyBg`, `toolLabelText`, `toolCodeText`, and `toolRunningText`). For advanced CSS-only overrides, use the underlying CSS variables directly:

```css
:root {
  --chorus-tool-border: #333;
  --chorus-tool-header-bg: #1a1a1a;
  --chorus-tool-header-text: #999;
  --chorus-tool-header-hover: #222;
  --chorus-tool-name-text: #e6edf3;
  --chorus-tool-body-bg: #111;
  --chorus-tool-label-text: #666;
  --chorus-tool-code-text: #e6edf3;
  --chorus-tool-running-text: #a3a3a3; /* "Running…" status while a call is in flight */
}
```

## Theming

Theming is a single mechanism: a **`palette`** object that maps to `--chorus-*` CSS custom properties. Every exported root component — `Chorus`, `ChatWindow`, `ChatInput`, and `ConversationList` — accepts a `palette` prop and writes those variables onto its own root element. `<ChorusTheme>` is the same mechanism without a component: a bare `<div>` that carries the variables for any subtree, handy when you compose the pieces yourself.

```tsx
// Full widget — theme it directly.
<Chorus
  palette={{
    chatBg: '#0f0f0f',
    assistantBubbleBg: '#6366f1',
    assistantText: '#ffffff',
    userBubbleBg: '#e5e7eb',
    toolHeaderBg: '#18181b',
    toolNameText: '#f4f4f5',
  }}
  onSend={…}
/>

// Composed shell — theme each piece via its own `palette` prop…
<ChatWindow messages={messages} palette={{ chatBg: '#0f0f0f' }} />
<ChatInput value={value} onChange={setValue} onSend={onSend} palette={{ inputBg: '#1a1a1a' }} />

// …or wrap the whole subtree once with <ChorusTheme>.
<ChorusTheme palette={{ chatBg: '#0f0f0f', inputBg: '#1a1a1a' }}>
  <ChatWindow messages={messages} />
  <ChatInput value={value} onChange={setValue} onSend={onSend} />
</ChorusTheme>
```

A per-component `palette` prop and a `<ChorusTheme palette={…}>` wrapper are interchangeable: both emit the same `--chorus-*` variables, only the DOM element they land on differs. The `palette` is applied the same way on the default and `react-chorus/headless` exports — `headless` controls injected `<style>` tags and code-block chrome, not the host-supplied theme.

### Theming precedence

Theming resolves through the **standard CSS custom-property cascade** — there is no JavaScript-level merge between layers. `styleVarsFromPalette` only emits a variable for a palette key you actually set, so resolution is *per variable*:

1. The **nearest ancestor — or the element itself — that sets a given `--chorus-*` variable wins.** A component's own `palette` prop sits closest to its own DOM, so it overrides an ancestor `<ChorusTheme>` or `<Chorus palette>` for the keys it defines — but only those keys; keys it omits keep inheriting from the ancestor.
2. **Host CSS variables** (e.g. `--chorus-chat-bg` declared on `:root` or any ancestor in your own stylesheet) join the same cascade. A closer `palette`/`ChorusTheme` overrides them; they in turn override the bundled defaults.
3. The **bundled stylesheet defaults** (the `var(--chorus-chat-bg, #161616)` fallbacks in `Chorus.css`) apply when nothing else sets the variable.

So `<ChorusTheme palette={A}><Chorus palette={B} /></ChorusTheme>` renders `<Chorus>` with `B` winning, falling back to `A` for any key `B` omits, then to host CSS variables, then to the built-in defaults.

Available palette keys: `chatBg`, `chatText`, `border`, `assistantBubbleBg`, `assistantText`, `assistantBorder`, `userBubbleBg`, `userText`, `userBorder`, `inputAreaBg`, `inputBg`, `inputText`, `inputBorder`, `sendButtonBg`, `sendButtonText`, `focusRing`, `actionText`, `actionHoverBg`, `actionHoverText`, `errorBg`, `errorBorder`, `errorText`, `toolBorder`, `toolHeaderBg`, `toolHeaderText`, `toolHeaderHover`, `toolNameText`, `toolBodyBg`, `toolLabelText`, `toolCodeText`, `toolRunningText`.

### Reduced motion

The bundled stylesheet honors `@media (prefers-reduced-motion: reduce)`: the attachment-upload spinner and the assistant typing dots stop animating (dots remain visible at full opacity), and non-essential hover/focus transitions on the textarea and message-action buttons are disabled. Focus rings remain visible regardless of motion preference. If you replace `Chorus.css` with your own stylesheet or use the `react-chorus/headless` subpath, you are responsible for providing equivalent reduced-motion handling.

### Right-to-left (RTL) locales

The bundled stylesheet uses CSS logical properties (`inset-inline-start` / `inset-inline-end`, `padding-inline-*`, `margin-inline-*`, `text-align: start`) for the composer, sidebar, and tool-call surfaces, so wrapping `<Chorus>` in any ancestor with `dir="rtl"` (or setting `document.documentElement.dir = 'rtl'`) is enough to mirror the layout: the paperclip moves to the visual right, the send button moves to the visual left, textarea padding flips, and conversation list affordances reverse. No new prop is required — Chorus inherits direction from the surrounding DOM. Pair this with `ChorusLabels` to localize the UI strings themselves.

## Individual Components

You can compose the UI from smaller pieces:

```tsx
import { ChatWindow, ChatInput, ChorusTheme, Markdown } from 'react-chorus';
```

- **`<ChatWindow messages={…} typing={…} />`** — renders the scrollable message list with empty-state prompts, a typing indicator, errors, the optional floating jump-to-latest button, and optional `maxRenderedMessages` windowing. It accepts `hiddenRoles?: Role[]` (default `['system', 'tool']`); `showSystemMessages` is deprecated but remains supported as an alias for showing all roles. `showJumpToBottomButton?: boolean` defaults to `!headless` and toggles the floating “Jump to latest” button that surfaces when the user scrolls away from the bottom and new activity arrives — pass `false` to disable it and render your own affordance. Pass `markdownSanitizer`, `markdownProps`, `renderError`, or `renderMessage` to customize built-in rendering. Accepts a `palette` prop (see [Theming](#theming)).
- **`<ChatInput value onSend onStop placeholder sending />`** — the text input, send/stop button, disabled/read-only states, and optional attachment composer (`accept`, paste/drop, limits, cancellable `uploadAttachment`). Accepts a `palette` prop (see [Theming](#theming)). It is `forwardRef`-enabled: pass a `ChatInputHandle` ref to imperatively `focus()` the composer (with optional `ChatInputFocusOptions` caret placement) from a custom shell.
- **`<ChorusTheme palette={…}>`** — applies the `--chorus-*` theme variables to any subtree; the standalone form of the `palette` prop carried by `Chorus`, `ChatWindow`, `ChatInput`, and `ConversationList`. See [Theming](#theming) for the precedence rules.
- **`<Markdown text={…} codeTheme="dark" />`** — standalone markdown renderer with syntax highlighting and copy buttons. It supports `streaming` to render escaped plain text until finalization, `sanitizer` to provide a custom DOMPurify-compatible sanitizer when SSR needs sanitized raw HTML instead of the built-in no-raw-HTML safe mode, `markedOptions`/`markedExtensions` for per-instance parser customization, `onCopyError` for clipboard-copy failures, and `codeBlockCopy` to disable or fully customize the per-code-block copy chrome.
- **`<MessageBubble message={…} />`** — renders the default bubble for one message, including attachments and screen-reader speaker labels. Accepts `className`, `style`, `codeTheme`, `headless`, `streaming`, `markdownProps`, `markdownSanitizer`, and decoration slots (`before`, `headerSlot`, `footerSlot`, `after`) without replacing the full renderer.

### Headless subpath

Import from `react-chorus/headless` when you want semantic markup and behavior without default styling. The headless subpath preserves class names as styling hooks, and its `Chorus`, `ChatWindow`, `MessageBubble`, `ConversationList`, and `Markdown` exports default `headless={true}` so Markdown styles and syntax-highlight theme CSS are not injected unless you explicitly pass `headless={false}`. It re-exports the same public message, attachment, upload, streaming, and persistence types as the root entry point so `ChatInput` handlers can be typed from the subpath alone.

When `headless` is in effect, the `ChatWindow` and `ConversationList` roots also carry a `--headless` modifier class (`chorus-window--headless` and `chorus-conversation-list--headless`) alongside their base class, so a stylesheet can target the headless build specifically (for example, to opt those roots into a custom layout).

Because `showJumpToBottomButton` defaults to `!headless`, the floating jump button is off on the headless exports. Pass `showJumpToBottomButton={true}` to opt the built-in button back in, or leave it off and render your own jump-to-latest UI from the same "auto-scroll paused" + "has unread activity" signals the built-in button reacts to — track them with a scroll listener on the `ChatWindow` ref (the built-in `useAutoScroll` helper compares `scrollHeight - scrollTop - clientHeight` against a 48 px near-bottom threshold and flags unread activity when a new message arrives while paused).

```tsx
import { ChatWindow, ConversationList, Markdown, MessageBubble } from 'react-chorus/headless';

<ChatWindow messages={messages} />
<MessageBubble message={message} />
<ConversationList {...conversations} />
<Markdown text="**unstyled**" />
```

The full set of named exports available from `react-chorus/headless`:

Components (default `headless={true}`):

- `Chorus`, `ChorusHeadless` — `<Chorus>` with `headless` defaulting to true; both names refer to the same component.
- `ChatWindow` — transcript with `headless` default true so Markdown styling is not injected.
- `MessageBubble` — single message bubble with `headless` default true.
- `ConversationList` — sidebar with `headless` default true.
- `Markdown` — Markdown renderer with `headless` default true (no `<style>` tag, no highlight.js theme).

Pass-through components and theming (re-exported from the root barrel):

- `ChatInput`, `ToolCallBlock`, `ChorusTheme`. These are re-exported unchanged — unlike the wrapped components above, they do **not** default `headless={true}`. Only `Chorus`/`ChatWindow`/`MessageBubble`/`Markdown`/`ConversationList` are wrapped with that default. For an unstyled composer or tool-call block, pass `headless` explicitly (e.g. `<ChatInput headless />`, `<ToolCallBlock headless />`).

Hooks:

- `useChorusStream` — core SSE streaming hook for the simple `transport` path.
- `useChorusPersistence` — read/write a single transcript through a `StorageAdapter`.
- `useConversations` — conversation index + per-conversation transcript storage.
- `useChorusTranscriptActions` — headless transcript search / copy-all / export-as helper for a search box, "copy conversation" button, or "download transcript" affordance.

Helpers and constants:

- `createFetchSSETransport`, `createWebSocketTransport` — transport factories.
- `defineTool` — typed tool definition for `<Chorus tools>` + provider request helpers.
- `getConnector`, `createOpenAIConnector` — connector accessors. `getConnector(name, options?)` resolves a built-in connector by name (`'openai'` / `'anthropic'` / `'gemini'` / `'ai-sdk'` / `'auto'`); `createOpenAIConnector(options?)` builds a customized OpenAI connector object.
- `formatAnthropicMessagesBody`, `formatGeminiGenerateContentBody`, `formatOpenAIChatCompletionsBody`, `formatOpenAIResponsesBody`, `toAnthropicMessages`, `toAnthropicMessagesBody`, `toAnthropicTools`, `toGeminiContents`, `toGeminiGenerateContentBody`, `toGeminiTools`, `toOpenAIChatCompletionsBody`, `toOpenAIChatCompletionsMessages`, `toOpenAIChatCompletionsTools`, `toOpenAIResponsesBody`, `toOpenAIResponsesInput`, `toOpenAIResponsesTools` — provider request mappers.
- `ChorusStreamError` — error class thrown by `useChorusStream` and the transport path.
- `DEFAULT_CHORUS_LABELS`, `DEFAULT_ATTACHMENT_LABELS`, `resolveChorusLabels` — built-in localization helpers and label defaults (`DEFAULT_ATTACHMENT_LABELS` is the English `attachments` slice).

Types: every public type re-exported from the root barrel is also importable from `react-chorus/headless` — including `Message`, `AnyChorusMessage`, `UserMessage`, `AssistantMessage`, `SystemMessage`, `ToolMessage`, `Role`, `ToolCall`, `Attachment`, `AttachmentError`, `AttachmentErrorReason`, `AttachmentSource`, `AttachmentUploadResult`, `UploadAttachment`, `UploadAttachmentOptions`, `StorageAdapter`, `ConnectorName`, `Connector`, `ConnectorResult`, `ConnectorToolDelta`, `Transport`, `FetchSSETransportOptions`, `FetchTransportInit`, `WebSocketTransport`, `WebSocketTransportOptions`, `SendCallbacks`, `StreamOptions`, `ChorusProps` (aliased to `ChorusHeadlessProps`), `ChorusRef`, `ChorusSendHelpers`, `ChorusSendPath`, `ChorusOnSend`, `ChorusOnFinish`, `ChorusOnAbort`, `ChorusOnStreamDone`, `ChorusOnToolCall`, `ChorusOnToolDelta`, `ChorusAbortContext`, `ChorusAbortReason`, `ChorusAbortSource`, `ChorusFinishContext`, `ChorusStreamDoneContext`, `ChorusStreamDoneReason`, `ChorusToolCallContext`, `ChorusToolDeltaContext`, `ChorusToolLoopContext`, `ChorusToolRegistry`, `ChorusToolHandler`, `ChorusConfirmClearConversation`, `ChorusClearConversationContext`, `ChorusConfirmDeleteMessage`, `ChorusDeleteMessageContext`, `ChorusShouldContinueToolLoop`, `ChorusMessagesChangeContext`, `ChorusMessagesChangeReason`, `ChorusMessagesChangeSource`, `ChorusToolDefinition`, `RenderErrorContext`, `RenderMessageContext`, `RenderMessageRootProps`, `MessageBubbleProps`, `MessageBubbleSlots`, `MessageMarkdownProps`, `MessageRenderActions`, `MessageTimestampFormatter`, `MessageCopyResult`, `MessageFeedback`, `GetMessageFeedback`, `ChatInputProps`, `ChatInputHandle`, `ChatInputFocusOptions`, `ChatWindowProps`, `ConversationListProps`, `ConfirmDeleteConversation`, `ConfirmDeleteConversationContext`, `ConversationStorageError`, `ConversationStorageOperation`, `ConversationSummary`, `RenameFromFirstMessageOptions`, `UseConversationsOptions`, `UseConversationsResult`, `ChorusPersistenceError`, `PersistenceOperation`, `PersistenceWriteOptions`, `SerializeMessages`, `DeserializeMessages`, `UseChorusPersistenceOptions`, `UseChorusPersistenceResult`, `ChorusTranscriptActions`, `ChorusTranscriptActionsOptions`, `TranscriptExportFormat`, `RenderAttachmentErrorContext`, `Palette`, `MarkdownProps`, `MarkdownSanitizer`, `CodeBlockCopy`, `CodeBlockCopyContext`, `CodeBlockCopyRenderer`, all `ChorusLabels` sub-shapes, and every provider request type (`AnthropicMessagesBody`, `AnthropicTool`, `OpenAIChatCompletionsBody`, `GeminiGenerateContentBody`, etc.).

## Message Shape

```ts
type Role = 'user' | 'assistant' | 'system' | 'tool';

interface ToolCall {
  id?: string; // provider/tool-call id when exposed by the connector
  name: string;
  input?: unknown;
  output?: unknown;
}

interface Attachment {
  name: string;
  type: string;
  data: string; // data URL by default; custom uploadAttachment may store a URL/file id here
  size: number;
  url?: string;
  id?: string;
  metadata?: Record<string, unknown>;
}

interface MessageBase<TMeta = Record<string, unknown>> {
  id: string;
  metadata?: TMeta; // optional typed data (timestamps, model, latency, etc.)
}

interface UserMessage<TMeta = Record<string, unknown>> extends MessageBase<TMeta> {
  role: 'user';
  text: string; // supports CommonMark + GFM
  reasoning?: string;
  attachments?: Attachment[]; // populated by <ChatInput accept="..." />
  toolCall?: never;
}

interface AssistantMessage<TMeta = Record<string, unknown>> extends MessageBase<TMeta> {
  role: 'assistant';
  text: string;
  reasoning?: string; // optional thinking/reasoning trace rendered in a collapsed details block
  attachments?: Attachment[];
  toolCall?: never;
}

interface SystemMessage<TMeta = Record<string, unknown>> extends MessageBase<TMeta> {
  role: 'system';
  text: string;
  reasoning?: string;
  attachments?: never;
  toolCall?: never;
}

interface ToolMessage<TMeta = Record<string, unknown>> extends MessageBase<TMeta> {
  role: 'tool';
  text?: string; // optional for pure tool calls/results
  reasoning?: string;
  attachments?: never;
  toolCall: ToolCall;
}

type AnyChorusMessage<TMeta = Record<string, unknown>> =
  | UserMessage<TMeta>
  | AssistantMessage<TMeta>
  | SystemMessage<TMeta>
  | ToolMessage<TMeta>;

type Message<TMeta = Record<string, unknown>> = AnyChorusMessage<TMeta>;
```

`Message` defaults to arbitrary metadata for backwards compatibility. It is a discriminated union, so `message.role === 'tool'` narrows `message.toolCall` to a required `ToolCall`. Pass a type argument when your app stores structured metadata:

```ts
type MyMeta = {
  // ISO strings are safe with built-in JSON persistence.
  timestamp: string;
  model: string;
  latencyMs: number;
};

type ChatMessage = Message<MyMeta>;

const message: ChatMessage = {
  id: '1',
  role: 'assistant',
  text: 'Hello!',
  metadata: {
    timestamp: new Date().toISOString(),
    model: 'gpt-4o-mini',
    latencyMs: 420,
  },
};

const latency = message.metadata?.latencyMs;
```

If you enable built-in persistence, keep metadata/tool payloads JSON-serializable or provide `serializeMessages` / `deserializeMessages`; JSON parsing does not revive `Date` instances or custom classes automatically.

```tsx
<Chorus<{ timestamp: Date }>
  persistenceKey="chat-with-dates"
  deserializeMessages={(raw) => JSON.parse(raw, (key, value) => (
    key === 'timestamp' && typeof value === 'string' ? new Date(value) : value
  ))}
/>
```

The same generic flows through public components and hooks:

```tsx
<Chorus<MyMeta>
  value={messages}
  onChange={(next) => next[0].metadata?.latencyMs}
  renderMessage={(message) => <span>{message.metadata?.model}</span>}
/>
```

The generic `Message` declaration shape is a minor semver-level type declaration change while remaining source-compatible.

## Migration and Upgrading

This section is the canonical place to look up breaking changes and deprecations release-over-release. The matching changelog entries live in [`CHANGELOG.md`](./CHANGELOG.md) — anything labelled "Deprecation candidate" there is documented here with a concrete migration path before it ships as a breaking change.

### Connector public API: `getConnector` is canonical

There is exactly one supported way to obtain a connector. Select a built-in connector **by name** — `connector="openai"` on `<Chorus>`, `{ connector: 'openai' }` on `useChorusStream`, or `getConnector('openai')` for a connector object. Customize it with `connectorOptions` (widget/hook) or the `options` argument of `getConnector`. For a connector object you build yourself, use `createOpenAIConnector(options)` or implement the `Connector` interface directly.

The provider connector singletons (`openaiConnector`, `anthropicConnector`, `geminiConnector`, `aiSdkConnector`) and `autoConnector` are **`@internal`** and are not exported from `react-chorus` or `react-chorus/headless`. They duplicated the string registry — a second public API doing the same job — so the barrel exports only `getConnector` and `createOpenAIConnector`. If a pre-release imported a singleton directly, switch to the equivalent name: `openaiConnector` → `getConnector('openai')`, `anthropicConnector` → `getConnector('anthropic')`, `geminiConnector` → `getConnector('gemini')`, `aiSdkConnector` → `getConnector('ai-sdk')`, `autoConnector` → `getConnector('auto')` (or `getConnector()`).

### Unreleased — upgrade notes

These changes land in the next release off `[Unreleased]`. None break `ChorusProps` or an exported component/hook contract, but two are visible behavior changes worth checking before you upgrade.

#### GFM tables are now styled by the bundled `chorus-md` stylesheet

`marked`'s `gfm: true` already emitted real `<table>` markup, but the injected `chorus-md` sheet only styled code blocks, so Markdown tables rendered as borderless rows of text. The sheet now gives them collapsed borders, 1px cell borders, cell padding, and an emphasized header row. **This is a visible rendering change for every `<Markdown>` / `<Chorus>` consumer that renders tables** — review table-heavy transcripts after upgrading. Two new CSS variables theme the result: `--chorus-md-table-border` (cell border color) and `--chorus-md-table-header-bg` (header row background). Override them alongside the other `--chorus-*` variables (see [Theming](#theming)). The headless build injects no stylesheet, so style tables yourself there.

#### New `ai-sdk` connector

A built-in `'ai-sdk'` connector parses [Vercel AI SDK](#vercel-ai-sdk-stream-format) streams — both the v5+ UI message stream (`toUIMessageStreamResponse()`) and the v4 data-stream protocol (`toDataStreamResponse()`). Select it with `connector="ai-sdk"`, or rely on the default `connector="auto"`, which now detects AI SDK frames too. Like the other built-in connectors it is reachable by name only — there is no exported `aiSdkConnector` singleton; see [Connector public API](#connector-public-api-getconnector-is-canonical).

#### Default error banner gains a dismiss button

The built-in transcript error banner now renders a dismiss (X) button whenever `onDismissError` is wired — which it always is under `<Chorus>`. Consumers using the default error UI (not a custom `renderError`) can now clear the banner without retrying. The new `labels.transcript.dismissError` string localizes its accessible label.

### Unreleased — deprecation candidates

#### Default transport body will drop the `prompt` field

**Status:** still emitted today; planned removal in the next major.

**What ships today.** `createFetchSSETransport` and `createWebSocketTransport` (and the default `transport="/api/chat"` shorthand, which builds a `createFetchSSETransport` internally) all POST/send the body `{ prompt, history }` by default, where `prompt` equals `history[history.length - 1].text`. It is a convenience duplicate of the latest user turn — useful for very small toy backends, redundant for everything else. Every example backend in this repo (`examples/with-openai/server`, `examples/with-next`, the Express/Next.js/Gemini/WebSocket snippets in this README) already reads `history` only and explicitly ignores `prompt`.

**What changes in the next major.** The default request body will be `{ history }` — `prompt` will no longer be present, and the inline comments warning backends not to re-append `body.prompt` will be removed. The `formatBody` override remains the supported escape hatch for any backend that still wants a separate field.

**How to migrate, ahead of the major.** On the server, read `history` (always present today and after the change) and never re-append `req.body.prompt` / `frame.prompt` — the latest user text is `history[history.length - 1].text`. On the client, if you need a custom body shape, pass `formatBody: (text, history) => JSON.stringify({ text, history })` to the transport you're constructing instead of relying on the default. After the major lands, callers reading `req.body.prompt` will see `undefined` and silently send an empty turn to the model, so do this work now if you haven't already.

**Why now.** Bodies have been documented as `{ prompt, history }` since 0.x and a handful of toy backends still echo `prompt`. Keeping the duplicate field on the wire indefinitely is a permanent footgun (the "message sent twice" failure mode that every backend snippet currently warns about) — the deprecation candidate makes the breaking change explicit so apps can move to `{ history }` on their own schedule before the major lands.

> Tracked under the [`[Unreleased]` → Deprecation candidates (future major)](./CHANGELOG.md#deprecation-candidates-future-major) section of the changelog.

## Development and release

Use Node.js 20.19+ or 22.12+ (the floor the root `package.json` `engines.node` and the Vite toolchain both require), then install dependencies with `npm ci`.

Release/CI quality gates:

```bash
npm run lint              # zero warnings enforced
npm run typecheck
npm test
npm run test:coverage    # coverage uses @vitest/coverage-v8
npm run build
npm run verify:bundle-size
npm run build:playground  # includes the playground bundle-size budget
npm run typecheck:consumer
npm run verify:pack
npm run verify:examples   # installs and build-smokes runnable examples
```

`npm run prepublishOnly` runs the package publish gate through build, bundle-size verification, playground size verification, consumer typecheck, package-content verification, and runnable example verification. PR CI also runs `verify:examples` in the Node matrix and the playground build on Node 22 so examples and the GitHub Pages demo cannot regress unnoticed.

## License

MIT
