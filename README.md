# react-chorus

A React component library for building chat and agent UIs with streaming support.

## Quick start

```tsx
import { Chorus } from 'react-chorus';

function App() {
  return (
    <Chorus
      onSend={async (text, messages, { appendAssistant, finalizeAssistant, signal }) => {
        const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ messages }), signal });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          appendAssistant(decoder.decode(value));
        }
        finalizeAssistant();
      }}
    />
  );
}
```

## Components

### `<Chorus>`

The top-level all-in-one component with message list and input.

| Prop | Type | Description |
|------|------|-------------|
| `messages` | `Message[]` | Initial messages (uncontrolled) |
| `value` | `Message[]` | Controlled message list |
| `onChange` | `(messages: Message[]) => void` | Called when messages change |
| `onSend` | `(text, messages, helpers) => Promise<void>` | Called when user sends a message |
| `placeholder` | `string` | Input placeholder text |
| `palette` | `Palette` | Color theme overrides |
| `codeBlockTheme` | `'dark' \| 'light'` | Code block color scheme |
| `renderMessage` | `(message: Message) => ReactNode` | Custom message renderer |

### `<ChatWindow>`

Renders the message list. Accepts the same `messages`, `typing`, `codeTheme`, and `renderMessage` props.

### `<ChatInput>`

Standalone text input with send/stop controls.

## Tool calls and agent steps

For agentic UIs, react-chorus provides first-class support for tool call rendering via the `role: 'tool'` message type.

### Message type

```ts
type Role = 'user' | 'assistant' | 'tool';

interface ToolCall {
  name: string;       // tool name displayed in the header
  input?: unknown;    // shown in the collapsible "Input" section
  output?: unknown;   // shown in the collapsible "Output" section
}

interface Message {
  id: string;
  role: Role;
  text: string;
  toolCall?: ToolCall; // populated when role === 'tool'
}
```

### Built-in rendering

Push a message with `role: 'tool'` and a `toolCall` payload. `ChatWindow` renders it as a collapsible block automatically:

```tsx
const [messages, setMessages] = React.useState<Message[]>([]);

// After an LLM calls a tool, append the step:
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

The block shows the tool name in a header. Clicking expands it to reveal the input and output formatted as JSON.

### Custom renderer via `renderMessage`

Supply a `renderMessage` render-prop to take full control of how any message is displayed. Return `null` to fall back to the default renderer for that message.

```tsx
<Chorus
  messages={messages}
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

## Streaming

Use `useChorusStream` or `createFetchSSETransport` for SSE-based streaming:

```tsx
import { useChorusStream, createFetchSSETransport } from 'react-chorus';

const { messages, send, sending } = useChorusStream({
  transport: createFetchSSETransport({ url: '/api/stream' }),
});
```

## Theming

Use `<ChorusTheme palette={...}>` or the `palette` prop on `<Chorus>` to override colors without CSS:

```tsx
<Chorus
  palette={{
    chatBg: '#0d0d0d',
    assistantBubbleBg: '#1e1e2e',
    userBubbleBg: '#2e2e3e',
  }}
/>
```

## Connectors

Connectors normalize provider-specific streaming formats. Use `autoConnector` to detect the provider automatically, or use a specific connector:

```tsx
import { openaiConnector } from 'react-chorus';
```
