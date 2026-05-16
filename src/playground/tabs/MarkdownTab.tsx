import React from 'react';
import { Chorus } from '../../Chorus';
import type { Message } from '../../types';
import { DEMO_PALETTE } from './palettes';
import { markdownTransport } from './markdownTransport';

const WELCOME_MESSAGE: Message = {
  id: 'welcome-markdown',
  role: 'assistant',
  text: "Chorus parses **Markdown** out of the box: GitHub-flavored tables, syntax-highlighted code fences (lazy `highlight.js`), copy buttons, sanitized HTML, and a *streaming-safe* render that shows escaped plain text until the message finalizes.\n\nTry the prompts below, and toggle the code theme on the right.",
};

const SUGGESTED_PROMPTS = [
  'Show me a code sample',
  'Render a data table',
  'Give me a formatting tour',
];

export function MarkdownTab() {
  const [codeTheme, setCodeTheme] = React.useState<'dark' | 'light'>('dark');

  return (
    <div className="pg-tab-stack">
      <div className="pg-tab-toolbar">
        <span className="pg-tab-toolbar-label">Code theme</span>
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
        transport={markdownTransport}
        persistenceKey="react-chorus-pg:markdown"
        initialMessages={[WELCOME_MESSAGE]}
        suggestedPrompts={SUGGESTED_PROMPTS}
        placeholder="Ask for code, tables, or a formatting tour…"
        showClearButton
        palette={DEMO_PALETTE}
        codeBlockTheme={codeTheme}
      />
    </div>
  );
}
