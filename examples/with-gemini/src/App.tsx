import 'react-chorus/styles.css';
import { Chorus } from 'react-chorus';
import type { Transport } from 'react-chorus';

/**
 * Zero-backend mock transport — no API key required.
 *
 * It returns an SSE-shaped `Response` whose `data:` frames are exactly the
 * Gemini `generateContent` streaming chunks documented in the root README's
 * "Gemini SSE format" section: each chunk carries a `candidates` array, a
 * `thought: true` part maps to reasoning, plain `text` parts map to the reply,
 * and the final chunk sets `finishReason: "STOP"`. The built-in `gemini`
 * connector parses them, so this demo drives the exact code path a real
 * Gemini proxy would.
 *
 * To talk to a real model, delete `mockGeminiTransport` and pass
 * `transport="/api/chat"` (or `createFetchSSETransport('/api/chat')`) pointing
 * at the Express + `@google/generative-ai` proxy described in this example's
 * README — the connector wiring below does not change.
 */
const mockGeminiTransport: Transport = async (text, _history, signal) => {
  const reasoning = 'Inspecting the prompt and composing a Gemini-style answer.';
  const reply = `Streaming a reply through the gemini connector. You said: "${text}"`;

  const chunk = (parts: Array<Record<string, unknown>>, finishReason?: string) =>
    JSON.stringify({
      candidates: [{ index: 0, content: { parts }, ...(finishReason ? { finishReason } : {}) }],
    });

  const words = reply.split(' ');
  const frames: string[] = [
    chunk([{ text: reasoning, thought: true }]),
    ...words.map((word, i) =>
      i === words.length - 1
        ? chunk([{ text: ` ${word}` }], 'STOP')
        : chunk([{ text: i === 0 ? word : ` ${word}` }]),
    ),
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
        transport={mockGeminiTransport}
        connector="gemini"
        placeholder="Type a message and press Enter…"
        suggestedPrompts={[
          'Stream a reply through the gemini connector',
          'Show me how Gemini candidates parse',
        ]}
        errorMessage="The Gemini example could not complete that request. Please try again."
        onError={(error) => console.error(error)}
      />
    </div>
  );
}
