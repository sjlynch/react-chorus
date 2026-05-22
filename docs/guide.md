# Usage guide

How to send messages, stream responses, and parse provider formats with react-chorus.

- [Two usage paths](#two-usage-paths) — the `transport` prop, the `onSend` callback, and auth headers
- [Using the WebSocket transport](#using-the-websocket-transport)
- [Provider request/body helpers](#provider-requestbody-helpers)
- [Connectors](#connectors)
- [Named SSE events](#named-sse-events)
- Streaming formats — [OpenAI](#openai-sse-format) · [Anthropic](#anthropic-sse-format) · [Gemini](#gemini-sse-format) · [Vercel AI SDK](#vercel-ai-sdk-stream-format)

See also the [API reference](api.md), [deployment notes](deployment.md), and the [`/examples`](../examples) directory.

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

Both paths render the same transcript, so the headless [`useChorusTranscriptActions`](api.md#transcript-search-copy-and-export) hook — transcript-wide search, copy-conversation, and Markdown/JSON export — works the same whether you drive Chorus with `transport` or `onSend`.

### Next.js App Router route handler

For a production Next.js app, keep `OPENAI_API_KEY` on the server and expose an App Router route handler that speaks SSE to Chorus. Install `openai` in your app for this variant. A runnable version lives in [`examples/with-next`](../examples/with-next).

```ts
// app/api/chat/route.ts
import OpenAI from 'openai';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import { toOpenAIChatCompletionsBody } from 'react-chorus/provider-requests';
import { encodeSSEDone, encodeSSEError, encodeSSEEvent, sseHeaders } from 'react-chorus/server';
import type { Message } from 'react-chorus';

export const runtime = 'nodejs'; // pin the Node.js runtime; the official OpenAI Node client does not run on the Edge runtime
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
- Image attachments are sent as data URLs in the JSON `history` unless you provide a custom upload flow. Vercel/serverless request body limits (commonly around 4.5 MB) can be hit quickly, and App Router route handlers do not have Express-style `json({ limit })`. Keep `maxAttachmentBytes` below your host limit, compress images, or upload large files to object storage and send URLs instead — see the [out-of-band attachment uploads recipe](uploads.md) for a runnable `uploadAttachment` → object-storage → provider-file-id flow.

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
      {connectionStatus.startsWith('disconnected') && <div role="alert">Disconnected</div>}
      {connectionStatus === 'error' && <div role="alert">Connection error</div>}
      <Chorus
        value={messages}
        onChange={setMessages}
        sending={sending}
        onSend={async (text, msgs, helpers) => {
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

The `onOpen`/`onClose`/`onError` lifecycle callbacks above feed a small connection-status banner; the runnable [`examples/with-websocket`](../examples/with-websocket) app wires the same pattern. Note there is no `'connecting'` state here on purpose — in the default per-send-socket mode (below) a socket opens and `onOpen` fires almost immediately, so a transient "Connecting…" banner would never actually be visible. A normal close reports code `1000`, which is why only an abnormal close or a socket error surfaces a banner. Connection status is most meaningful in `{ persistent: true }` mode, where one socket stays open across sends.

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

> **Runnable example:** [`examples/with-websocket`](../examples/with-websocket) wires `createWebSocketTransport` to a tiny local `ws` server that streams canned Claude-style frames, so you can see this recipe end-to-end without an API key — and its README shows the one-line swap to the real Anthropic backend above.

## Provider request/body helpers

Connectors parse provider streams on the way back; request helpers serialize Chorus `Message[]` on the way out. Use them on your server proxy (recommended) or as `createFetchSSETransport(..., { formatBody })` body formatters when posting to your own backend.

```ts
import {
  formatAiSdkModelMessagesBody,
  formatAnthropicMessagesBody,
  formatGeminiGenerateContentBody,
  formatOpenAIChatCompletionsBody,
  formatOpenAIResponsesBody,
  toAiSdkModelMessages,
  toAiSdkModelMessagesBody,
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
| `toAiSdkModelMessages(history, opts)` / `toAiSdkModelMessagesBody(history, opts)` / `formatAiSdkModelMessagesBody(opts)` | AI SDK `ModelMessage[]` (or `{ messages, ...opts }`) | Maps Chorus `system`, `user`, `assistant`, and `tool` rows to Vercel AI SDK model messages for `streamText({ messages })`. Tool rows become paired assistant `tool-call` parts plus `tool` `tool-result` parts, preserving `metadata.aiSdk.toolCallId` (or `toolCall.id`) when present and synthesizing a stable in-request id otherwise; `metadata.aiSdk.isError` / top-level `isError` maps tool outputs to AI SDK error output parts. Data-URL user attachments map to AI SDK `image` / `file` parts, absolute `http(s)` URLs map to `URL` data content, and unsupported sources fall back to explicit text notes with a dev-mode warning. |

All helpers preserve extra provider options you pass (for example `model`, `max_tokens`, `generationConfig`, `tools`) and default OpenAI/Anthropic `stream` to `true`. They insert explicit text fallbacks for unsupported attachments so request mapping failures are visible to the model instead of silently dropping context. Override that text with `unsupportedAttachmentText` when needed.

Keep provider API keys on the server. Browser code may use the `format*Body` helpers to post provider-shaped JSON to your own `/api/chat` proxy, but it should not call OpenAI, Anthropic, or Gemini directly with secret keys.

## Connectors

Connectors tell Chorus how to parse the streaming response from different AI providers. Pass a connector name or object via the `connector` prop on `<Chorus>` or the `connector` option on `useChorusStream`.

### Obtaining a connector

A connector name (`'openai'`, `'anthropic'`, `'gemini'`, `'ai-sdk'`, `'auto'`) is the canonical way to select a built-in connector — pass it as `connector` and Chorus resolves it internally. To customize a built-in connector, pass `connectorOptions` alongside the name (see [Custom reasoning tag pair](#custom-reasoning-tag-pair)).

If you need a connector *object* — to write a custom connector, or to pass one to a hand-rolled `useChorusStream`/`onSend` client — use the two exported accessors:

- **`getConnector(name, options?)`** resolves a built-in connector by name, applying `options` (currently `{ thinkTag }` for `'openai'`). `getConnector()` with no argument returns the auto-detecting connector.
- **`createOpenAIConnector(options?)`** builds a customized OpenAI connector object directly.

The provider connector objects themselves (`openaiConnector`, `anthropicConnector`, etc.) are internal: select them by name instead. See [Migration and Upgrading](migration.md) for the rationale.

### Built-in connectors

| Name | Provider | SSE format |
|------|----------|------------|
| `'openai'` | OpenAI Chat Completions / Responses-compatible streams | selected `choices[0].delta.content`, reasoning fields, `tool_calls`, common Responses API deltas, and Responses output-text annotations as sources |
| `'anthropic'` | Anthropic Messages API | `content_block_delta` text/thinking deltas plus `tool_use` / `input_json_delta`, web-search and document `citations_delta` events, and `web_search_tool_result` content blocks as sources |
| `'gemini'` | Google Gemini (AI / Vertex AI) | selected `candidates[0].content.parts[*].text`, thought parts, `functionCall` parts, plus `groundingMetadata.groundingChunks` and `citationMetadata.citationSources` / `citations` as sources |
| `'ai-sdk'` | Vercel AI SDK (`toUIMessageStreamResponse` / `toDataStreamResponse`) | `text-delta` / `reasoning-delta` / `source-url` / `source-document` / `tool-input-*` / `tool-output-*` JSON events, plus prefix-coded data-stream frames (`0:"..."`, `g:"..."`, `j:{...}` sources, `7:`/`8:` source-like annotations, `9:{...}`, `c:{...}`, `a:{...}`, `d:`/`e:` finish, `3:"..."` error) |
| `'auto'` *(default)* | Auto-detect | Tries OpenAI, then Gemini, known Anthropic events, known Vercel AI SDK events (UI-message-stream JSON and data-stream prefix lines), generic JSON text fields (`text`/`content`/`delta`), then raw plain text |

#### Connector source/citation support matrix

All four built-in connectors emit `MessageSource` entries — see [`MessageSource`](api.md#messagesource) for the field semantics and JSON-persistence contract.

| Connector | Source/citation events parsed | `MessageSource` fields populated |
|-----------|-------------------------------|----------------------------------|
| `'openai'` | Responses API `response.output_text.annotation.added` (and annotations on `response.output_text.done`) — `url_citation`, `file_citation`, `file_path`, `container_file_citation` | `id`, `type`, `title`, `url`, `snippet`, `metadata.provider = 'openai'`, plus `annotationType`/`startIndex`/`endIndex`/`fileId`/`containerId` |
| `'anthropic'` | `content_block_delta` with `citations_delta` (`char_location`, `page_location`, `content_block_location`, `web_search_result_location`); `content_block_start` for `web_search_tool_result` blocks; text-block seeded `citations` arrays | `id` (provider url or `documentTitle#documentIndex`), `type` (`url` for web/web-search results, `document` otherwise), `title`, `url`, `snippet` (Anthropic `cited_text`), `metadata.provider = 'anthropic'`, plus `citationType`/`documentIndex`/`documentTitle`/`startCharIndex`/`endCharIndex`/`startPageNumber`/`endPageNumber`/`startBlockIndex`/`endBlockIndex`/`encryptedIndex`/`toolUseId`/`pageAge`/`encryptedContent` |
| `'gemini'` | `candidates[].groundingMetadata.groundingChunks` (Google Search grounding `web` and Vertex `retrievedContext`); `candidates[].citationMetadata.citationSources` or `citations` (training-source attribution) | `id` (uri or derived), `type: 'url'`, `title`, `url`, `metadata.provider = 'gemini'`, plus `chunkKind`/`chunkIndex` for grounding chunks and `citationKind`/`startIndex`/`endIndex`/`license`/`publicationDate` for citations |
| `'ai-sdk'` | UI-message-stream `source-url` / `source-document` and source-like `message-metadata`; data-stream `j:` source frames and source-like `7:` / `8:` annotations | `id`, `type`, `title`, `url`, `snippet`, `metadata.provider = 'ai-sdk'`, plus passthrough `mediaType`/`filename`/`page` |

All connectors derive stable ids (provider id where available, otherwise URL or location-derived) so `appendMessageSource` dedups duplicate streamed frames across deltas and across resumed connections. Sources never become assistant text and never block the stream: the default renderer shows them as a `Sources` footer, `useChorusTranscriptActions` includes them in search/export/copy, and built-in JSON persistence round-trips the whole array.

All built-in connectors also recognise in-band stream errors. If a backend has already started a `200` SSE/WebSocket stream, send `data: {"error":"message"}` (or `{"error":{"message":"message"}}`) to abort the response, call `onError` with an `Error`, and show the configured error banner. Unknown JSON events with a `type` field are no longer assumed to be Anthropic; `{ "type": "delta", "text": "hi" }` renders `hi`, and unknown JSON without a text-like field falls back to the raw payload string.

Built-in connectors emit four additive delta types:

- `text` appends to the active assistant bubble.
- `reasoning` appends to `message.reasoning` and renders as a collapsed **Reasoning** details block above the assistant bubble.
- `source` / `sources` append to `message.sources` and render as a **Sources** footer; transcript search, per-message copy, copy-all, and Markdown/JSON export include title/url/snippet.
- `toolDelta` becomes/updates a `role: 'tool'` message with `message.toolCall`, so the existing `<ToolCallBlock>` renderer shows streaming tool calls automatically in `<Chorus>`. Providers can emit multiple tool calls in one event via `toolDeltas`; the singular `toolDelta` is still populated with the first call for compatibility.

Custom connectors can return the same shape:

```ts
type ConnectorResult = {
  text?: string;
  reasoning?: string;
  source?: MessageSource;
  sources?: MessageSource[];
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

For OpenAI Responses API-style streams, common `response.output_text.delta`, `response.reasoning_summary_text.delta`, `response.output_item.added`, and `response.function_call_arguments.delta` events are also recognised. `response.output_text.annotation.added` (and annotations on `response.output_text.done`) become `MessageSource` entries on the assistant message instead of raw protocol text.

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

Anthropic citations also flow through this connector. `content_block_delta` events whose `delta.type === 'citations_delta'` (web-search results, document char/page/content-block citations, and code-execution citations) become `MessageSource` entries on the active assistant message — the citation's `cited_text` lands on `source.snippet`, `url`/`title` populate the link, and the original location offsets (char/page/block indexes, `encrypted_index`, `document_index`, `document_title`) are preserved on `source.metadata` so callers can re-anchor citations to source text. `content_block_start` events whose `content_block.type === 'web_search_tool_result'` expand to one source per `web_search_result` entry in the block's `content` array — the encrypted result body stays in `metadata.encryptedContent` instead of leaking into the assistant text.

> **Runnable example:** [`examples/with-anthropic`](../examples/with-anthropic) drives the `anthropic` connector from a built-in mock that streams the events above, so it runs with no API key; its README documents the matching Express + `@anthropic-ai/sdk` proxy.

## Gemini SSE format

The Google Gemini streaming API (Google AI and Vertex AI) sends server-sent events where each chunk contains a `candidates` array. The `'gemini'` connector reads only candidate index `0`, collects text from `content.parts[*].text`, maps `thought: true` text/thinking fields to reasoning, maps every `functionCall` part to a tool message, and signals completion for normal `STOP` / `MAX_TOKENS` finish reasons:

```
data: {"candidates":[{"index":0,"content":{"parts":[{"text":"Thinking","thought":true}]}}]}

data: {"candidates":[{"index":0,"content":{"parts":[{"functionCall":{"name":"search","args":{"q":"react-chorus"}}}]}}]}

data: {"candidates":[{"index":0,"content":{"parts":[{"text":"Hello world"}]},"finishReason":"STOP"}],"usageMetadata":{...}}
```

Gemini `functionCall.name` maps to `toolCall.name`, `functionCall.args` maps to `toolCall.input`, and the connector generates a stable tool delta id from the candidate/part index when Gemini does not provide one.

Grounding and citation sources are also surfaced. `candidates[0].groundingMetadata.groundingChunks` entries (Google Search grounding's `{ web: { uri, title } }` and Vertex AI's `{ retrievedContext: { uri, title } }`) become `MessageSource` entries on the active assistant message, and so does each `candidates[0].citationMetadata.citationSources` (or the alternative `citations`) entry — including its `startIndex`/`endIndex`/`license`/`publicationDate` on `source.metadata`. Sources are extracted whether they arrive on a mid-stream text chunk or on the terminal `finishReason: STOP` frame (whose `content.parts` is empty), and `appendMessageSource` dedups repeated grounding chunks across cumulative chunks via the chunk URI.

> **Runnable example:** [`examples/with-gemini`](../examples/with-gemini) drives the `gemini` connector from a built-in mock that streams the `candidates` chunks above, so it runs with no API key; its README documents the matching Express + `@google/generative-ai` proxy.

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

- **UI message stream** (`result.toUIMessageStreamResponse()`, AI SDK v5+) is already SSE-formatted, so `createFetchSSETransport` and the default `transport="/api/chat"` shortcut work without any extra wiring. Each frame is a JSON object such as `{"type":"text-delta","id":"...","delta":"hi"}`, `{"type":"source-url","sourceId":"...","url":"https://...","title":"Docs"}`, or `{"type":"tool-input-available","toolCallId":"...","toolName":"...","input":{...}}`. The connector maps `text-delta` to assistant text, `reasoning-delta` to reasoning, `source-url` / `source-document` (and source-like `message-metadata`) to `message.sources`, `tool-input-*` / `tool-input-available` / `tool-output-available` to streaming tool messages, `finish` / `finish-message` to done, and `{"type":"error","errorText":"..."}` to the in-band error path. Lifecycle frames such as `start`, `start-step`, `text-start`, `text-end`, `reasoning-start`, `reasoning-end`, and `finish-step` are silently ignored so the user never sees protocol text.
- **Data-stream protocol** (`result.toDataStreamResponse()`, AI SDK v4) emits prefix-coded lines like `0:"hi"`, `g:"considering"`, `j:{...}` (sources), `9:{...}`, `c:{...}`, `a:{...}`, `d:{...}`, `e:{...}`, and `3:"error message"`. The pipeline expects each frame to arrive as the value of an SSE `data:` field, so wrap each line as `data: <line>\n\n` when streaming the AI SDK response yourself (one-line server snippet below). Source-like `7:`/`8:` annotations are attached to `message.sources`; other data/annotation/lifecycle frames (`1`, `2`, `f`, `h`, `i`) are ignored.

### Vercel AI SDK with Next.js App Router (UI message stream — recommended)

```ts
// app/api/chat/route.ts
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';
import type { Message } from 'react-chorus';
import { toAiSdkModelMessages } from 'react-chorus/provider-requests';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json()) as { history?: Message[] };
  const history = Array.isArray(body.history) ? body.history : [];

  const result = streamText({
    model: openai('gpt-4o-mini'),
    // Preserves Chorus systemPrompt/system rows, tool calls/results, and supported attachments.
    messages: toAiSdkModelMessages(history),
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
import type { Message } from 'react-chorus';
import { toAiSdkModelMessages } from 'react-chorus/provider-requests';

export async function POST(request: Request) {
  const body = (await request.json()) as { history?: Message[] };
  const history = Array.isArray(body.history) ? body.history : [];
  const result = streamText({
    model: openai('gpt-4o-mini'),
    messages: toAiSdkModelMessages(history),
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

> **Runnable example:** [`examples/with-vercel-ai-sdk`](../examples/with-vercel-ai-sdk) drives the `ai-sdk` connector from a built-in mock that streams UI-message-stream frames, so it runs with no API key; its README documents the matching Next.js App Router route shown above.
