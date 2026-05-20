import 'react-chorus/styles.css';
import { Chorus } from 'react-chorus';
import type { Transport } from 'react-chorus';

/**
 * Zero-backend mock transport — no API key required.
 *
 * It returns an SSE-shaped `Response` whose `data:` frames are exactly the
 * Vercel AI SDK **UI message stream** events documented in the root README's
 * "Vercel AI SDK stream format" section. The built-in `ai-sdk` connector maps
 * `reasoning-delta` to reasoning and `text-delta` to assistant text, terminates
 * on `finish`, and silently ignores the lifecycle frames (`start`,
 * `text-start`, `text-end`, `reasoning-start`, `reasoning-end`).
 *
 * To talk to a real model, delete `mockAiSdkTransport` and pass
 * `transport="/api/chat"` (or `createFetchSSETransport('/api/chat')`) pointing
 * at the Next.js App Router route described in this example's README — that
 * route's `result.toUIMessageStreamResponse()` emits these very frames.
 */
const mockAiSdkTransport: Transport = async (text, _history, signal) => {
  const reasoning = 'Planning a concise answer for the ai-sdk connector demo.';
  const reply = `Streaming a reply through the ai-sdk connector. You said: "${text}"`;

  const frames: string[] = [
    JSON.stringify({ type: 'start' }),
    JSON.stringify({ type: 'reasoning-start', id: 'r1' }),
    JSON.stringify({ type: 'reasoning-delta', id: 'r1', delta: reasoning }),
    JSON.stringify({ type: 'reasoning-end', id: 'r1' }),
    JSON.stringify({ type: 'text-start', id: 't1' }),
    ...reply.split(' ').map((word, i) =>
      JSON.stringify({ type: 'text-delta', id: 't1', delta: i === 0 ? word : ` ${word}` }),
    ),
    JSON.stringify({ type: 'text-end', id: 't1' }),
    JSON.stringify({ type: 'finish' }),
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
        transport={mockAiSdkTransport}
        connector="ai-sdk"
        placeholder="Type a message and press Enter…"
        suggestedPrompts={[
          'Stream a reply through the ai-sdk connector',
          'Show me UI-message-stream parsing',
        ]}
        errorMessage="The Vercel AI SDK example could not complete that request. Please try again."
        onError={(error) => console.error(error)}
      />
    </div>
  );
}
