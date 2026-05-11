# Chorus

A React chat UI component with built-in SSE streaming support.

## Quick start

```tsx
import { Chorus } from 'chorus';

// That's it — point it at your streaming API endpoint
<Chorus transport="/api/chat" />
```

Chorus POSTs `{ prompt: string, history: Message[] }` to the URL and streams the SSE response into the assistant message automatically.

## Props

| Prop | Type | Description |
|------|------|-------------|
| `transport` | `string \| Transport` | URL to POST to, or a custom fetch function. Chorus handles all streaming. |
| `onSend` | `function` | Advanced: called on every send with streaming helpers (`appendAssistant`, `finalizeAssistant`, `signal`). Use when you need full control. |
| `value` | `Message[]` | Controlled message list. |
| `onChange` | `(msgs: Message[]) => void` | Called when messages change (controlled mode). |
| `messages` | `Message[]` | Initial messages (uncontrolled mode). |
| `placeholder` | `string` | Input placeholder text. |
| `palette` | `Palette` | Theme colors. |
| `sending` | `boolean` | Override the internal sending state. |
| `minAssistantDelayMs` | `number` | Minimum ms before showing an assistant reply (default: 1000). |
| `codeBlockTheme` | `'dark' \| 'light'` | Code block color scheme (default: `'dark'`). |

## Two usage paths

### Simple path — `transport` prop

Pass a URL string or `Transport` function. Chorus handles everything:

```tsx
// String: Chorus POSTs { prompt, history } and reads the SSE stream
<Chorus transport="/api/chat" />

// Custom Transport function (same shape as fetch)
import { createFetchSSETransport } from 'chorus';

const transport = createFetchSSETransport('/api/chat', {
  headers: { Authorization: `Bearer ${token}` },
});

<Chorus transport={transport} />
```

### Advanced path — `onSend` callback

Use `onSend` when you need direct control: proxying through a custom client, handling non-SSE transports, or modifying messages before they're added.

```tsx
import { Chorus, useChorusStream, createFetchSSETransport } from 'chorus';

const { send, abort, sending } = useChorusStream(
  createFetchSSETransport('/api/chat')
);

<Chorus
  onSend={(text, history, { appendAssistant, finalizeAssistant, signal }) => {
    send(text, history, {
      onChunk: appendAssistant,
      onDone: finalizeAssistant,
    }, signal);
  }}
  sending={sending}
/>
```

## Connectors

By default Chorus auto-detects the SSE payload format. For explicit control, pass a connector to `useChorusStream`:

```tsx
import { useChorusStream, openaiConnector } from 'chorus';

const { send } = useChorusStream(transport, { connector: openaiConnector });
```

Built-in connectors: `autoConnector` (default), `openaiConnector`.

Custom connectors implement `{ name: string; extract(data: string): { text?: string; done?: boolean } | null }`.

## Controlled mode

```tsx
const [messages, setMessages] = React.useState<Message[]>([]);

<Chorus
  value={messages}
  onChange={setMessages}
  transport="/api/chat"
/>
```
