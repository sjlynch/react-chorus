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
 *
 * The transport's `onOpen`/`onClose`/`onError` lifecycle callbacks drive the
 * connection-status banner below — this is the runnable reference for the
 * connection-status pattern in that README section. There is no `'connecting'`
 * state on purpose: in the default per-send-socket mode a socket opens and
 * `onOpen` fires almost immediately, so a transient "Connecting…" banner would
 * never actually be visible. A normal close reports code 1000, so only an
 * abnormal close or a socket error surfaces a banner.
 */
const WS_URL = 'ws://localhost:8787';

export default function App() {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [connectionStatus, setConnectionStatus] = React.useState('idle');

  const transport = React.useMemo(
    () =>
      createWebSocketTransport(WS_URL, {
        onOpen: () => setConnectionStatus('open'),
        onClose: (code, reason) =>
          setConnectionStatus(
            code === 1000 ? 'closed' : `disconnected (${code}: ${reason || 'no reason'})`,
          ),
        onError: () => setConnectionStatus('error'),
      }),
    [],
  );

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
      {connectionStatus.startsWith('disconnected') && (
        <div role="alert">Disconnected from the WebSocket server.</div>
      )}
      {connectionStatus === 'error' && (
        <div role="alert">WebSocket connection error — is the ws server running on port 8787?</div>
      )}
      <Chorus
        style={{ flex: 1, minHeight: 0 }}
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
