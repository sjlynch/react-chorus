import 'react-chorus/styles.css';
import { Chorus } from 'react-chorus';
import type { Transport } from 'react-chorus';

/**
 * Three zero-backend mock transports — one per provider — that each emit the
 * exact SSE shape the matching connector parses. No API keys required: every
 * reply is generated locally. To talk to real APIs, swap each provider's
 * `transport` for a `createFetchSSETransport('/api/<provider>/chat')` and
 * point those routes at your own proxy. The connector wiring below does not
 * change.
 */
const mockOpenAITransport: Transport = async (text, _history, signal) => {
  const reply = `(openai) You said: ${text}`;
  const frames: string[] = [
    ...reply.split(' ').map((word, i) =>
      JSON.stringify({
        choices: [{
          index: 0,
          delta: { content: i === 0 ? word : ` ${word}` },
        }],
      }),
    ),
    '[DONE]',
  ];
  return streamFrames(frames, signal);
};

const mockAnthropicTransport: Transport = async (text, _history, signal) => {
  const reply = `(anthropic) You said: ${text}`;
  const frames: string[] = [
    ...reply.split(' ').map((word, i) =>
      JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: i === 0 ? word : ` ${word}` },
      }),
    ),
    JSON.stringify({ type: 'message_stop' }),
  ];
  return streamFrames(frames, signal);
};

const mockGeminiTransport: Transport = async (text, _history, signal) => {
  const reply = `(gemini) You said: ${text}`;
  const words = reply.split(' ');
  const frames: string[] = words.map((word, i) => {
    const part = { text: i === 0 ? word : ` ${word}` };
    const candidate: Record<string, unknown> = { index: 0, content: { parts: [part] } };
    if (i === words.length - 1) candidate.finishReason = 'STOP';
    return JSON.stringify({ candidates: [candidate] });
  });
  return streamFrames(frames, signal);
};

function streamFrames(frames: string[], signal: AbortSignal): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) {
        if (signal.aborted) break;
        await new Promise(resolve => setTimeout(resolve, 30));
        controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

export default function App() {
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Chorus
        providers={{
          openai: { transport: mockOpenAITransport, connector: 'openai', label: 'OpenAI', modelId: 'gpt-4o-mini' },
          anthropic: { transport: mockAnthropicTransport, connector: 'anthropic', label: 'Claude', modelId: 'claude-3-5-sonnet' },
          gemini: { transport: mockGeminiTransport, connector: 'gemini', label: 'Gemini', modelId: 'gemini-2.5-flash' },
        }}
        defaultProvider="openai"
        placeholder="Pick a provider, then send. Or type /model:anthropic to switch."
        suggestedPrompts={[
          'Ask each provider for a short greeting',
          'Compare how each connector renders text',
        ]}
        errorMessage="One of the providers could not complete that request."
        onError={(error) => console.error(error)}
      />
    </div>
  );
}
