# Chorus

A React streaming chat UI library with SSE support and provider connectors.

## Connectors

Connectors tell Chorus how to parse the streaming response from different AI providers. Pass a connector name or object via `useChorusStream`'s `connector` option.

### Built-in connectors

| Name | Provider | SSE format |
|------|----------|------------|
| `'openai'` | OpenAI Chat Completions | `choices[*].delta.content` |
| `'anthropic'` | Anthropic Messages API | `content_block_delta` / `delta.text` |
| `'auto'` *(default)* | Auto-detect | Tries OpenAI, then Anthropic, then plain text |

### Usage

```tsx
import { useChorusStream, createFetchSSETransport } from 'chorus';

// OpenAI
const { send } = useChorusStream(transport, { connector: 'openai' });

// Anthropic (Claude)
const { send } = useChorusStream(transport, { connector: 'anthropic' });

// Auto-detect (default)
const { send } = useChorusStream(transport);
```

### Custom connector

```tsx
import type { Connector } from 'chorus';

const myConnector: Connector = {
  name: 'my-provider',
  extract(data: string) {
    if (data === 'DONE') return { done: true };
    const obj = JSON.parse(data);
    return obj.text ? { text: obj.text } : null;
  }
};

const { send } = useChorusStream(transport, { connector: myConnector });
```

## Anthropic SSE format

The Anthropic Messages API streams server-sent events. The `anthropicConnector` extracts text from `content_block_delta` events and signals completion on `message_stop`:

```
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: message_stop
data: {"type":"message_stop"}
```

---

## Development

This project uses React + TypeScript + Vite.

### ESLint

For production applications, enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
])
```
