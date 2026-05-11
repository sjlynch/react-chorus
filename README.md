# react-chorus

Composable chat UI components for React. Handles streaming SSE responses, markdown rendering with syntax highlighting, a typing indicator, and an abort button — so you can focus on the backend.

## Install

```bash
npm install react-chorus
```

Import the stylesheet once at your app entry point:

```tsx
import 'react-chorus/styles.css';
```

## Quickstart

The simplest setup uses the `Chorus` component with an `onSend` handler. The handler receives `appendAssistant` / `finalizeAssistant` helpers that let you stream tokens into the chat window one chunk at a time.

```tsx
import 'react-chorus/styles.css';
import { Chorus } from 'react-chorus';

export default function App() {
  return (
    <div style={{ height: '100dvh' }}>
      <Chorus
        onSend={async (text, _messages, { appendAssistant, finalizeAssistant, signal }) => {
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: text }),
            signal,
          });

          const reader = res.body!.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            appendAssistant(decoder.decode(value));
          }

          finalizeAssistant();
        }}
        placeholder="Type a message…"
      />
    </div>
  );
}
```

## Using the built-in SSE transport

For OpenAI-compatible streaming endpoints use `createFetchSSETransport` + `useChorusStream`:

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

`createFetchSSETransport(url)` posts `{ prompt, history }` to your endpoint and reads the response as a Server-Sent Events stream. The `openai` connector parses the standard `choices[*].delta.content` shape.

### Minimal Express + OpenAI backend

```js
// server/index.js
import express from 'express';
import OpenAI from 'openai';

const app = express();
const openai = new OpenAI(); // reads OPENAI_API_KEY from env

app.use(express.json());

app.post('/api/chat', async (req, res) => {
  const { prompt, history = [] } = req.body;

  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.text })),
    { role: 'user', content: prompt },
  ];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  const stream = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages, stream: true });

  for await (const chunk of stream) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }

  res.write('data: [DONE]\n\n');
  res.end();
});

app.listen(3001);
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

## API

### `<Chorus>`

| Prop | Type | Description |
|------|------|-------------|
| `onSend` | `(text, messages, helpers) => Promise<void>` | Called when the user submits a message. Use `helpers.appendAssistant` to stream tokens and `helpers.finalizeAssistant` when done. |
| `value` | `Message[]` | Controlled message list. |
| `onChange` | `(messages: Message[]) => void` | Called whenever the message list changes (controlled mode). |
| `messages` | `Message[]` | Initial messages (uncontrolled mode). |
| `placeholder` | `string` | Input placeholder text. |
| `sending` | `boolean` | Override the sending state (useful when you manage it externally via `useChorusStream`). |
| `palette` | `Palette` | Custom color palette for theming. |
| `codeBlockTheme` | `'dark' \| 'light'` | Code block syntax-highlight theme (default `'dark'`). |
| `minAssistantDelayMs` | `number` | Minimum ms before showing the first assistant token (default `1000`). |

### `useChorusStream(transport, opts?)`

```ts
const { send, abort, sending } = useChorusStream(transport, { connector: 'openai' });
```

- `transport` — async function `(text, history, signal) => Promise<Response>`. Use `createFetchSSETransport(url)` or write your own.
- `opts.connector` — `'openai'` | `'auto'` | custom `Connector`. Defaults to `'auto'` which handles both OpenAI JSON and plain-text SSE.

### `createFetchSSETransport(url, init?)`

Returns a `Transport` that POSTs `{ prompt, history }` as JSON and returns the raw `Response` for SSE reading.

### Custom connector

```ts
import type { Connector } from 'react-chorus';

const myConnector: Connector = {
  name: 'my-api',
  extract(data) {
    if (data === '[DONE]') return { done: true };
    const obj = JSON.parse(data);
    return obj.token ? { text: obj.token } : null;
  },
};
```

## License

MIT
