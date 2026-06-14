import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Message } from '../../types';
import { MessageBubble } from '../../components/MessageRow';
import { BlockProvider } from '../../blocks/BlockContext';
import type { BlockDefinition, BlockRegistry, BlockRenderProps } from '../../blocks/types';

function WeatherCard({ props }: BlockRenderProps<{ city?: string; temp?: number }> & { city?: string; temp?: number }) {
  const p = props as { city?: string; temp?: number };
  return <div data-testid="weather-card">{p.city ?? '—'}: {p.temp ?? '—'}</div>;
}

const WeatherBlock: BlockDefinition<{ city: string; temp: number }> = {
  component: WeatherCard,
  validate: (input) => {
    const obj = input as { city?: unknown; temp?: unknown };
    const errors: string[] = [];
    if (typeof obj?.city !== 'string') errors.push('city: expected string');
    if (typeof obj?.temp !== 'number') errors.push('temp: expected number');
    return errors.length === 0
      ? { ok: true, props: { city: String(obj.city), temp: Number(obj.temp) } }
      : { ok: false, errors };
  },
};

function ThrowingComponent(): React.ReactElement {
  throw new Error('component blew up');
}

// Throws while props are partial (no `ready` flag yet), renders once they
// complete — the streaming → done crash-then-recover shape from the bug report.
function FlakyBlock({ props }: BlockRenderProps<{ ready?: boolean; label?: string }> & { ready?: boolean; label?: string }): React.ReactElement {
  const p = props as { ready?: boolean; label?: string };
  if (!p.ready) throw new Error('props not ready');
  return <div data-testid="flaky-block">{p.label ?? '—'}</div>;
}

function renderWithBlocks(blocks: BlockRegistry, message: Message) {
  return render(
    <BlockProvider blocks={blocks} emit={() => {}}>
      <MessageBubble message={message} />
    </BlockProvider>,
  );
}

describe('BlockRenderer', () => {
  it('renders a registered block with streamed props', () => {
    const message: Message = {
      id: 't1',
      role: 'tool',
      text: '',
      toolCall: { id: 't1', name: '__render_block', input: { name: 'WeatherCard', props: { city: 'SF', temp: 68 } } },
      block: { name: 'WeatherCard', props: { city: 'SF', temp: 68 }, status: 'streaming' },
    };
    renderWithBlocks({ WeatherCard: WeatherBlock as BlockDefinition<unknown> }, message);
    expect(screen.getByTestId('weather-card')).toHaveTextContent('SF: 68');
    // No ToolCallBlock chrome should be visible (no "Input"/"Output" label).
    expect(screen.queryByText('Input')).toBeNull();
  });

  it('re-renders with partial props during streaming', () => {
    const partial: Message = {
      id: 't1',
      role: 'tool',
      text: '',
      toolCall: { id: 't1', name: '__render_block', input: '' },
      block: { name: 'WeatherCard', props: { city: 'San' }, status: 'streaming' },
    };
    const { rerender } = renderWithBlocks({ WeatherCard: WeatherBlock as BlockDefinition<unknown> }, partial);
    expect(screen.getByTestId('weather-card')).toHaveTextContent('San: —');
    const more: Message = { ...partial, block: { ...partial.block!, props: { city: 'San Francisco', temp: 68 } } };
    rerender(
      <BlockProvider blocks={{ WeatherCard: WeatherBlock as BlockDefinition<unknown> }} emit={() => {}}>
        <MessageBubble message={more} />
      </BlockProvider>,
    );
    expect(screen.getByTestId('weather-card')).toHaveTextContent('San Francisco: 68');
  });

  it('renders the validation fallback when validator rejects done props', () => {
    const message: Message = {
      id: 't1',
      role: 'tool',
      text: '',
      toolCall: { id: 't1', name: '__render_block' },
      block: { name: 'WeatherCard', props: { city: 'SF' /* missing temp */ }, status: 'done' },
    };
    renderWithBlocks({ WeatherCard: WeatherBlock as BlockDefinition<unknown> }, message);
    expect(screen.queryByTestId('weather-card')).toBeNull();
    expect(screen.getByText('invalid props')).toBeInTheDocument();
    expect(screen.getByText(/temp: expected number/)).toBeInTheDocument();
  });

  it('renders the unknown-block fallback when the registry has no entry', () => {
    const message: Message = {
      id: 't1',
      role: 'tool',
      text: '',
      toolCall: { id: 't1', name: '__render_block' },
      block: { name: 'MissingBlock', props: { x: 1 }, status: 'done' },
    };
    renderWithBlocks({}, message);
    expect(screen.getByText('unknown block')).toBeInTheDocument();
    expect(screen.getByText('MissingBlock')).toBeInTheDocument();
  });

  it('catches a thrown block component with the error boundary', () => {
    const ThrowBlock: BlockDefinition<unknown> = { component: ThrowingComponent };
    const message: Message = {
      id: 't1',
      role: 'tool',
      text: '',
      toolCall: { id: 't1', name: '__render_block' },
      block: { name: 'BoomBlock', props: {}, status: 'done' },
    };
    // Silence the expected React error boundary console noise for the assertion.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderWithBlocks({ BoomBlock: ThrowBlock }, message);
      expect(screen.getByText('block error')).toBeInTheDocument();
      expect(screen.getByText(/component blew up/)).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it('recovers when a block crashes on partial props then succeeds after props update', () => {
    const blocks = { FlakyBlock: { component: FlakyBlock } as BlockDefinition<unknown> };
    const streaming: Message = {
      id: 't1',
      role: 'tool',
      text: '',
      toolCall: { id: 't1', name: '__render_block' },
      block: { name: 'FlakyBlock', props: { ready: false }, status: 'streaming' },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { rerender } = renderWithBlocks(blocks, streaming);
      // Crashed on partial props → error fallback.
      expect(screen.getByText('block error')).toBeInTheDocument();
      expect(screen.queryByTestId('flaky-block')).toBeNull();

      // Final valid props arrive: the boundary must reset and render success.
      const done: Message = {
        ...streaming,
        block: { name: 'FlakyBlock', props: { ready: true, label: 'all set' }, status: 'done' },
      };
      rerender(
        <BlockProvider blocks={blocks} emit={() => {}}>
          <MessageBubble message={done} />
        </BlockProvider>,
      );
      expect(screen.queryByText('block error')).toBeNull();
      expect(screen.getByTestId('flaky-block')).toHaveTextContent('all set');
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps showing the fallback when the same props keep throwing (no reset on stable input)', () => {
    const blocks = { FlakyBlock: { component: FlakyBlock } as BlockDefinition<unknown> };
    const props = { ready: false };
    const message: Message = {
      id: 't1',
      role: 'tool',
      text: '',
      toolCall: { id: 't1', name: '__render_block' },
      // Referentially stable props object reused across renders.
      block: { name: 'FlakyBlock', props, status: 'streaming' },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { rerender } = renderWithBlocks(blocks, message);
      expect(screen.getByText('block error')).toBeInTheDocument();
      // Re-render an unrelated parent change with the same block input: the
      // boundary must NOT reset (and re-crash) — it stays on the fallback.
      rerender(
        <BlockProvider blocks={blocks} emit={() => {}}>
          <MessageBubble message={{ ...message, block: { ...message.block!, props } }} />
        </BlockProvider>,
      );
      expect(screen.getByText('block error')).toBeInTheDocument();
      expect(screen.queryByTestId('flaky-block')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

// vi is the global test runner from vitest; import it explicitly for clarity.
import { vi } from 'vitest';
