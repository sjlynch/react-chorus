import { Chorus } from '../../Chorus';
import type { Message } from '../../types';
import { DEMO_PALETTE } from './palettes';
import { streamingBasicsTransport } from './streamingBasicsTransport';

const WELCOME_MESSAGE: Message = {
  id: 'welcome-basics',
  role: 'assistant',
  text: "**Welcome to react-chorus.** This tab streams a fake OpenAI-style SSE response through the real connector + stream pipeline — exactly the code path you'd ship with a real backend.\n\nTry a prompt below: ask about the weather to see a tool call, ask for a code sample, or click **Force a transport error** to see the retry/dismiss UI.",
};

const SUGGESTED_PROMPTS = [
  "What's the weather in Tokyo?",
  'Show me a code sample',
  'Force a transport error',
];

export function StreamingBasicsTab() {
  return (
    <Chorus
      transport={streamingBasicsTransport}
      persistenceKey="react-chorus-pg:streaming-basics"
      initialMessages={[WELCOME_MESSAGE]}
      suggestedPrompts={SUGGESTED_PROMPTS}
      placeholder="Ask react-chorus anything…"
      showClearButton
      palette={DEMO_PALETTE}
    />
  );
}
