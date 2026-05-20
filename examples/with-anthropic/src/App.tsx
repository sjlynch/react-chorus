import 'react-chorus/styles.css';
import { Chorus } from 'react-chorus';
import type { Transport } from 'react-chorus';

/**
 * Zero-backend mock transport — no API key required.
 *
 * It returns an SSE-shaped `Response` whose `data:` frames are exactly the
 * Anthropic Messages streaming events documented in the root README's
 * "Anthropic SSE format" section: a `content_block_delta` carrying a
 * `thinking_delta`, then `content_block_delta`s carrying `text_delta`s,
 * terminated by `message_stop`. The built-in `anthropic` connector parses
 * them, so this demo drives the exact code path a real Anthropic proxy would.
 *
 * To talk to a real model, delete `mockAnthropicTransport` and pass
 * `transport="/api/chat"` (or `createFetchSSETransport('/api/chat')`) pointing
 * at the Express + `@anthropic-ai/sdk` proxy described in this example's
 * README — the connector wiring below does not change.
 */
const mockAnthropicTransport: Transport = async (text, _history, signal) => {
  const reasoning = 'Reading the request and drafting an Anthropic-style reply.';
  const reply = `Streaming a reply through the anthropic connector. You said: "${text}"`;

  const frames: string[] = [
    JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: reasoning },
    }),
    ...reply.split(' ').map((word, i) =>
      JSON.stringify({
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: i === 0 ? word : ` ${word}` },
      }),
    ),
    JSON.stringify({ type: 'message_stop' }),
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) {
        if (signal.aborted) break;
        await new Promise((resolve) => setTimeout(resolve, 55));
        controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
};

export default function App() {
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Chorus
        transport={mockAnthropicTransport}
        connector="anthropic"
        placeholder="Type a message and press Enter…"
        suggestedPrompts={[
          'Stream a reply through the anthropic connector',
          'Show me how reasoning deltas render',
        ]}
        errorMessage="The Anthropic example could not complete that request. Please try again."
        onError={(error) => console.error(error)}
      />
    </div>
  );
}
