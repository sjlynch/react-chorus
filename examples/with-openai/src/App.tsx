import 'react-chorus/styles.css';
import { Chorus, createFetchSSETransport } from 'react-chorus';

// Transport posts { prompt, history } to /api/chat and reads back an SSE stream.
// Vite proxies /api → http://localhost:3001 in dev (see vite.config.ts).
const transport = createFetchSSETransport('/api/chat');

export default function App() {
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Chorus
        transport={transport}
        connector="openai"
        placeholder="Type a message and press Enter…"
        accept="image/*"
        maxAttachmentBytes={2 * 1024 * 1024}
        maxAttachments={3}
        errorMessage="The OpenAI example could not complete that request. Please try again."
        onError={(error) => console.error(error)}
      />
    </div>
  );
}
