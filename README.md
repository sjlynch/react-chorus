# react-chorus

A composable, streaming-first chat UI library for React. Drop in a `<Chorus>` component, wire up your AI endpoint, and get a fully rendered chat interface with markdown, syntax highlighting, and streaming out of the box.

## Install

```bash
npm install react-chorus
```

## Quick Start

```tsx
import { Chorus } from 'react-chorus';
import 'react-chorus/styles.css';

export default function App() {
  return (
    <Chorus
      placeholder="Ask anything…"
      onSend={async (text, history, { appendAssistant, finalizeAssistant, signal }) => {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: text, history }),
          signal,
        });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        for await (const chunk of readChunks(reader)) {
          appendAssistant(decoder.decode(chunk));
        }
        finalizeAssistant();
      }}
    />
  );
}

async function* readChunks(reader: ReadableStreamDefaultReader<Uint8Array>) {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield value;
  }
}
```

## Props

### `<Chorus>`

| Prop | Type | Default | Description |
|---|---|---|---|
| `onSend` | `(text, messages, helpers) => Promise<void>` | — | Called when user sends a message. Stream via `helpers.appendAssistant` / `helpers.finalizeAssistant`, or return a `Message` for a one-shot response. |
| `messages` | `Message[]` | — | Controlled message list. |
| `onChange` | `(messages: Message[]) => void` | — | Callback when the message list changes. |
| `placeholder` | `string` | `"Message…"` | Input field placeholder. |
| `palette` | `Palette` | dark theme | Color overrides — see [Theming](#theming). |
| `codeBlockTheme` | `'dark' \| 'light'` | `'dark'` | Syntax highlight theme for code blocks. |
| `sending` | `boolean` | — | Controlled sending state. |
| `minAssistantDelayMs` | `number` | `1000` | Minimum ms before assistant message appears. |

### `helpers` (passed to `onSend`)

| Helper | Description |
|---|---|
| `appendAssistant(chunk)` | Append a text chunk to the current assistant message. |
| `finalizeAssistant()` | Mark the assistant message complete. |
| `signal` | `AbortSignal` — aborted when the user hits Stop. |

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

Available palette keys: `chatBg`, `chatText`, `border`, `assistantBubbleBg`, `assistantText`, `assistantBorder`, `userBubbleBg`, `userText`, `userBorder`, `inputAreaBg`, `inputBg`, `inputText`, `inputBorder`, `sendButtonBg`, `sendButtonText`, `focusRing`.

## Individual Components

You can compose the UI from smaller pieces:

```tsx
import { ChatWindow, ChatInput, ChorusTheme, Markdown } from 'react-chorus';
```

- **`<ChatWindow messages={…} typing={…} />`** — renders the message list with a typing indicator.
- **`<ChatInput value onSend onStop placeholder sending />`** — the text input and send/stop button.
- **`<ChorusTheme palette={…}>`** — applies theme CSS variables to any subtree.
- **`<Markdown text={…} codeTheme="dark" />`** — standalone markdown renderer with syntax highlighting and copy buttons.

## Message Shape

```ts
interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string; // supports CommonMark + GFM
}
```

## License

MIT
