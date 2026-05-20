import 'react-chorus/styles.css';
import React from 'react';
import { Chorus, createWebSocketTransport, useChorusStream } from 'react-chorus';
import type { ChorusOnSend, Message } from 'react-chorus';

/**
 * `createWebSocketTransport` opens a socket to the local `ws` server in
 * `./server`. That server streams Anthropic Messages frames; the WebSocket
 * transport treats each inbound frame as one SSE payload, so the built-in
 * `anthropic` connector parses `content_block_delta` / `message_stop` exactly
 * as it would over an HTTP SSE stream.
 *
 * The bundled server uses canned frames so the demo runs with no API key. Its
 * README shows the one-line swap to the real `ws` + `@anthropic-ai/sdk` backend
 * documented in the root README's "Using the WebSocket transport" section.
 */
const WS_URL = 'ws://localhost:8787';

export default function App() {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const transport = React.useMemo(() => createWebSocketTransport(WS_URL), []);
  const { send, sending } = useChorusStream(transport, { connector: 'anthropic' });

  const handleSend: ChorusOnSend = async (text, msgs, helpers) => {
    await send(
      text,
      msgs,
      helpers.streamCallbacks?.() ?? { onChunk: helpers.appendAssistant, onDone: helpers.finalizeAssistant },
      helpers.signal,
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
        suggestedPrompts={[
          'Stream a reply over a WebSocket',
          'Show me the anthropic connector over ws',
        ]}
        errorMessage="The WebSocket example could not complete that request. Make sure the ws server is running on port 8787."
        onError={(error) => console.error(error)}
      />
    </div>
  );
}
