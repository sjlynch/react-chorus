# Usage guide

How to send messages, stream responses, and parse provider formats with react-chorus.

- [Two usage paths](#two-usage-paths) — the `transport` prop, the `onSend` callback, and auth headers
- [Changing the system prompt at runtime](#changing-the-system-prompt-at-runtime) — multi-persona toggles, per-conversation prompts, regenerate semantics
- [Using the WebSocket transport](#using-the-websocket-transport)
- [Server-side history pre-load](#server-side-history-pre-load) — Next.js / SSR loaders → `initialMessages` + `persistenceKey`
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

`systemPrompt` is prepended to the request `history` sent through the `transport` prop but is not rendered in the transcript. On the advanced `onSend` path, Chorus does not mutate the `messages` array; read the same value from `helpers.systemPrompt` when building your custom request. To swap the prompt at runtime — multi-persona toggles, per-conversation prompts, localized system text — see [Changing the system prompt at runtime](#changing-the-system-prompt-at-runtime).

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

## Changing the system prompt at runtime

`systemPrompt` is a regular React prop, so swapping its value on a re-render is supported. Common drivers are a user-toggleable persona (Support vs. Sales), a per-conversation prompt loaded with `persistenceKey`, or a localized prompt that follows the UI language. This section spells out exactly when a new value takes effect, how Regenerate interacts with a swap, and how the synthetic system message coexists with a host-supplied `role: 'system'` row in `value` / `initialMessages`.

### Synthetic system message contract

When `systemPrompt` is set, Chorus injects a single synthetic message into outbound request `history`:

```ts
{ id: RESERVED_SYSTEM_PROMPT_ID, role: 'system', text: systemPrompt }
```

- The id is exported from `react-chorus`, `react-chorus/server`, and `react-chorus/provider-requests` so request mappers, proxies, and tests can recognise the Chorus-injected row without hard-coding the literal. Host-authored messages must not reuse this id.
- The synthetic message is **never stored on the transcript.** It is built fresh from `systemPrompt` at the moment a turn is dispatched and prepended to the `history` argument that `transport`'s `formatBody` / `createFetchSSETransport` sees. It does not flow through `value` / `onChange` / `onMessagesChange` and it is not persisted by `persistenceKey`.
- Only the simple `transport` path mutates `history`. On the `onSend` path Chorus leaves `messages` alone — read the current prompt from `helpers.systemPrompt` and decide how to merge it yourself (the `onSend` snippet above shows the canonical "skip if a host system message already exists" guard).

### When a swapped value takes effect

`systemPrompt` is read at send time, not render time, through a latest-ref. Concretely:

- Changing `systemPrompt` and re-rendering does **not** retroactively rewrite past turns. The transcript is unchanged and no extra request goes out.
- The very next turn dispatched after the swap — whether triggered by Send, retry after an error, or Regenerate — uses the new value. Earlier assistant messages stay rendered exactly as the server originally produced them.
- This applies on both paths. Built-in `transport` reads the latest `systemPrompt` when building request `history`; `onSend` reads it from `helpers.systemPrompt` on every invocation.

In other words: think of `systemPrompt` as configuration for the *next* outbound request, not as a piece of conversation state. If you need a system instruction that is itself a permanent part of the transcript (visible to the user, included in copy-conversation export, restored from persistence), put a `role: 'system'` row into `value` / `initialMessages` instead — see the precedence rules below.

### Regenerate after a swap

Regenerate (and Retry-on-error) truncate the transcript back to the last user turn and dispatch a fresh request. Because the request is built at dispatch time, **a Regenerate after the prompt swapped uses the new prompt, not the original one.** This is the intended behaviour for the multi-persona / model-switch use case: after the user picks a different persona, the next attempt should reflect that choice. Edit-and-resubmit on an earlier user message behaves the same way.

If you need to preserve the prompt that was actually used for a given assistant response — for audit logs, "Why did the assistant say this?" debugging, evals — record it in `onFinish` / `onStreamDone` (which receive the assistant message) or stamp it into `Message.metadata` inside `onSend` so it travels with the row. The synthetic system message does not carry that history on its own.

### Precedence vs. a host-supplied `role: 'system'` row

Chorus does **not** merge, dedupe, or replace host system rows. If you set `systemPrompt` *and* include a `{ role: 'system', text: ... }` entry in `value` / `initialMessages`, both reach the request `history`: the synthetic message is prepended at index 0, and the host-authored row stays at its original position. What the provider then sees depends on the request mapper:

- `toAnthropicMessagesBody` and `toGeminiGenerateContentBody` join every `role: 'system'` text in history with `\n\n` and emit a single `system` / `systemInstruction`. Both prompts are concatenated, synthetic first.
- `toOpenAIChatCompletionsBody`, `toOpenAIResponsesBody`, and `toAiSdkModelMessages` keep each system row as its own input message, in order. The provider receives two system messages.
- If a caller also passes an explicit `system` (Anthropic) or `systemInstruction` (Gemini) option to the helper, that caller value wins over both history sources and a dev-mode warn-once fires so the dropped history text is observable.

For most apps the merged behaviour is fine — the runtime `systemPrompt` acts as a global preamble while a host-authored `system` row supplies conversation-specific instructions. If you instead need the host row to *replace* the synthetic one (e.g. a per-conversation persona stored alongside messages), drop `systemPrompt` once a host row is present, or filter by `RESERVED_SYSTEM_PROMPT_ID` in a custom `formatBody` / proxy:

```ts
import { createFetchSSETransport, RESERVED_SYSTEM_PROMPT_ID } from 'react-chorus';

const transport = createFetchSSETransport('/api/chat', {
  formatBody: (prompt, history) => {
    const hasHostSystem = history.some(
      (m) => m.role === 'system' && m.id !== RESERVED_SYSTEM_PROMPT_ID,
    );
    const filtered = hasHostSystem
      ? history.filter((m) => m.id !== RESERVED_SYSTEM_PROMPT_ID)
      : history;
    return JSON.stringify({ prompt, history: filtered });
  },
});
```

### Recipe: multi-persona toggle

A minimal persona switcher that compiles against the current public API. The transcript stays intact across persona changes; only the next turn uses the new system prompt.

```tsx
import 'react-chorus/styles.css';
import React from 'react';
import { Chorus } from 'react-chorus';
import type { Message } from 'react-chorus';

const PERSONAS = {
  support: 'You are a calm, concise customer-support assistant. Cite docs when relevant.',
  sales: 'You are an upbeat sales assistant. Highlight value and offer to book a demo.',
} as const;

type PersonaId = keyof typeof PERSONAS;

export default function App() {
  const [persona, setPersona] = React.useState<PersonaId>('support');
  const [messages, setMessages] = React.useState<Message[]>([]);

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <label style={{ padding: 8 }}>
        Persona:{' '}
        <select value={persona} onChange={(e) => setPersona(e.target.value as PersonaId)}>
          <option value="support">Support</option>
          <option value="sales">Sales</option>
        </select>
      </label>
      <Chorus
        value={messages}
        onChange={setMessages}
        transport="/api/chat"
        systemPrompt={PERSONAS[persona]}
      />
    </div>
  );
}
```

Swapping the dropdown re-renders `<Chorus>` with a new `systemPrompt`. Existing rendered messages keep their text. The next Send — and any Regenerate on the most recent user turn — goes out under the newly selected persona.

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

## Server-side history pre-load

The README documents two seed mechanisms in isolation — `initialMessages` (a frozen-at-mount seed) and `persistenceKey` (browser-side storage of follow-up turns). The most common production wiring combines them: a server-rendered route (Next.js App Router `page.tsx`, `getServerSideProps`, Remix `loader`, etc.) fetches the user's conversation from your database, the loader passes that array as `initialMessages`, and `persistenceKey` keeps subsequent edits cached in the browser so a reload between server fetches still shows the in-progress turn.

This recipe lives at the intersection of three subtle behaviors — get one wrong and either the server transcript silently clobbers an in-flight draft, or a stale browser copy clobbers the server transcript. Read the precedence rule below before wiring it up.

### The full recipe

```tsx
// app/c/[id]/page.tsx — server component (no 'use client')
import { loadConversation } from '@/lib/conversations';
import { ChatClient } from './ChatClient';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Server-side fetch. Run inside the request so the transcript is bound to
  // the authenticated user — never trust an id you cannot authorize.
  const initial = await loadConversation(id);
  return <ChatClient conversationId={id} initial={initial} />;
}
```

```tsx
// app/c/[id]/ChatClient.tsx — client component
'use client';
import { Chorus, type Message } from 'react-chorus';

export function ChatClient({ conversationId, initial }: { conversationId: string; initial: Message[] }) {
  return (
    <Chorus
      transport="/api/chat"
      connector="openai"
      // Server-loaded transcript becomes the seed. Captured once at mount —
      // later prop reference changes are ignored (frozen-seed contract).
      initialMessages={initial}
      // Browser-side cache of follow-up turns, scoped to this conversation
      // so different chats never clobber each other.
      persistenceKey={`chorus:c:${conversationId}`}
    />
  );
}
```

### Precedence rule when both seeds are present

When `persistenceKey` is set without `value`, Chorus resolves the displayed transcript in this order on every mount:

1. **A stored payload for this key wins.** If `persistenceStorage.getItem(persistenceKey)` returns a non-empty value, that value is rendered and `initialMessages` is silently dropped from the visible transcript.
2. **No stored payload → `initialMessages` is rendered AND written to storage.** The seed is persisted on first mount so a reload before the user types anything still shows it. From then on, rule 1 applies.
3. **Async adapters block the composer.** While `getItem()` is still resolving the built-in `<Chorus>` shows its loading placeholder ("Loading saved conversation…") and `useChorusPersistence().loaded` is `false`.

The asymmetry in rule 1 is the footgun: once a user has used the app on a given browser, the server-loaded `initialMessages` becomes *only* a fallback for first visits. If the same conversation has new turns from another device, those turns will not appear because the local stored copy is taken to be authoritative. Pick one of the strategies in the next section based on which source you trust.

### Choosing what to trust

| Pattern | When to use | How to wire it |
|---------|-------------|----------------|
| **Cache draft only** | The server is the source of truth and follow-up turns are written to the server when they stream in. Use `persistenceKey` only as a per-load draft cache so a reload mid-turn does not lose the in-flight assistant message. | Scope the key per session: `persistenceKey={`chorus:draft:${conversationId}:${sessionId}`}`. Clear it from `localStorage` after `onFinish` fires (or accept that an old draft eventually rolls off as users start new conversations). |
| **Browser is the source of truth after first load** | Single-device usage; no server writes after the initial load. The fixture-seeded chat in `examples/with-next-resume` is this shape. | The simple recipe above. `initialMessages` seeds, `persistenceKey` takes over from there. |
| **Server is the source of truth** | Multi-device, server writes after every turn. | Drop `persistenceKey` entirely. Drive Chorus in **controlled** mode (`value` + `onChange`) and POST follow-up turns to your own write API in `onChange` / `onFinish`. The frozen-seed precedence rule does not apply because there is no `useChorusPersistence` reading from storage. |
| **Reconcile on mount** | You want a browser draft cache *and* a fresh server fetch to win on reload. | Read the stored payload yourself before mounting, compare to `initial`, and if the server timestamp is newer call `localStorage.removeItem(persistenceKey)` (or your custom adapter's `removeItem`) before rendering `<Chorus>`. |

### SSR and hydration considerations

`<Chorus>` is a client component because it touches `window.localStorage`. The server component above only fetches the transcript and renders the client wrapper — it never imports `react-chorus` directly. Two SSR gotchas to know about:

- **The first paint is empty on async adapters.** With the default synchronous `localStorage` adapter, the stored payload is read during initial render so the client renders the persisted transcript immediately and there is no transcript-shaped hydration mismatch. With an async adapter (IndexedDB, a remote draft API, `Promise`-returning `getItem`), the first client paint shows the loading placeholder and the transcript appears after `getItem()` resolves. Either is fine — just do not expect the server-rendered HTML to include the persisted body.
- **Pass `initialMessages` as a stable prop.** It is captured once at mount; later reference changes are ignored and dev-warned once. In Next.js this means seed it from a server-fetched array that is shaped during the request, not from React state that mutates on the client.

### Pattern: fresh conversations with `useId` / `useEffect`

For a brand-new conversation that has no server-side row yet, the goal is the opposite of the precedence rule above: every fresh mount should start empty, with no risk that a stored payload from an unrelated previous chat is loaded under the same key. Make the persistence key unique to *this* fresh conversation so storage cannot collide:

```tsx
'use client';
import * as React from 'react';
import { Chorus } from 'react-chorus';

export function NewChatClient() {
  // React.useId() returns a string that matches between server and client
  // render for the same component, so the persistenceKey is the same on the
  // initial paint and after hydration. It is unique per `<NewChatClient>`
  // mount but stable across re-renders.
  const id = React.useId();
  return (
    <Chorus
      transport="/api/chat"
      connector="openai"
      persistenceKey={`chorus:draft:${id}`}
    />
  );
}
```

`useId` is stable across re-renders, so React's StrictMode double-invoke and prop changes do not generate a new key mid-conversation (which would split the draft across two storage entries). If you instead want a fresh key per *session* — for example, regenerate it once the user has navigated away and come back — combine `useId` with a `useEffect` that calls `localStorage.removeItem` on mount of a "compose new" route, or use the loader-redirect pattern shown in `examples/with-next-resume` where `/c/new` redirects to `/c/<server-generated-uuid>` so the URL is the source of truth for the conversation id.

```tsx
'use client';
import * as React from 'react';
import { Chorus } from 'react-chorus';

export function NewChatClient({ resetKey }: { resetKey: string }) {
  const id = React.useId();
  // Clear any stale draft under this id the first time we mount with a new
  // resetKey. Use this when the parent route signals "start over" — e.g.,
  // a "New chat" button bumps resetKey, which forces a one-shot wipe.
  React.useEffect(() => {
    window.localStorage.removeItem(`chorus:draft:${id}`);
  }, [id, resetKey]);

  return <Chorus transport="/api/chat" connector="openai" persistenceKey={`chorus:draft:${id}`} />;
}
```

Do not call `useId()` and then immediately overwrite the key with `crypto.randomUUID()` inside a `useEffect` — React StrictMode runs effects twice in development, and the second invocation would change the key after Chorus has already loaded its initial value, which `useChorusPersistence` would dev-warn as a key change mid-session.

> **Runnable example:** [`examples/with-next-resume`](../examples/with-next-resume) wires the full recipe end-to-end — a Next.js App Router page with a stub `loadConversation()` server function that seeds `initialMessages`, a `persistenceKey` scoped to the conversation id, and a `/c/new` route that redirects to a fresh server-generated uuid so each new chat starts with no stored payload.

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
| `'anthropic'` | Anthropic Messages API | `content_block_delta` text/thinking deltas plus `tool_use` / `input_json_delta` |
| `'gemini'` | Google Gemini (AI / Vertex AI) | selected `candidates[0].content.parts[*].text`, thought parts, and `functionCall` parts |
| `'ai-sdk'` | Vercel AI SDK (`toUIMessageStreamResponse` / `toDataStreamResponse`) | `text-delta` / `reasoning-delta` / `source-url` / `source-document` / `tool-input-*` / `tool-output-*` JSON events, plus prefix-coded data-stream frames (`0:"..."`, `g:"..."`, `j:{...}` sources, `7:`/`8:` source-like annotations, `9:{...}`, `c:{...}`, `a:{...}`, `d:`/`e:` finish, `3:"..."` error) |
| `'auto'` *(default)* | Auto-detect | Tries OpenAI, then Gemini, known Anthropic events, known Vercel AI SDK events (UI-message-stream JSON and data-stream prefix lines), generic JSON text fields (`text`/`content`/`delta`), then raw plain text |

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

> **Runnable example:** [`examples/with-anthropic`](../examples/with-anthropic) drives the `anthropic` connector from a built-in mock that streams the events above, so it runs with no API key; its README documents the matching Express + `@anthropic-ai/sdk` proxy.

## Gemini SSE format

The Google Gemini streaming API (Google AI and Vertex AI) sends server-sent events where each chunk contains a `candidates` array. The `'gemini'` connector reads only candidate index `0`, collects text from `content.parts[*].text`, maps `thought: true` text/thinking fields to reasoning, maps every `functionCall` part to a tool message, and signals completion for normal `STOP` / `MAX_TOKENS` finish reasons:

```
data: {"candidates":[{"index":0,"content":{"parts":[{"text":"Thinking","thought":true}]}}]}

data: {"candidates":[{"index":0,"content":{"parts":[{"functionCall":{"name":"search","args":{"q":"react-chorus"}}}]}}]}

data: {"candidates":[{"index":0,"content":{"parts":[{"text":"Hello world"}]},"finishReason":"STOP"}],"usageMetadata":{...}}
```

Gemini `functionCall.name` maps to `toolCall.name`, `functionCall.args` maps to `toolCall.input`, and the connector generates a stable tool delta id from the candidate/part index when Gemini does not provide one.

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
