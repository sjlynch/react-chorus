import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Chorus } from '../Chorus';
import type { Message } from '../types';

const ASSISTANT_WITH_USAGE: Message = {
  id: 'a1',
  role: 'assistant',
  text: 'hello',
  metadata: {
    modelId: 'gpt-4o',
    usage: { promptTokens: 1000, completionTokens: 2000 },
  },
};

afterEach(() => {
  cleanup();
});

describe('<Chorus showCost> budget suffix guard', () => {
  it.each<[label: string, value: number]>([
    ['Infinity', Number.POSITIVE_INFINITY],
    ['0', 0],
    ['NaN', Number.NaN],
    ['negative', -5],
  ])('does not render the "/ $… budget" suffix when budgetAlert=%s', (_label, value) => {
    const onBudgetExceeded = vi.fn();
    const { container } = render(
      <Chorus
        showCost
        budgetAlert={value}
        onBudgetExceeded={onBudgetExceeded}
        initialMessages={[ASSISTANT_WITH_USAGE]}
      />,
    );

    expect(container.querySelector('.chorus-cost-header')).toBeInTheDocument();
    expect(container.querySelector('.chorus-cost-header-budget')).toBeNull();
    expect(onBudgetExceeded).not.toHaveBeenCalled();
  });

  it('still renders the suffix for a positive finite budget', () => {
    const { container } = render(
      <Chorus
        showCost
        budgetAlert={5}
        initialMessages={[ASSISTANT_WITH_USAGE]}
      />,
    );

    const budget = container.querySelector('.chorus-cost-header-budget');
    expect(budget).toBeInTheDocument();
    expect(budget?.textContent).toContain('$5.00');
  });
});
