import React from 'react';
import { Chorus } from '../../Chorus';
import type { BudgetExceededContext } from '../../Chorus';
import type { Message } from '../../types';
import { DEMO_PALETTE } from './palettes';
import { mockAnthropicTransport, mockGeminiTransport, mockOpenAITransport } from './multiProviderTransport';

const WELCOME_MESSAGE: Message = {
  id: 'welcome-multi-provider',
  role: 'assistant',
  text: "This tab routes every turn through the `<Chorus providers>` registry — pick OpenAI, Anthropic, or Gemini from the model picker next to Send (or type `/model:anthropic` to switch from the keyboard). The conversation stays a single transcript across switches.\n\nThe header above the chat is the **live cost meter** (`showCost`). Each turn's mock transport emits a trailing `usage` frame; Chorus reads pricing from the built-in `PRICING` snapshot and totals it per model. The budget banner trips once the conversation crosses `$0.0005`.",
};

const BUDGET_ALERT = 0.0005;
const SUGGESTED_PROMPTS = [
  '/model:openai How would you describe your tone?',
  '/model:anthropic How would you describe your tone?',
  '/model:gemini How would you describe your tone?',
];

const PROVIDERS = {
  openai: { transport: mockOpenAITransport, connector: 'openai', label: 'OpenAI', modelId: 'gpt-4o-mini' },
  anthropic: { transport: mockAnthropicTransport, connector: 'anthropic', label: 'Claude', modelId: 'claude-3-5-sonnet' },
  gemini: { transport: mockGeminiTransport, connector: 'gemini', label: 'Gemini', modelId: 'gemini-2.5-flash' },
} as const;

export function MultiProviderTab() {
  const [budgetEvent, setBudgetEvent] = React.useState<BudgetExceededContext | null>(null);

  const handleBudget = React.useCallback((context: BudgetExceededContext) => {
    setBudgetEvent(context);
  }, []);

  const handleClear = React.useCallback(() => {
    setBudgetEvent(null);
  }, []);

  return (
    <div className="pg-tab-stack">
      <Chorus
        providers={PROVIDERS}
        defaultProvider="openai"
        persistenceKey="react-chorus-pg:multi-provider"
        initialMessages={[WELCOME_MESSAGE]}
        suggestedPrompts={SUGGESTED_PROMPTS}
        placeholder="Pick a provider, then send — or type /model:anthropic to switch."
        showClearButton
        palette={DEMO_PALETTE}
        showCost
        budgetAlert={BUDGET_ALERT}
        onBudgetExceeded={handleBudget}
        onClear={handleClear}
      />

      <aside className="pg-tab-toolbar" aria-live="polite">
        <span className="pg-tab-toolbar-label">Budget alert</span>
        {budgetEvent ? (
          <span className="pg-notice">
            ⚠ Crossed ${budgetEvent.threshold.toFixed(4)} — now ${budgetEvent.total.toFixed(4)} across{' '}
            {Object.keys(budgetEvent.perModel).join(', ') || 'no models yet'}.
          </span>
        ) : (
          <span>Threshold ${BUDGET_ALERT.toFixed(4)}. Send a few turns to trip it.</span>
        )}
      </aside>
    </div>
  );
}
