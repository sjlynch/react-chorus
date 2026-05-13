import React from 'react';
import ReactDOM from 'react-dom/client';
import { Chorus, type ChorusOnSend } from './Chorus';

const DEMO_CHUNK_DELAY_MS = 60;

const REPLIES = [
  "That's a great point! Let me think about that...",
  "Interesting question. Here's what I know about it.",
  "I'd be happy to help with that!",
  "Sure, let me walk you through it step by step.",
];

const handleSend: ChorusOnSend = async (
  text,
  _messages,
  { appendAssistant, finalizeAssistant, signal },
) => {
  const reply = REPLIES[Math.floor(Math.random() * REPLIES.length)] + ` (You said: "${text}")`;
  const words = reply.split(' ');

  for (const word of words) {
    if (signal.aborted) break;
    await new Promise((r) => setTimeout(r, DEMO_CHUNK_DELAY_MS));
    appendAssistant(word + ' ');
  }

  finalizeAssistant();
};

function App() {
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Chorus
        onSend={handleSend}
        placeholder="Type a message and press Enter…"
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
