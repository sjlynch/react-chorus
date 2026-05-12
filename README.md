# react-chorus

A React chat UI component with built-in SSE streaming support.

## Install

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
      <Chorus transport="/api/chat" />
    </div>
  );
}
```

Chorus fills its parent, so give the wrapper an explicit height (for example `100dvh`) to make the transcript scroll internally. Chorus POSTs `{ prompt: string, history: Message[] }` to the URL and streams the SSE response into the assistant message automatically. `history` already includes the current user turn; `prompt` is a convenience copy of that latest user text.

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
import type { Message } from 'react-chorus';

const transport = createFetchSSETransport('/api/chat');

export default function App() {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const { send, sending } = useChorusStream(transport, { connector: 'openai' });

  return (
    <div style={{ height: '100dvh' }}>
      <Chorus
        value={messages}
        onChange={setMessages}
        sending={sending}
        onSend={(text, msgs, { appendAssistant, finalizeAssistant, signal }) =>
          send(text, msgs, { onChunk: appendAssistant, onDone: finalizeAssistant }, signal)
        }
        placeholder="Type a message…"
      />
    </div>
  );
}
```

`createFetchSSETransport(url)` posts `{ prompt, history }` to your endpoint and reads the response as a Server-Sent Events stream. `history` includes the latest user message, so backend examples should map `history` directly instead of appending `prompt` again. Pass a `formatBody` option to customise the request shape for OpenAI, FastAPI, or any other backend. The `openai` connector parses the standard `choices[*].delta.content` shape.

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

app.use(express.json());

app.post('/api/chat', async (req, res) => {
  const { history = [] } = req.body;
  const messages = history.map((m) => ({ role: m.role, content: m.text }));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

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
    const messages = history.map((m) => ({ role: m.role, content: m.text }));

    try {
      const stream = await client.messages.stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
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
| `'openai'` | OpenAI Chat Completions | `choices[*].delta.content` |
| `'anthropic'` | Anthropic Messages API | `content_block_delta` / `delta.text` |
| `'gemini'` | Google Gemini (AI / Vertex AI) | `candidates[*].content.parts[*].text` |
| `'auto'` *(default)* | Auto-detect | Tries OpenAI, then Gemini, then Anthropic, then plain text |

All built-in connectors also recognise in-band stream errors. If a backend has already started a `200` SSE/WebSocket stream, send `data: {"error":"message"}` (or `{"error":{"message":"message"}}`) to abort the response, call `onError` with an `Error`, and show the configured error banner.

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

## Anthropic SSE format

The Anthropic Messages API streams server-sent events. The `anthropicConnector` extracts text from `content_block_delta` events and signals completion on `message_stop`:

```
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: message_stop
data: {"type":"message_stop"}
```

## Gemini SSE format

The Google Gemini streaming API (Google AI and Vertex AI) sends server-sent events where each chunk contains a `candidates` array. The `geminiConnector` collects text from `candidates[*].content.parts[*].text` and signals completion when any candidate has a `finishReason`:

```
data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]},"index":0}]}

data: {"candidates":[{"content":{"parts":[{"text":" world"}]},"finishReason":"STOP","index":0}],"usageMetadata":{...}}
```

Example backend proxy (Express + `@google/generative-ai`):

```js
import { GoogleGenerativeAI } from '@google/generative-ai';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/api/chat', async (req, res) => {
  const { history = [] } = req.body;
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const contents = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] }));

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

Runnable examples live in the [`/examples`](./examples) directory:

| Example | Description |
|---------|-------------|
| [`examples/basic`](./examples/basic) | Zero-backend demo using a simulated streaming response — great for local development |
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

```bash
# Build the library first
npm run build

# Terminal 1 — backend
cd examples/with-openai/server
npm install
OPENAI_API_KEY=sk-... node index.js

# Terminal 2 — frontend (proxies /api to http://localhost:3001)
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

`<Markdown>` sanitizes rendered HTML during server-side rendering as well as in the browser before using `dangerouslySetInnerHTML`. If the default `dompurify` export is not usable in a server environment, react-chorus falls back to a conservative sanitizer that removes executable tags, event-handler attributes, and JavaScript URLs. Apps that already create an isomorphic DOMPurify instance can pass it via `<Markdown sanitizer={...} />`.

## API

### `<Chorus>`

Message source modes are mutually exclusive:

- Controlled: pass `value` + `onChange` and keep the canonical message list in your state.
- Uncontrolled with a seed: pass `initialMessages` (or legacy `messages`) and let Chorus manage subsequent updates internally.
- Uncontrolled with persistence: pass `persistenceKey` without `value`; passing both makes `value` win, so built-in persistence is bypassed.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `transport` | `string \| Transport` | — | Simple path: URL to POST to, or a custom Transport function. Chorus handles all streaming. |
| `systemPrompt` | `string` | — | Transport-path convenience prop. Prepends a hidden `system` message to the request history for every send. |
| `connector` | `Connector \| 'auto' \| 'openai' \| 'anthropic' \| 'gemini'` | `'auto'` | SSE connector used to parse the stream. `'auto'` detects OpenAI, Anthropic, and Gemini; pass an explicit name when the format is known. |
| `onSend` | `(text, messages, helpers) => Message \| void \| Promise<Message \| void>` | — | Advanced path: called when the user submits a message. Use `helpers.appendAssistant`/`helpers.finalizeAssistant` to stream tokens, or return a complete assistant `Message` for non-streaming replies. |
| `value` | `Message[]` | — | Controlled message list. Pair with `onChange`; Chorus renders this array as the source of truth. |
| `onChange` | `(messages: Message[]) => void` | — | Called whenever Chorus wants to change the message list in controlled mode (`value` is provided). Not called for legacy `messages`-only uncontrolled state. |
| `messages` | `Message[]` | — | Legacy initial-only seed for uncontrolled mode. Read once on mount; later prop changes are ignored. Prefer `initialMessages` for seeding or `value` + `onChange` for controlled mode. |
| `initialMessages` | `Message[]` | — | Initial-only seed for uncontrolled mode. Useful for welcome messages; `system` and `tool` messages are hidden by default via `hiddenRoles`. |
| `placeholder` | `string` | `"Message…"` | Input placeholder text. |
| `accept` | `string` | — | Forwarded to the file-picker `<input accept>`. Omitting the prop hides the attach button entirely. |
| `sending` | `boolean` | — | Override the sending state (useful when you manage it externally via `useChorusStream`). |
| `palette` | `Palette` | dark theme | Custom color palette for theming, including `actionText`, `actionHoverBg`, `actionHoverText`, `errorBg`, `errorBorder`, and `errorText`. |
| `codeBlockTheme` | `'dark' \| 'light'` | `'dark'` | Code block syntax-highlight theme. |
| `minAssistantDelayMs` | `number` | `300` | Minimum ms before showing the first assistant token. |
| `errorMessage` | `string` | `'Something went wrong. Please try again.'` | Friendly message shown in the error banner. Raw transport errors are never surfaced in the UI. |
| `onError` | `(error: Error) => void` | — | Called for any non-abort error from a send or stream. The raw `Error` goes here; the UI shows `errorMessage`. |
| `onChunk` | `(chunk: string, messageId: string) => void` | — | Observation hook called for each streamed token. Receives the assistant `messageId` so callers can correlate chunks with a specific message. Does **not** affect streaming behaviour. |
| `persistenceKey` | `string` | — | Uncontrolled-mode persistence key. When set without `value`, Chorus saves/restores messages using this key (defaults to localStorage). If `value` is provided, controlled state wins and built-in persistence is not used. |
| `persistenceStorage` | `StorageAdapter` | `localStorage` | Custom storage adapter for persistenceKey. |
| `headless` | `boolean` | `false` | Strip all default styles and inline style injection. |
| `renderMessage` | `(message: Message) => ReactNode` | — | Custom per-message renderer. Return `null` to fall back to default rendering. |
| `hiddenRoles` | `Role[]` | `['system', 'tool']` | Message roles hidden from the transcript. Pass `['system']` to show tool calls while hiding system prompts, or `[]` to show all roles. `<Chorus>` accepts `hiddenRoles` only — `showSystemMessages` exists on `<ChatWindow>` for backwards compatibility. |

### `helpers` (passed to `onSend`)

| Helper | Description |
|--------|-------------|
| `appendAssistant(chunk)` | Append a text chunk to the current assistant message. |
| `finalizeAssistant()` | Mark the assistant message complete. |
| `signal` | `AbortSignal` — aborted when the user hits Stop. |

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

### Hiding system messages while showing tool calls

`<Chorus>` uses `hiddenRoles` to control which roles appear in the transcript (`showSystemMessages` is only available on `<ChatWindow>`, for backwards compatibility). A common agent-UI pattern is to render tool call blocks while still hiding system prompts:

```tsx
<Chorus
  transport="/api/chat"
  hiddenRoles={['system']} // show user, assistant, and tool — hide system prompts
/>
```

Pass `hiddenRoles={[]}` to show every role, or omit it to keep the default `['system', 'tool']`.

For controlled mode, seed your own state instead of using `initialMessages`, and include hidden system/tool messages directly when you want full control over the request history:

```tsx
const [messages, setMessages] = React.useState<Message[]>([
  { id: 'sys', role: 'system', text: 'You are a concise support assistant.' },
  { id: 'welcome', role: 'assistant', text: 'Hi! How can I help?' },
]);

<Chorus value={messages} onChange={setMessages} transport="/api/chat" />
```

### `useChorusStream(transport, opts?)`

```ts
const { send, abort, sending } = useChorusStream(transport, { connector: 'openai' });
```

- `transport` — async function `(text, history, signal) => Promise<Response>`. Use `createFetchSSETransport(url)` or write your own.
- `opts.connector` — `'openai'` | `'anthropic'` | `'gemini'` | `'auto'` | custom `Connector`. Defaults to `'auto'` which handles OpenAI, Gemini, Anthropic JSON, plain-text SSE, and in-band `{ error }` payloads.

### `createFetchSSETransport(url, init?)`

Returns a `Transport` that POSTs JSON to `url` and reads the response as a Server-Sent Events stream.

| Option | Type | Default | Description |
|---|---|---|---|
| `formatBody` | `(text, history) => BodyInit` | `JSON.stringify({ prompt, history })` | Serialise the outgoing request body |
| *(any `RequestInit` field)* | | | Forwarded to `fetch` (e.g. `headers`, `credentials`) |

```ts
// OpenAI-compatible backend
const transport = createFetchSSETransport('/api/chat', {
  formatBody: (text, history) =>
    JSON.stringify({ model: 'gpt-4o', messages: history, stream: true }),
});

// FastAPI / LangChain backend
const transport = createFetchSSETransport('/api/chat', {
  formatBody: (text, history) => JSON.stringify({ messages: history }),
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
| `formatMessage` | `(text, history) => string` | `JSON.stringify({ prompt, history })` | Serialise the outgoing request |

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

The block shows the tool name in a header. Clicking expands it to reveal the input and output formatted as JSON. Tool messages are hidden by default alongside system messages; pass `hiddenRoles={['system']}` to `<Chorus>` or `<ChatWindow>` to display tool calls while keeping system prompts hidden.

### Custom renderer via `renderMessage`

Supply a `renderMessage` render-prop to take full control of how any message is displayed. Return `null` to fall back to the default renderer for that message.

```tsx
<Chorus
  messages={messages}
  hiddenRoles={['system']} // show tool calls while still hiding system prompts
  renderMessage={(msg) => {
    if (msg.role === 'tool' && msg.toolCall) {
      return (
        <div key={msg.id} className="my-tool-step">
          <strong>{msg.toolCall.name}</strong>
          <pre>{JSON.stringify(msg.toolCall.output, null, 2)}</pre>
        </div>
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
interface MessageBubbleProps {
  message: Message;            // the message to render, including attachments
  className?: string;          // merged onto the outer .chorus-msg element
  style?: React.CSSProperties; // merged onto the outer .chorus-msg element
  codeTheme?: 'dark' | 'light'; // defaults to 'dark'
  headless?: boolean;          // forwards headless mode to Markdown; defaults to false
  streaming?: boolean;         // forwards Markdown's escaped plain-text streaming mode
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

### Default renderer

When neither `renderMessage` nor a custom `MessageBubble` is used, each message renders as:

```html
<div class="chorus-msg chorus-{role}">
  <div class="chorus-msg-content">
    <div class="chorus-bubble"><!-- attachments + Markdown content --></div>
    <div class="chorus-actions"><!-- optional action buttons --></div>
  </div>
</div>
```

`<MessageBubble message={message} />` uses the same `.chorus-msg > .chorus-msg-content > .chorus-bubble` structure, so it preserves the default message width and role alignment when used from `renderMessage`.

Target these classes in your CSS to restyle without a render prop:

```css
.chorus-msg.chorus-user   .chorus-bubble { background: #0070f3; color: #fff; }
.chorus-msg.chorus-assistant .chorus-bubble { background: #f0f0f0; color: #111; }
```

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

- **`<ChatWindow messages={…} typing={…} />`** — renders the scrollable message list with a typing indicator. It accepts `hiddenRoles?: Role[]` (default `['system', 'tool']`); `showSystemMessages` is deprecated but remains supported as an alias for showing all roles.
- **`<ChatInput value onSend onStop placeholder sending />`** — the text input and send/stop button.
- **`<ChorusTheme palette={…}>`** — applies theme CSS variables to any subtree.
- **`<Markdown text={…} codeTheme="dark" />`** — standalone markdown renderer with syntax highlighting and copy buttons. It supports `streaming` to render escaped plain text until finalization and `sanitizer` to provide a custom DOMPurify-compatible sanitizer for SSR.
- **`<MessageBubble message={…} />`** — renders the default bubble for one message, including attachments. Accepts `className`, `style`, `codeTheme`, and `headless` for decoration without replacing the full renderer.

## Message Shape

```ts
type Role = 'user' | 'assistant' | 'system' | 'tool';

interface ToolCall {
  name: string;
  input?: unknown;
  output?: unknown;
}

interface Message<TMeta = Record<string, unknown>> {
  id: string;
  role: Role;
  text: string; // supports CommonMark + GFM
  toolCall?: ToolCall; // populated when role === 'tool'
  metadata?: TMeta; // optional typed data (timestamps, model, latency, etc.)
}
```

`Message` defaults to arbitrary metadata for backwards compatibility. Pass a type argument when your app stores structured metadata:

```ts
type ChatMessage = Message<{
  timestamp: Date;
  model: string;
  latencyMs: number;
}>;

const message: ChatMessage = {
  id: '1',
  role: 'assistant',
  text: 'Hello!',
  metadata: {
    timestamp: new Date(),
    model: 'gpt-4o-mini',
    latencyMs: 420,
  },
};

const latency = message.metadata?.latencyMs;
```

The generic `Message` declaration shape is a minor semver-level type declaration change while remaining source-compatible.

## License

MIT
