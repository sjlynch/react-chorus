import { Chorus } from '../../Chorus';
import type { Message } from '../../types';
import { DEMO_PALETTE } from './palettes';
import { artifactsTransport } from './artifactsTransport';

const WELCOME_MESSAGE: Message = {
  id: 'welcome-artifacts',
  role: 'assistant',
  text: "When the model emits long content — code, HTML, a document — Chorus aggregates a reserved `__artifact` tool call into a side panel instead of inflating the transcript. The inline `ArtifactCard` shows the title with an **Open** button; repeated emissions with the same `id` stack as versions navigable from the panel header.\n\nTry the prompts below to emit each kind, then ask **\"revise the debounce helper with a leading flag\"** to add a second version of the same artifact.",
};

const SUGGESTED_PROMPTS = [
  'Build me a Snake game I can play',
  'Write a TypeScript debounce helper',
  'Draft the next release notes',
  'Revise the debounce helper with a leading flag',
];

export function ArtifactsTab() {
  return (
    <Chorus
      transport={artifactsTransport}
      connector="openai"
      persistenceKey="react-chorus-pg:artifacts"
      initialMessages={[WELCOME_MESSAGE]}
      suggestedPrompts={SUGGESTED_PROMPTS}
      placeholder="Ask for a Snake game, a debounce helper, or release notes…"
      showClearButton
      palette={DEMO_PALETTE}
    />
  );
}
