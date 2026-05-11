# Chorus

A React chat UI library with streaming support.

## Quick start

```tsx
import { Chorus } from 'chorus';

<Chorus onSend={async (text, messages, { appendAssistant, finalizeAssistant, signal }) => {
  // call your LLM here, pipe chunks via appendAssistant(chunk)
  finalizeAssistant();
}} />
```

## Custom message rendering

### `renderMessage` render prop

Pass `renderMessage` to `Chorus` or `ChatWindow` to fully replace how each message is rendered. The function receives a `Message` and must return a `ReactNode`.

```tsx
import { Chorus, MessageBubble } from 'chorus';

<Chorus
  renderMessage={(message) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <img src={message.role === 'user' ? userAvatar : botAvatar} style={{ width: 32, borderRadius: '50%' }} />
      <div>
        <span style={{ fontSize: 11, color: '#888' }}>{new Date().toLocaleTimeString()}</span>
        <MessageBubble message={message} />
      </div>
    </div>
  )}
/>
```

### `MessageBubble` component

`MessageBubble` renders the default bubble for a single message. Import it to use as a base when you only need to add decoration (avatars, timestamps, status badges) around the existing look.

```tsx
import { MessageBubble } from 'chorus';

// props
interface MessageBubbleProps {
  message: Message;           // the message to render
  className?: string;         // merged onto the outer .chorus-msg element
  style?: React.CSSProperties; // merged onto the outer .chorus-msg element
  codeTheme?: 'dark' | 'light'; // defaults to 'dark'
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
  <div class="chorus-bubble"><!-- Markdown content --></div>
</div>
```

Target these classes in your CSS to restyle without a render prop:

```css
.chorus-msg.chorus-user   .chorus-bubble { background: #0070f3; color: #fff; }
.chorus-msg.chorus-assistant .chorus-bubble { background: #f0f0f0; color: #111; }
```

## Props

### `Chorus`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `messages` | `Message[]` | `[]` | Initial messages (uncontrolled) |
| `value` | `Message[]` | — | Controlled message list |
| `onChange` | `(msgs: Message[]) => void` | — | Called on every message update |
| `onSend` | `(text, messages, helpers) => Promise<void>` | — | Called when user sends a message |
| `placeholder` | `string` | — | Input placeholder text |
| `palette` | `Palette` | — | Theme color overrides |
| `sending` | `boolean` | — | Controlled sending state |
| `minAssistantDelayMs` | `number` | `1000` | Minimum delay before showing assistant response |
| `codeBlockTheme` | `'dark' \| 'light'` | `'dark'` | Code block syntax highlight theme |
| `renderMessage` | `(message: Message) => ReactNode` | — | Custom message renderer |

### `ChatWindow`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `messages` | `Message[]` | — | Messages to display |
| `typing` | `boolean` | — | Show typing indicator |
| `codeTheme` | `'dark' \| 'light'` | `'dark'` | Code block theme |
| `renderMessage` | `(message: Message) => ReactNode` | — | Custom message renderer |
