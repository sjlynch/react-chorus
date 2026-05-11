# Chorus

A React streaming chat UI library with pluggable transports and AI connectors.

## Transports

### `createFetchSSETransport(url, init?)`

Streams tokens over HTTP using Server-Sent Events (SSE). The request is a
`POST` with `{ prompt, history }` as JSON body. Use this when your backend
speaks SSE (Express, FastAPI, etc.).

```tsx
import { Chorus, createFetchSSETransport } from 'chorus';

const transport = createFetchSSETransport('https://api.example.com/chat');

export default function App() {
  return <Chorus transport={transport} />;
}
```

---

### `createWebSocketTransport(url, opts?)`

Streams tokens over a native WebSocket connection. Each server message is
treated as one SSE payload, so the same connector/extraction pipeline applies.

Use this for backends built on Socket.IO, `ws`, Ably, Pusher, or any other
WebSocket server.

```tsx
import { Chorus, createWebSocketTransport } from 'chorus';

const transport = createWebSocketTransport('wss://api.example.com/chat');

export default function App() {
  return <Chorus transport={transport} />;
}
```

#### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `protocols` | `string \| string[]` | – | WebSocket sub-protocols passed to the constructor |
| `formatMessage` | `(text, history) => string` | `JSON.stringify({ prompt, history })` | Serialise the outgoing request |

#### Minimal Node.js `ws` server

```js
// server.js  —  npm install ws @anthropic-ai/sdk
import { WebSocketServer } from 'ws';
import Anthropic from '@anthropic-ai/sdk';

const wss = new WebSocketServer({ port: 8080 });
const client = new Anthropic();

wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    const { prompt, history } = JSON.parse(raw.toString());

    const messages = [
      ...history.map((m) => ({ role: m.role, content: m.text })),
      { role: 'user', content: prompt },
    ];

    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        // Each message must be valid JSON that your connector can parse.
        ws.send(JSON.stringify({ type: 'text', text: event.delta.text }));
      }
    }

    ws.send(JSON.stringify({ type: 'done' }));
    // ws.close() — optional; leaving it open allows reuse for the next turn.
  });
});
```

The front-end default connector expects `{ type: 'text', text: '...' }` chunks
and a `{ type: 'done' }` sentinel, matching the SSE connector format.

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
