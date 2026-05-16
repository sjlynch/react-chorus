import React from 'react';
import { Chorus } from '../../Chorus';
import type { RenderMessageContext } from '../../components/ChatWindow';
import type { Message } from '../../types';
import { THEME_PRESETS } from './palettes';
import { citationsForPrompt, themingTransport, type Citation } from './themingTransport';

interface CitationMeta {
  citations?: Citation[];
}

const WELCOME_MESSAGE: Message<CitationMeta> = {
  id: 'welcome-theming',
  role: 'assistant',
  text: "**Theming + custom rendering.** Pick a palette preset on the right to live-swap the `palette` prop. Every assistant reply also flows through a `renderMessage` callback that appends a **Citations** footer using `defaultRender({ footerSlot })` — no need to re-implement the bubble.\n\nFlip **Headless mode** to drop all built-in CSS and see the raw structure.",
};

function findLastUserText<M>(messages: Message<M>[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].text;
  }
  return '';
}

function CitationsFooter({ items }: { items: Citation[] }) {
  return (
    <div className="pg-citations">
      <span className="pg-citations-label">Sources</span>
      <ol className="pg-citations-list">
        {items.map((c, i) => (
          <li key={`${c.url}-${i}`}>
            <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ThemingTab() {
  const [messages, setMessages] = React.useState<Message<CitationMeta>[]>([WELCOME_MESSAGE]);
  const [presetId, setPresetId] = React.useState<string>(THEME_PRESETS[0].id);
  const [headless, setHeadless] = React.useState(false);

  const activePreset = THEME_PRESETS.find(p => p.id === presetId) ?? THEME_PRESETS[0];

  const renderMessage = React.useCallback((message: Message<CitationMeta>, context: RenderMessageContext<CitationMeta>) => {
    const citations = message.role === 'assistant' ? message.metadata?.citations : undefined;
    if (citations?.length) {
      return context.defaultRender({ footerSlot: <CitationsFooter items={citations} /> });
    }
    return context.defaultRender();
  }, []);

  const handleFinish = React.useCallback((ctx: { message: Message<CitationMeta>; messages: Message<CitationMeta>[] }) => {
    if (ctx.message.role !== 'assistant') return;
    const prompt = findLastUserText(ctx.messages);
    if (!prompt) return;
    const citations = citationsForPrompt(prompt);
    setMessages(prev => prev.map(m => (
      m.id === ctx.message.id ? { ...m, metadata: { ...(m.metadata ?? {}), citations } } : m
    )));
  }, []);

  return (
    <div className="pg-tab-stack">
      <div className="pg-tab-toolbar">
        <span className="pg-tab-toolbar-label">Palette</span>
        <div className="pg-preset-chips" role="radiogroup" aria-label="Palette preset">
          {THEME_PRESETS.map(p => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === presetId}
              onClick={() => setPresetId(p.id)}
              className={`pg-preset-chip${p.id === presetId ? ' pg-preset-chip--active' : ''}`}
              title={p.label}
            >
              <span className="pg-preset-swatch" style={{ background: p.swatch }} aria-hidden="true" />
              {p.label}
            </button>
          ))}
        </div>
        <label className="pg-toggle">
          <input
            type="checkbox"
            checked={headless}
            onChange={(e) => setHeadless(e.target.checked)}
          />
          Headless mode
        </label>
      </div>

      <Chorus<CitationMeta>
        value={messages}
        onChange={setMessages}
        transport={themingTransport}
        suggestedPrompts={['How does palette theming work?', 'How do I customize rendering?', 'Show me the ChorusTheme wrapper']}
        placeholder="Ask about theming or rendering…"
        showClearButton
        headless={headless}
        palette={activePreset.palette}
        renderMessage={renderMessage}
        onFinish={handleFinish}
      />
    </div>
  );
}
