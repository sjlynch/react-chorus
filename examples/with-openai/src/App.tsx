import 'react-chorus/styles.css';
import { Chorus, createFetchSSETransport, useChorusStream } from 'react-chorus';
import type { ChorusOnSend, Message } from 'react-chorus';
import React from 'react';

// Transport posts { prompt, history } to /api/chat and reads back an SSE stream.
// Vite proxies /api → http://localhost:3001 in dev (see vite.config.ts).
const transport = createFetchSSETransport('/api/chat');

export default function App() {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const { send, sending } = useChorusStream(transport, { connector: 'openai' });

  const handleSend: ChorusOnSend = async (
    text,
    msgs,
    { appendAssistant, finalizeAssistant, signal },
  ) => {
    await send(
      text,
      msgs,
      { onChunk: appendAssistant, onDone: finalizeAssistant },
      signal
    );
  };

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Chorus
        value={messages}
        onChange={setMessages}
        onSend={handleSend}
        sending={sending}
        placeholder="Type a message and press Enter…"
        accept="image/*"
      />
    </div>
  );
}
