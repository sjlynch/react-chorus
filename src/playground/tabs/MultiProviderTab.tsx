import React from 'react';
import { Chorus } from '../../Chorus';
import type { BudgetExceededContext } from '../../Chorus';
import { DEMO_PALETTE } from './palettes';
import { mockAnthropicTransport, mockGeminiTransport, mockOpenAITransport } from './multiProviderTransport';

const BUDGET_ALERT = 0.0005;
const SUGGESTED_PROMPTS = [
  'How would you describe your tone?',
  'What does react-chorus do best?',
  'Write a one-line haiku about streaming',
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
      <aside className="pg-tab-intro">
        Pick a provider from the dropdown next to <strong>Send</strong>, or type <code>/model:anthropic</code> and press Enter to switch from the keyboard. The conversation stays one transcript across switches. The header above the chat is the <strong>live cost meter</strong> (<code>showCost</code>); each turn's mock transport emits a trailing <code>usage</code> frame so pricing is real per model. The budget banner trips when the conversation total crosses <code>$0.0005</code>.
      </aside>

      <Chorus
        providers={PROVIDERS}
        defaultProvider="openai"
        persistenceKey="react-chorus-pg:multi-provider"
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
