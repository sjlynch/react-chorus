import type { Message } from '../types';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  text: "**Welcome to react-chorus.** This playground streams a fake OpenAI-style SSE response through Chorus's real connector + stream pipeline — exactly the code path you'd ship with a real backend.\n\nTry a prompt below, then check the sidebar for a multi-conversation example. Messages persist locally — refresh the page and they're still here.",
};

export const SUGGESTED_PROMPTS = [
  "What's the weather in Tokyo?",
  'Show me a code sample',
  'Give me a markdown demo',
];

export const REPLY_TEXTS = {
  code: "Here's the smallest possible integration:\n\n```tsx\nimport { Chorus } from 'react-chorus';\nimport 'react-chorus/styles.css';\n\nexport default function App() {\n  return <Chorus transport=\"/api/chat\" />;\n}\n```\n\nPoint `transport` at any SSE endpoint (OpenAI, Anthropic, Gemini, or your own) and the connector auto-detects the format.",
  summary: "react-chorus gives you:\n\n- **Streaming UI** with token-by-token rendering, stop, and retry\n- **Reasoning traces** and **tool calls** rendered automatically when the connector detects them\n- **Multi-conversation** state via `useConversations` + `ConversationList`\n- **Persistence** through any `StorageAdapter` (localStorage by default)\n- **Attachments** via paste, drop, or file picker\n- **Themeable** through ~20 CSS palette variables",
  markdown: "Here's a quick markdown tour:\n\n### Lists work\n\n1. Numbered items\n2. *Italic* and **bold** text\n3. `inline code`\n\n> Block quotes render cleanly too.\n\n```js\nconst reader = response.body.getReader();\nconst { value, done } = await reader.read();\n```\n\nAnd inline links: [docs](https://github.com/sjlynch/react-chorus).",
  weather: "It's currently **22 °C and partly cloudy** in Tokyo, with 58% humidity and light winds out of the east. Comfortable jacket weather — no rain expected for the next few hours.",
  default: "react-chorus keeps the drop-in defaults while exposing composable hooks and components. The reply you just saw streamed through a mock `Transport` — swap that for your real SSE endpoint and the same UI keeps working.",
};
