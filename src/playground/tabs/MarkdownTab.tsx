import React from 'react';
import { Chorus, type ChorusRef } from '../../Chorus';
import type { Message } from '../../types';
import { DEMO_PALETTE } from './palettes';
import { markdownTransport } from './markdownTransport';

const WELCOME_MESSAGE: Message = {
  id: 'welcome-markdown',
  role: 'assistant',
  text: `Chorus parses **Markdown** out of the box — GitHub-flavored tables, syntax-highlighted code fences (lazy \`highlight.js\`), copy buttons on every fence, and a *streaming-safe* render that shows escaped plain text until the message finalizes.

Here's a quick taste — a typed Chorus integration with a custom transport:

\`\`\`tsx
import { Chorus, createFetchSSETransport } from 'react-chorus';

const transport = createFetchSSETransport('/api/chat', {
  headers: { Authorization: \`Bearer \${token}\` },
});

export function ChatPanel() {
  return <Chorus transport={transport} connector="openai" />;
}
\`\`\`

Use the chips above to stream a fuller code sample, a comparison table, or a formatting tour — or just type your own prompt.`,
};

const QUICK_PROMPTS = [
  { label: 'Code sample', prompt: 'Show me a code sample' },
  { label: 'Data table', prompt: 'Render a data table' },
  { label: 'Formatting tour', prompt: 'Give me a formatting tour' },
];

export function MarkdownTab() {
  const [codeTheme, setCodeTheme] = React.useState<'dark' | 'light'>('dark');
  const chorusRef = React.useRef<ChorusRef>(null);

  const sendQuickPrompt = (prompt: string) => {
    chorusRef.current?.send(prompt);
  };

  return (
    <div className="pg-tab-stack">
      <div className="pg-tab-toolbar">
        <span className="pg-tab-toolbar-label">Try</span>
        <div className="pg-quick-prompts">
          {QUICK_PROMPTS.map(q => (
            <button
              key={q.prompt}
              type="button"
              className="pg-quick-prompt"
              onClick={() => sendQuickPrompt(q.prompt)}
            >
              {q.label}
            </button>
          ))}
        </div>
        <span className="pg-tab-toolbar-label" style={{ marginLeft: 'auto' }}>Code theme</span>
        <div className="pg-segmented" role="radiogroup" aria-label="Code block theme">
          {(['dark', 'light'] as const).map(opt => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={codeTheme === opt}
              className={`pg-segmented-btn${codeTheme === opt ? ' pg-segmented-btn--active' : ''}`}
              onClick={() => setCodeTheme(opt)}
            >
              {opt[0].toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <Chorus
        ref={chorusRef}
        transport={markdownTransport}
        persistenceKey="react-chorus-pg:markdown"
        initialMessages={[WELCOME_MESSAGE]}
        placeholder="Ask for code, tables, or a formatting tour…"
        showClearButton
        palette={DEMO_PALETTE}
        codeBlockTheme={codeTheme}
      />
    </div>
  );
}
