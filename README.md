# react-chorus

Drop a polished, streaming AI chat experience into React — then peel back the layers when you need custom transport, rendering, persistence, tools, attachments, or theming.

[![CI](https://github.com/sjlynch/react-chorus/actions/workflows/ci.yml/badge.svg)](https://github.com/sjlynch/react-chorus/actions/workflows/ci.yml)

**[→ Try the live demo](https://sjlynch.github.io/react-chorus/)** &nbsp;·&nbsp; [![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/sjlynch/react-chorus?file=src%2Fmain.tsx)

The live demo runs entirely in your browser — no backend needed. It drives `<Chorus>` through a mock OpenAI-format SSE transport so you can see streaming replies, reasoning traces, tool calls, multi-conversation persistence, and palette theming with one click. Open it in StackBlitz if you want to edit the source side-by-side, or run `npm run dev` locally.

## Why react-chorus?

react-chorus is for React developers who want a drop-in AI chat UI that stays composable. Use the batteries-included `<Chorus>` widget for a production-ready shell, or import the headless/hooks/components when your product needs a custom layout.

- **Versus Vercel AI SDK:** react-chorus focuses on the visible chat UI and composer UX; pair it with any backend or SDK, including Vercel AI SDK, instead of adopting a specific transport stack.
- **Versus assistant-ui:** react-chorus keeps the default path small and direct while still exposing message rendering, streaming, persistence, and theme primitives.
- **Versus rolling your own:** you get SSE parsing, retry/edit/regenerate flows, Markdown, attachment handling, and local persistence without rebuilding the common edge cases.

## Install

react-chorus requires Node.js 20 or newer for package installation and server-side usage. Contributors running the Vite-powered dev/build tooling should use Node 20.19+ or Node 22.12+.

```bash
npm install react-chorus
```

Import the stylesheet once at your app entry point:

```tsx
import 'react-chorus/styles.css';
```

## Quick start

```tsx
import { Chorus } from 'react-chorus';

export default function App() {
  return (
    <div style={{ height: '100dvh' }}>
      <Chorus
        transport="/api/chat"
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

Chorus fills its parent, so give the wrapper an explicit height (for example `100dvh`) to make the transcript scroll internally. When the transcript is empty, `suggestedPrompts` renders starter buttons that fill and focus the composer without auto-sending. Chorus POSTs `{ prompt: string, history: Message[] }` to the URL and streams the SSE response into the assistant message automatically. `history` already includes the current user turn; `prompt` is a convenience copy of that latest user text.

## Two usage paths

### Simple path — `transport` prop

Pass a URL string or `Transport` function. Chorus handles everything:

```tsx
// String: Chorus POSTs { prompt, history } and reads the SSE stream
<Chorus transport="/api/chat" />

// Custom Transport function
import { createFetchSSETransport } from 'react-chorus';

const transport = createFetchSSETransport('/api/chat', {
  headers: { Authorization: `Bearer ${token}` },
});

<Chorus transport={transport} />
```

Seed an uncontrolled chat with a welcome message and include a hidden system prompt in every transport request:

```tsx
<Chorus
  transport="/api/chat"
  initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Hi! How can I help?' }]}
  systemPrompt="You are a concise support assistant."
/>
```

`systemPrompt` is prepended to the request `history` sent through the `transport` prop but is not rendered in the transcript.

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

  const handleSend: ChorusOnSend = (text, msgs, { appendAssistant, finalizeAssistant, signal }) =>
    send(text, msgs, { onChunk: appendAssistant, onDone: finalizeAssistant }, signal);

  return (
    <div style={{ height: '100dvh' }}>
      <Chorus
        value={messages}
        onChange={setMessages}
        sending={sending}
        onSend={handleSend}
        placeholder="Type a message…"
        suggestedPrompts={['Explain this code path', 'Write a regression test', 'Summarize the latest logs']}
        errorMessage="The assistant could not complete that request. Please try again."
        onError={(error) => console.error(error)}
      />
    </div>
  );
}
```

`createFetchSSETransport(url)` posts `{ prompt, history }` to your endpoint and reads the response as a Server-Sent Events stream. `history` includes the latest user message, so backend examples should map `history` directly instead of appending `prompt` again. Pass a `formatBody` option to customise the request shape for OpenAI, FastAPI, FormData uploads, or any other backend. The transport sets `Content-Type: application/json` only for its default JSON body; custom serializers should set JSON headers themselves and FormData/Blob/URLSearchParams are not forced to JSON. The `openai` connector parses the standard selected `choices[0]` text, reasoning, and tool-call delta shapes.

For reusable callbacks, import `ChorusOnSend<TMeta>` or the lower-level `ChorusSendHelpers` type instead of duplicating the helper shape. `ChorusOnSend<TMeta>` preserves your `Message<TMeta>.metadata` type through the `messages` argument and returned assistant message.

For a non-streaming client, `onSend` may return a complete assistant `Message`. Chorus appends it after the user message (and after `minAssistantDelayMs`):

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

### Minimal Express + OpenAI backend

```js
// server/index.js
import express from 'express';
import OpenAI from 'openai';

const app = express();
const openai = new OpenAI(); // reads OPENAI_API_KEY from env

app.use(express.json({ limit: '10mb' })); // data URL image attachments can be large

function toOpenAIMessage(m) {
  if (!m || typeof m !== 'object') return null;
  const text = typeof m.text === 'string' ? m.text : '';

  if (m.role === 'system' || m.role === 'assistant') {
    return text.trim() ? { role: m.role, content: text } : null;
  }

  if (m.role === 'user') {
    const parts = [];
    if (text.trim()) parts.push({ type: 'text', text });
    for (const att of Array.isArray(m.attachments) ? m.attachments : []) {
      if (att?.type?.startsWith('image/') && typeof att.data === 'string' && att.data.startsWith('data:')) {
        parts.push({ type: 'image_url', image_url: { url: att.data } });
      } else {
        parts.push({ type: 'text', text: `[Unsupported attachment omitted: ${att?.name ?? 'attachment'}]` });
      }
    }
    if (!parts.length) return null;
    return parts.length === 1 && parts[0].type === 'text'
      ? { role: 'user', content: parts[0].text }
      : { role: 'user', content: parts };
  }

  if (m.role === 'tool' && m.toolCall) {
    // Chorus tool messages do not include OpenAI's required tool_call_id.
    // Preserve them as context instead of sending an invalid role: 'tool' item.
    return { role: 'system', content: `Tool ${m.toolCall.name} result:\n${JSON.stringify(m.toolCall.output ?? m.text)}` };
  }

  return null;
}

app.post('/api/chat', async (req, res) => {
  const { history = [] } = req.body;
  const messages = Array.isArray(history) ? history.map(toOpenAIMessage).filter(Boolean) : [];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no'); // avoid proxy buffering for SSE

  try {
    const stream = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages, stream: true });

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    res.write('data: [DONE]\n\n');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
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
        onSend={async (text, msgs, { appendAssistant, finalizeAssistant, signal }) => {
          setConnectionStatus('connecting');
          await send(text, msgs, { onChunk: appendAssistant, onDone: finalizeAssistant }, signal);
        }}
        placeholder="Type a message…"
      />
    </div>
  );
}
```

Each incoming WebSocket message is treated as one SSE payload, so the same connector/extraction pipeline applies unchanged.

### Minimal Node.js `ws` + Claude backend

```js
// server.js  —  npm install ws @anthropic-ai/sdk
import { WebSocketServer } from 'ws';
import Anthropic from '@anthropic-ai/sdk';

const wss = new WebSocketServer({ port: 8080 });
const client = new Anthropic();

wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    const { history = [] } = JSON.parse(raw.toString());
    const system = history
      .filter((m) => m.role === 'system' && m.text)
      .map((m) => m.text)
      .join('\n\n') || undefined;
    const messages = history
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text)
      .map((m) => ({ role: m.role, content: m.text }));
    // Tool messages and attachments need Anthropic content blocks/tool_result
    // mapping. Do that explicitly instead of passing raw Chorus messages through.

    try {
      const stream = await client.messages.stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system,
        messages,
      });

      // Forward raw Anthropic SDK events verbatim — the front-end
      // `anthropic` connector parses `content_block_delta` / `message_stop`
      // directly, so no server-side reshaping is needed.
      for await (const event of stream) {
        ws.send(JSON.stringify(event));
      }
      // `client.messages.stream` already emits a `message_stop` event,
      // which the anthropic connector treats as the done sentinel. The
      // react-chorus WebSocket transport opens a fresh socket per send and
      // closes it client-side after that sentinel is processed.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ws.send(JSON.stringify({ error: message }));
    }
  });
});
```

The front-end pairs this with `connector: 'anthropic'` (see the React snippet above) so it reads `content_block_delta` / `message_stop` events out of each WebSocket frame the same way it would over an SSE stream.

## Connectors

Connectors tell Chorus how to parse the streaming response from different AI providers. Pass a connector name or object via `useChorusStream`'s `connector` option.

### Built-in connectors

| Name | Provider | SSE format |
|------|----------|------------|
| `'openai'` | OpenAI Chat Completions / Responses-compatible streams | selected `choices[0].delta.content`, reasoning fields, `tool_calls`, and common Responses API deltas |
| `'anthropic'` | Anthropic Messages API | `content_block_delta` text/thinking deltas plus `tool_use` / `input_json_delta` |
| `'gemini'` | Google Gemini (AI / Vertex AI) | selected `candidates[0].content.parts[*].text`, thought parts, and `functionCall` parts |
| `'auto'` *(default)* | Auto-detect | Tries OpenAI, then Gemini, then Anthropic, then plain text |

All built-in connectors also recognise in-band stream errors. If a backend has already started a `200` SSE/WebSocket stream, send `data: {"error":"message"}` (or `{"error":{"message":"message"}}`) to abort the response, call `onError` with an `Error`, and show the configured error banner.

Built-in connectors emit three additive delta types:

- `text` appends to the active assistant bubble.
- `reasoning` appends to `message.reasoning` and renders as a collapsed **Reasoning** details block above the assistant bubble.
- `toolDelta` becomes/updates a `role: 'tool'` message with `message.toolCall`, so the existing `<ToolCallBlock>` renderer shows streaming tool calls automatically in `<Chorus>`.

Custom connectors can return the same shape:

```ts
type ConnectorResult = {
  text?: string;
  reasoning?: string;
  toolDelta?: { id: string; name?: string; input?: unknown; output?: unknown };
  done?: boolean;
  error?: string;
};
```

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

// Auto-detect (default)
const { send } = useChorusStream(transport);
```

## OpenAI SSE format

The `openaiConnector` reads the selected Chat Completions alternative (`choices[index === 0]`, or the first array entry when indexes are omitted). It maps:

- `choices[0].delta.content` → assistant text. DeepSeek-style `<think>...</think>` spans inside content are split into `reasoning` instead of being rendered in the answer.
- `choices[0].delta.reasoning`, `reasoning_content`, or `reasoning_summary` → assistant `reasoning`.
- `choices[0].delta.tool_calls[*].id/function.name/function.arguments` → `toolDelta { id, name, input }`. Argument string fragments are accumulated and parsed as JSON when complete before they are written to the tool message.

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

## Anthropic SSE format

The Anthropic Messages API streams server-sent events. The `anthropicConnector` extracts text and thinking/tool-use deltas from content block events and signals completion on `message_stop`:

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

## Gemini SSE format

The Google Gemini streaming API (Google AI and Vertex AI) sends server-sent events where each chunk contains a `candidates` array. The `geminiConnector` reads only candidate index `0`, collects text from `content.parts[*].text`, maps `thought: true` text/thinking fields to reasoning, maps `functionCall` parts to tool messages, and signals completion for normal `STOP` / `MAX_TOKENS` finish reasons:

```
data: {"candidates":[{"index":0,"content":{"parts":[{"text":"Thinking","thought":true}]}}]}

data: {"candidates":[{"index":0,"content":{"parts":[{"functionCall":{"name":"search","args":{"q":"react-chorus"}}}]}}]}

data: {"candidates":[{"index":0,"content":{"parts":[{"text":"Hello world"}]},"finishReason":"STOP"}],"usageMetadata":{...}}
```

Gemini `functionCall.name` maps to `toolCall.name`, `functionCall.args` maps to `toolCall.input`, and the connector generates a stable tool delta id from the candidate/part index when Gemini does not provide one.

Gemini blocked finish reasons such as `SAFETY`, `RECITATION`, `BLOCKLIST`, or `PROHIBITED_CONTENT` are treated as stream errors instead of silent completion. The `Error` passed to `onError` includes the raw `finishReason` (for example `finishReason: SAFETY`); the default UI still shows the generic `errorMessage`. `MAX_TOKENS` is treated as a completed, possibly truncated response.

Example backend proxy (Express + `@google/generative-ai`):

```js
import { GoogleGenerativeAI } from '@google/generative-ai';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/api/chat', async (req, res) => {
  const { history = [] } = req.body;
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const contents = history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text)
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] }));
  // This text-only example filters system/tool messages. Map image attachments
  // to Gemini inlineData/fileData parts explicitly before sending them.

  res.setHeader('Content-Type', 'text/event-stream');
  try {
    const result = await model.generateContentStream({ contents });
    for await (const chunk of result.stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
  } finally {
    res.end();
  }
});
```

## Examples

Runnable examples live in the [`/examples`](./examples) directory. They declare the same Node.js 20+ floor as the root package and consume the local build after `npm run build`.

| Example | Description |
|---------|-------------|
| [`examples/basic`](./examples/basic) | Zero-backend demo using a simulated streaming response, local persistence, clear/reset, and a custom error banner — great for local development |
| [`examples/with-openai`](./examples/with-openai) | Full-stack example: Vite frontend + Express backend proxying to OpenAI |

### Running the basic example

```bash
# Build the library first
npm run build

# Install and start
cd examples/basic
npm install
npm run dev
```

### Running the OpenAI example

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

## Bundle size

`highlight.js` (the syntax-highlighting engine used by the `Markdown` component) is ~600 KB minified. To keep initial page load fast, **react-chorus lazy-loads highlight.js at runtime** — it is only fetched the first time a fenced code block (` ``` ` or `~~~`) appears in the rendered text.

**Impact:**
- Pages that never render code blocks pay zero cost — highlight.js is never downloaded.
- Pages that do render code blocks load highlight.js asynchronously on demand. The matching GitHub dark/light token-color stylesheet is also injected on demand based on `codeBlockTheme`. The code renders immediately as plain text and is re-rendered with syntax highlighting once the chunk arrives.
- While an assistant message is actively streaming, Chorus renders that growing message as React-escaped plain text and switches to full Markdown parsing/sanitization when the stream finalizes. This avoids reparsing and resanitizing the entire message on every token.
- Bundlers (Vite, webpack, Rollup) will automatically split highlight.js into a separate async chunk, so it does not inflate the main bundle.

## SSR and Markdown sanitization

`<Markdown>` sanitizes rendered HTML before using `dangerouslySetInnerHTML`. In the browser it uses `dompurify` (or initializes the DOMPurify factory with `window` when needed). During SSR, if no real DOMPurify-compatible sanitizer is available, react-chorus does **not** attempt regex-based HTML sanitization; it switches to a safe no-raw-HTML renderer that drops raw HTML tokens and only emits Markdown-generated links/images with safe URL protocols. Ordinary Markdown (`**bold**`, headings, lists, code, safe `http`/`https` links) renders the same on server and client.

If your SSR app wants to allow sanitized raw HTML, create an isomorphic DOMPurify instance (for example with your framework's DOM/window or jsdom on the server) and pass it to the standalone renderer: `<Markdown sanitizer={purify} />` or `<Markdown sanitizer={(html) => purify.sanitize(html)} />`. The built-in chat renderer accepts the same customization via `<Chorus markdownSanitizer={purify} />` / `<ChatWindow markdownSanitizer={purify} />`, or through `markdownProps={{ sanitizer: purify }}`. You can also pass `markedOptions` and `markedExtensions` directly to `<Markdown>` or via `markdownProps` to adjust parsing and register marked extensions without mutating marked's global singleton.

## API

### `<Chorus>`

`ChorusProps` is generic: `ChorusProps<TMeta = Record<string, unknown>>`. Use `<Chorus<MyMeta> ... />` when your `Message.metadata` has a structured shape; `value`, `onChange`, `onSend`, `transport`, and `renderMessage` will all preserve `Message<MyMeta>`.

Message source modes are mutually exclusive:

- Controlled: pass `value` + `onChange` and keep the canonical message list in your state.
- Uncontrolled with a seed: pass `initialMessages` (or legacy `messages`) and let Chorus manage subsequent updates internally.
- Uncontrolled with persistence: pass `persistenceKey` without `value`; passing both makes `value` win, so built-in persistence is bypassed.

When `persistenceKey` is combined with `initialMessages` (or legacy `messages`), stored history is checked first. If the key has no stored value, Chorus renders and saves the seed so welcome messages still appear with persistence enabled. If the key already exists, the stored value wins. Async storage adapters may show the seed while loading; once the read resolves, stored history replaces it, and stale reads are ignored after local changes.

Persistence writes are debounced while assistant tokens stream, flushed when a message finalizes and on explicit edits/deletes/clears, and serialized for async adapters so older saves cannot overwrite newer transcripts. Pending debounced writes are also flushed on `pagehide` and `visibilitychange` → `hidden`; synchronous adapters such as `localStorage` can complete that final write during tab close, while Promise-based adapters cannot block navigation. For remote/IndexedDB persistence, prefer a synchronous localStorage fallback plus an async backup when data loss on close is unacceptable.

Built-in persistence uses `JSON.stringify` / `JSON.parse` by default. Message data must be JSON-serializable: Dates are restored as strings, classes are not revived, and values such as `BigInt` fail serialization and surface through `onPersistenceError` / `useChorusPersistence().error`. Pass `serializeMessages` and/or `deserializeMessages` to customize validation, compression, or Date revival.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `transport` | `string \| Transport<TMeta>` | — | Simple path: URL to POST to, or a custom Transport function. Chorus handles all streaming. |
| `systemPrompt` | `string` | — | Transport-path convenience prop. Prepends a hidden `system` message to the request history for every send. |
| `connector` | `Connector \| 'auto' \| 'openai' \| 'anthropic' \| 'gemini'` | `'auto'` | SSE connector used to parse the stream. `'auto'` detects OpenAI, Anthropic, and Gemini; pass an explicit name when the format is known. |
| `onSend` | `(text, messages, helpers) => Message<TMeta> \| void \| Promise<Message<TMeta> \| void>` | — | Advanced path: called when the user submits a message. Use `helpers.appendAssistant`/`helpers.finalizeAssistant` to stream tokens, or return a complete assistant `Message` for non-streaming replies. |
| `value` | `Message<TMeta>[]` | — | Controlled message list. Pair with `onChange`; Chorus renders this array as the source of truth. |
| `onChange` | `(messages: Message<TMeta>[]) => void` | — | Called whenever Chorus wants to change the message list in controlled mode (`value` is provided). Not called for legacy `messages`-only uncontrolled state. |
| `messages` | `Message<TMeta>[]` | — | Legacy initial-only seed for uncontrolled mode. Read once on mount; later prop changes are ignored. Prefer `initialMessages` for seeding or `value` + `onChange` for controlled mode. |
| `initialMessages` | `Message<TMeta>[]` | — | Initial-only seed for uncontrolled mode. Useful for welcome messages; `system` messages are hidden by default via `hiddenRoles`. Tool calls remain visible by default. |
| `emptyState` | `ReactNode` | — | Custom content shown in the transcript when the visible message list is empty and the assistant is not typing. |
| `suggestedPrompts` | `string[]` | — | Default empty-state prompt buttons. Clicking one fills and focuses the composer without sending. Ignored when `emptyState` is provided. |
| `placeholder` | `string` | `"Send a message"` | Input placeholder text. |
| `accept` | `string` | — | Enables attachments and is forwarded to the file-picker `<input accept>`. Paste/drop validation uses the same MIME/extension rules. Omitting the prop hides the attach button and disables paste/drop attachments. |
| `maxAttachmentBytes` | `number` | — | Reject files larger than this byte limit before reading/uploading them. |
| `maxAttachments` | `number` | — | Maximum attachments queued in the composer at once. Extra files trigger `onAttachmentError`. |
| `maxRenderedMessages` | `number` | — | Performance escape hatch: render only the latest N visible messages while keeping typing/error rows, auto-scroll, and actions wired to original message IDs. |
| `onAttachmentError` | `(error: AttachmentError) => void` | — | Called when a picker, paste, or drop file is rejected or cannot be read/uploaded. Reasons include `unsupported-type`, `too-large`, `too-many`, `read-failed`, and `upload-failed`. |
| `uploadAttachment` | `(file: File) => AttachmentUploadResult \| Promise<AttachmentUploadResult>` | data URL reader | Optional transform/upload hook. Return a custom attachment (for example a CDN URL or provider file id) instead of the default data URL payload. |
| `sending` | `boolean` | — | Visual sending-state override for fully custom `onSend`/`useChorusStream` integrations. On the `transport` path, Chorus still owns the internal concurrency guard even if this is overridden. |
| `palette` | `Palette` | dark theme | Custom color palette for theming, including `actionText`, `actionHoverBg`, `actionHoverText`, `errorBg`, `errorBorder`, and `errorText`. |
| `codeBlockTheme` | `'dark' \| 'light'` | `'dark'` | Code block syntax-highlight theme. |
| `minAssistantDelayMs` | `number` | `300` | Minimum ms before showing the first assistant token. |
| `errorMessage` | `string` | `'Something went wrong. Please try again.'` | Friendly message shown in the error banner. Raw transport errors are never surfaced in the default UI. |
| `onError` | `(error: Error) => void` | — | Called for any non-abort error from a send or stream. The raw `Error` goes here; the UI shows `errorMessage`. |
| `renderError` | `({ error, rawError, retry, dismiss }) => ReactNode` | — | Replace the built-in error banner. `error` is the friendly UI string, `rawError` is the last raw `Error` when available, `retry()` resubmits the last turn, and `dismiss()` clears the banner. |
| `onChunk` | `(chunk: string, messageId: string) => void` | — | Observation hook called for each streamed token. Receives the assistant `messageId` so callers can correlate chunks with a specific message. Does **not** affect streaming behaviour. |
| `onCopy` | `(message: Message<TMeta>) => void` | Clipboard copy when available | Overrides the built-in per-message Copy action. If omitted, Chorus copies `message.text` with `navigator.clipboard.writeText` when the Clipboard API is available. |
| `onFeedback` | `(message: Message<TMeta>, feedback: 'up' \| 'down') => void` | — | Enables built-in thumbs-up / thumbs-down per-message feedback actions and reports the selected variant. |
| `onFinish` | `({ message, messages, reason, response }) => void` | — | Called once when an assistant message completes normally. Use it for telemetry, persistence handoff, moderation, or post-response UI. Not called for aborts, Stop, or errors. |
| `persistenceKey` | `string` | — | Uncontrolled-mode persistence key. When set without `value`, Chorus saves/restores messages using this key (defaults to localStorage). If `value` is provided, controlled state wins and built-in persistence is not used. |
| `persistenceStorage` | `StorageAdapter` | `localStorage` | Custom storage adapter for persistenceKey. The default `localStorage` is resolved lazily; if browser storage is blocked or unavailable, Chorus keeps working without persistence. Implement optional `removeItem(key)` to delete cleared/deleted conversation keys; adapters without it fall back to writing `[]`. |
| `onPersistenceError` | `(error: Error) => void` | — | Called when a persistence write throws or rejects. The hook also exposes the latest write error as `useChorusPersistence().error`. |
| `serializeMessages` | `(messages: Message<TMeta>[]) => string` | `JSON.stringify` | Optional persistence serializer. Use it for custom formats or to reject unsupported data explicitly. |
| `deserializeMessages` | `(raw: string) => Message<TMeta>[]` | JSON parse + array guard | Optional persistence deserializer/reviver. Use it to validate stored payloads or revive Dates/classes. |
| `showClearButton` | `boolean` | `false` | Shows a built-in clear/reset conversation button above the input. |
| `clearLabel` | `string` | `'Clear conversation'` | Label for the built-in clear/reset button. |
| `onClear` | `(messages: Message<TMeta>[]) => void` | — | Called with the reset message list after the built-in clear action runs. |
| `resetToInitialMessages` | `boolean` | `false` | When clearing, restore the initial `messages`/`initialMessages` seed instead of removing (or fallback-saving `[]` to) the empty conversation key. |
| `showJumpToBottomButton` | `boolean` | `true` (`false` in headless exports) | Shows a floating “Jump to latest” button when auto-scroll is paused and new activity arrives. |
| `headless` | `boolean` | `false` | Strip all default styles and inline style injection. |
| `renderMessage` | `(message: Message<TMeta>, ctx: RenderMessageContext<TMeta>) => ReactNode` | — | Custom per-message renderer. Return `null` to fall back to default rendering. `ctx` includes `isStreaming`, `defaultRender(slots?)`, and action callbacks/default action controls. Existing one-argument renderers continue to work. |
| `markdownProps` | `Omit<MarkdownProps, 'text' \| 'codeTheme' \| 'headless' \| 'streaming'>` | — | Props forwarded to the built-in Markdown renderer for every message, including `sanitizer`, `markedOptions`, and `markedExtensions`. |
| `markdownSanitizer` | `MarkdownSanitizer` | — | Convenience alias for `markdownProps.sanitizer`; takes precedence when both are provided. |
| `hiddenRoles` | `Role[]` | `['system']` | Message roles hidden from the transcript. Tool calls are visible by default in `<Chorus>`; pass `['system', 'tool']` to hide them, or `[]` to show all roles. `<Chorus>` accepts `hiddenRoles` only — `showSystemMessages` exists on `<ChatWindow>` for backwards compatibility. |

### `helpers` (passed to `onSend`)

| Helper | Description |
|--------|-------------|
| `appendAssistant(chunk)` | Append a text chunk to the current assistant message. Chunks are buffered until `minAssistantDelayMs` has elapsed before the first token is shown. |
| `finalizeAssistant()` | Mark the assistant message complete. If first-token chunks are still buffered, completion waits until they flush. |
| `signal` | `AbortSignal` — aborted when the user hits Stop. |

Call `finalizeAssistant()` when your custom stream is done. In development, Chorus warns if `onSend` appended chunks and then resolved without finalizing; it will still flush those chunks and reset the sending state so the UI cannot get stuck in Stop mode.

### Keyboard shortcuts

- Composer textarea: **Enter** sends, **Shift+Enter** inserts a newline.
- Inline edit textarea: **Enter** saves, **Shift+Enter** inserts a newline, and **Escape** cancels editing.

### Imperative `ChorusRef`

Use a ref for suggested prompts, global focus shortcuts, external clear buttons, or scrolling to a known message:

```tsx
import React from 'react';
import { Chorus, type ChorusRef } from 'react-chorus';

export function SupportChat() {
  const chorusRef = React.useRef<ChorusRef>(null);
  const suggestions = ['Summarize my account', 'Explain my last invoice'];

  return (
    <>
      {suggestions.map((text) => (
        <button key={text} type="button" onClick={() => chorusRef.current?.send(text)}>
          {text}
        </button>
      ))}
      <button type="button" onClick={() => chorusRef.current?.focus()}>Focus chat</button>
      <Chorus ref={chorusRef} transport="/api/chat" />
    </>
  );
}
```

The ref exposes `send(text, attachments?)`, `stop()`, `clear()`, `focus()`, and `scrollToMessage(id)`.

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

By default, clearing writes an empty conversation. If the storage adapter implements `removeItem`, Chorus removes the key; adapters without `removeItem` fall back to saving `[]` for backward compatibility. Pass `resetToInitialMessages` to reset back to the seed welcome messages instead. In controlled mode, the same button calls `onChange(resetMessages)` and `onClear(resetMessages)`; keep the canonical list in your state as usual.

A storage adapter can be synchronous (like `localStorage`) or Promise-based:

```ts
interface StorageAdapter {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
}
```

For multiple saved chats, use `useConversations` with `ConversationList` and pass the active persistence key/storage into Chorus:

```tsx
const conversations = useConversations();

<ConversationList {...conversations} />
<Chorus
  persistenceKey={conversations.activePersistenceKey}
  persistenceStorage={conversations.storage ?? undefined}
/>
```

`useConversations({ indexKey, messageKeyPrefix, storage })` stores a JSON index of `{ id, title, createdAt, updatedAt }` records under `indexKey` (default `chorus-conversations-index`) and stores each transcript under `${messageKeyPrefix}${id}`. `deleteConversation(id)` removes the transcript key via `removeItem` when available.

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

`onFinish` is not called for Stop/abort, transport errors, provider error payloads, or sends that produce no assistant message.

### Attachment composer UX

Passing `accept` enables the built-in attachment composer. Users can pick files, paste files from the clipboard, or drag/drop files onto the composer; all three paths use the same `accept` matching (`image/*`, exact MIME types, and extensions such as `.pdf`).

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
  uploadAttachment={async (file) => {
    const form = new FormData();
    form.set('file', file);
    const uploaded = await fetch('/api/uploads', { method: 'POST', body: form }).then(r => r.json());

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

While an async `uploadAttachment` is in flight, the composer shows a pending attachment chip with a spinner and disables Send so an empty placeholder cannot be submitted. Users can remove the pending chip to cancel it from the outgoing message; upload failures call `onAttachmentError` with `reason: 'upload-failed'` and remove the chip.

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
- `send(..., { onReasoning, onToolDelta })` receives connector-emitted reasoning chunks and accumulated tool deltas when you use the hook directly. `<Chorus>` wires these into `Message.reasoning` and `role: 'tool'` messages automatically.
- Non-abort transport, HTTP, connector, and in-band provider errors call `onError` when supplied and reject the returned `send()` promise. This lets README-style `await send(...)` bridges surface the friendly Chorus error banner through the surrounding `onSend` catch path.
- `onError` receives raw transport details (including bounded HTTP response body snippets); the built-in UI continues to show only `errorMessage`.
- `opts.connector` — `'openai'` | `'anthropic'` | `'gemini'` | `'auto'` | custom `Connector`. Defaults to `'auto'` which handles OpenAI, Gemini, Anthropic JSON, plain-text SSE, reasoning/tool deltas, and in-band `{ error }` payloads.

### `createFetchSSETransport(url, init?)`

Returns a `Transport` that POSTs to `url` and reads the response as a Server-Sent Events stream. With no `formatBody`, it sends JSON `{ prompt, history }` and defaults `Content-Type: application/json`. With a custom `formatBody`, headers are left alone so FormData/Blob/URLSearchParams can set their own content type; add an explicit JSON Content-Type when your custom serializer returns JSON.

| Option | Type | Default | Description |
|---|---|---|---|
| `formatBody` | `(text, history: Message<TMeta>[]) => BodyInit` | `JSON.stringify({ prompt, history })` | Serialise the outgoing request body. Custom serializers do not get an automatic JSON Content-Type. |
| *(any `RequestInit` field)* | | | Forwarded to `fetch` (e.g. `headers`, `credentials`) |

```ts
// OpenAI-compatible backend
const transport = createFetchSSETransport('/api/chat', {
  headers: { 'Content-Type': 'application/json' },
  formatBody: (text, history) =>
    JSON.stringify({ model: 'gpt-4o', messages: history, stream: true }),
});

// FastAPI / LangChain backend
const transport = createFetchSSETransport('/api/chat', {
  headers: { 'Content-Type': 'application/json' },
  formatBody: (text, history) => JSON.stringify({ messages: history }),
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
```

### `createWebSocketTransport(url, opts?)`

Returns a `Transport` that connects over a native WebSocket. Each incoming message is wrapped as an SSE `data:` line so the existing connector pipeline works unchanged.

| Option | Type | Default | Description |
|---|---|---|---|
| `protocols` | `string \| string[]` | – | WebSocket sub-protocols passed to the constructor |
| `onOpen` | `() => void` | – | Called when the WebSocket connection opens |
| `onClose` | `(code: number, reason: string) => void` | – | Called when the WebSocket closes, with the close code and reason |
| `onError` | `(event: Event) => void` | – | Called when the WebSocket reports an error |
| `formatMessage` | `(text, history: Message<TMeta>[]) => string` | `JSON.stringify({ prompt, history })` | Serialise the outgoing request |

Supports `AbortSignal` cancellation — closing the socket when the user hits Stop.

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

## Serializing multimodal and tool-call history

`Message` is react-chorus' UI/storage shape. Provider APIs have stricter role and content schemas, so do not blindly send every item as `{ role: m.role, content: m.text }`: `tool` messages often need provider-specific IDs, system prompts may be top-level fields, and attachments need multimodal content parts.

Recommended patterns:

- Keep the default transport body (`{ prompt, history }`) and map `history` safely on your server, as the OpenAI example above does.
- Or pass `createFetchSSETransport('/api/chat', { formatBody, headers })` and serialize to your backend's exact schema on the client.
- Filter unsupported roles/attachments explicitly, or convert them to safe text context, instead of passing invalid provider messages through.

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

Backend: map only user image attachments to OpenAI `image_url` content parts, while keeping text-only turns as simple strings.

```js
function toOpenAIUserMessage(m) {
  const parts = [];
  if (m.text?.trim()) parts.push({ type: 'text', text: m.text });
  for (const att of Array.isArray(m.attachments) ? m.attachments : []) {
    if (att?.type?.startsWith('image/') && att.data?.startsWith('data:')) {
      parts.push({ type: 'image_url', image_url: { url: att.data } });
    } else {
      parts.push({ type: 'text', text: `[Unsupported attachment omitted: ${att?.name ?? 'attachment'}]` });
    }
  }
  if (!parts.length) return null;
  return parts.length === 1 && parts[0].type === 'text'
    ? { role: 'user', content: parts[0].text }
    : { role: 'user', content: parts };
}
```

The runnable [`examples/with-openai`](./examples/with-openai) app includes this mapping and sets `express.json({ limit: '10mb' })` so data URL images are accepted by the proxy.

### Tool-call history recipe

Chorus displays tool steps as `role: 'tool'` with `message.toolCall`, but those messages are not a provider-neutral wire format. If your provider requires IDs (for example OpenAI `tool_call_id`) and paired assistant tool-call records, store those provider IDs in `metadata` and serialize them explicitly in `formatBody` or on your server. If you only need the model to see the result, convert the tool message to safe text context:

```js
function toolMessageToContext(m) {
  if (m.role !== 'tool' || !m.toolCall) return null;
  return {
    role: 'system',
    content: `Tool ${m.toolCall.name} result:\n${JSON.stringify(m.toolCall.output ?? m.text)}`,
  };
}
```

## Tool calls and agent steps

For agentic UIs, react-chorus provides first-class support for tool call rendering via the `role: 'tool'` message type.

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

Supply a `renderMessage` render-prop to take full control of how any message is displayed. Return `null` to fall back to the default renderer for that message. The second argument exposes rendering context: `ctx.isStreaming`, `ctx.defaultRender(slots?)`, and `ctx.actions` (`edit(newText)`, `regenerate()`, `delete()`, `copy()`, `feedback('up' | 'down')`, plus `ctx.actions.defaultRender()` for the built-in action controls).

```tsx
<Chorus
  messages={messages}
  hiddenRoles={['system']} // show tool calls while still hiding system prompts
  renderMessage={(msg, ctx) => {
    if (msg.role === 'tool' && msg.toolCall) {
      return (
        <div key={msg.id} className="my-tool-step">
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
<div class="chorus-msg chorus-{role}">
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

Target these classes in your CSS to restyle without a render prop:

```css
.chorus-msg.chorus-user   .chorus-bubble { background: #0070f3; color: #fff; }
.chorus-msg.chorus-assistant .chorus-bubble { background: #f0f0f0; color: #111; }
```

Reasoning blocks reuse existing palette variables (`--chorus-chat-bg`, `--chorus-chat-text`, `--chorus-border`, `--chorus-action-text`, and hover tokens), so they follow your `<Chorus palette={…}>` theme automatically.

### CSS custom properties for tool blocks

Override the look of built-in tool call blocks via CSS variables:

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
}
```

## Theming

Pass a `palette` prop to `<Chorus>` (or wrap components in `<ChorusTheme palette={…}>`):

```tsx
<Chorus
  palette={{
    chatBg: '#0f0f0f',
    assistantBubbleBg: '#6366f1',
    assistantText: '#ffffff',
    userBubbleBg: '#e5e7eb',
  }}
  onSend={…}
/>
```

Available palette keys: `chatBg`, `chatText`, `border`, `assistantBubbleBg`, `assistantText`, `assistantBorder`, `userBubbleBg`, `userText`, `userBorder`, `inputAreaBg`, `inputBg`, `inputText`, `inputBorder`, `sendButtonBg`, `sendButtonText`, `focusRing`, `actionText`, `actionHoverBg`, `actionHoverText`, `errorBg`, `errorBorder`, `errorText`.

## Individual Components

You can compose the UI from smaller pieces:

```tsx
import { ChatWindow, ChatInput, ChorusTheme, Markdown } from 'react-chorus';
```

- **`<ChatWindow messages={…} typing={…} />`** — renders the scrollable message list with empty-state prompts, a typing indicator, errors, optional jump-to-latest button, and optional `maxRenderedMessages` windowing. It accepts `hiddenRoles?: Role[]` (default `['system', 'tool']`); `showSystemMessages` is deprecated but remains supported as an alias for showing all roles. Pass `markdownSanitizer`, `markdownProps`, `renderError`, or `renderMessage` to customize built-in rendering.
- **`<ChatInput value onSend onStop placeholder sending />`** — the text input, send/stop button, and optional attachment composer (`accept`, paste/drop, limits, `uploadAttachment`).
- **`<ChorusTheme palette={…}>`** — applies theme CSS variables to any subtree.
- **`<Markdown text={…} codeTheme="dark" />`** — standalone markdown renderer with syntax highlighting and copy buttons. It supports `streaming` to render escaped plain text until finalization, `sanitizer` to provide a custom DOMPurify-compatible sanitizer when SSR needs sanitized raw HTML instead of the built-in no-raw-HTML safe mode, and `markedOptions`/`markedExtensions` for per-instance parser customization.
- **`<MessageBubble message={…} />`** — renders the default bubble for one message, including attachments and screen-reader speaker labels. Accepts `className`, `style`, `codeTheme`, `headless`, `streaming`, `markdownProps`, `markdownSanitizer`, and decoration slots (`before`, `headerSlot`, `footerSlot`, `after`) without replacing the full renderer.

### Headless subpath

Import from `react-chorus/headless` when you want semantic markup and behavior without default styling. The headless subpath preserves class names as styling hooks, and its `Chorus`, `ChatWindow`, `MessageBubble`, `ConversationList`, and `Markdown` exports default `headless={true}` so Markdown styles and syntax-highlight theme CSS are not injected unless you explicitly pass `headless={false}`. It re-exports the same public message, attachment, upload, streaming, and persistence types as the root entry point so `ChatInput` handlers can be typed from the subpath alone.

```tsx
import { ChatWindow, ConversationList, Markdown, MessageBubble } from 'react-chorus/headless';

<ChatWindow messages={messages} />
<MessageBubble message={message} />
<ConversationList {...conversations} />
<Markdown text="**unstyled**" />
```

## Message Shape

```ts
type Role = 'user' | 'assistant' | 'system' | 'tool';

interface ToolCall {
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

interface Message<TMeta = Record<string, unknown>> {
  id: string;
  role: Role;
  text: string; // supports CommonMark + GFM
  reasoning?: string; // optional thinking/reasoning trace rendered in a collapsed details block
  attachments?: Attachment[]; // populated by <ChatInput accept="..." />
  toolCall?: ToolCall; // populated when role === 'tool'
  metadata?: TMeta; // optional typed data (timestamps, model, latency, etc.)
}
```

`Message` defaults to arbitrary metadata for backwards compatibility. Pass a type argument when your app stores structured metadata:

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

## Development and release

Use Node.js 20 or newer (Node 20.19+ or 22.12+ recommended for the Vite toolchain), then install dependencies with `npm ci`.

Release/CI quality gates:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run typecheck:consumer
npm run verify:pack
```

`npm run prepublishOnly` runs the same publish gate, including tests, the consumer typecheck, and package-content verification.

## License

MIT
