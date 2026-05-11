import 'react-chorus/styles.css';
import { Chorus } from 'react-chorus';

const REPLIES = [
  "That's a great point! Let me think about that...",
  "Interesting question. Here's what I know about it.",
  "I'd be happy to help with that!",
  "Sure, let me walk you through it step by step.",
];

// Simulated streaming transport — no backend required.
// Replace this with createFetchSSETransport('/api/chat') to wire up a real backend.
async function handleSend(
  text: string,
  _messages: unknown[],
  {
    appendAssistant,
    finalizeAssistant,
    signal,
  }: {
    appendAssistant: (chunk: string) => void;
    finalizeAssistant: () => void;
    signal: AbortSignal;
  }
) {
  const reply = REPLIES[Math.floor(Math.random() * REPLIES.length)] + ` (You said: "${text}")`;
  const words = reply.split(' ');

  for (const word of words) {
    if (signal.aborted) break;
    await new Promise((r) => setTimeout(r, 60));
    appendAssistant(word + ' ');
  }

  finalizeAssistant();
}

export default function App() {
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Chorus
        onSend={handleSend}
        placeholder="Type a message and press Enter…"
      />
    </div>
  );
}
