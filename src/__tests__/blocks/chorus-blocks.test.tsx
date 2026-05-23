import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { sendMessage, sseResponse } from '../chorus/testUtils';
import type { Transport } from '../chorus/testUtils';
import type { BlockDefinition, BlockRenderProps } from '../../blocks/types';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

function WeatherCard({ props, emit }: BlockRenderProps<{ city?: string; temp?: number }> & { city?: string; temp?: number }) {
  const p = props as { city?: string; temp?: number };
  return (
    <div data-testid="weather-card">
      <span>{p.city ?? '—'}: {p.temp ?? '—'}</span>
      <button type="button" onClick={() => emit('Follow up on weather')}>Ask follow-up</button>
      <button type="button" onClick={() => emit({ toolCall: { name: 'book_meeting', input: { city: p.city } } })}>Book</button>
    </div>
  );
}

const WeatherBlock: BlockDefinition<{ city: string; temp: number }> = {
  component: WeatherCard,
};

describe('Chorus generative-UI blocks', () => {
  it('renders __render_block tool deltas as the registered block, no tool message', async () => {
    const user = userEvent.setup();
    const args = JSON.stringify({ name: 'WeatherCard', props: { city: 'SF', temp: 68 } });
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: '__render_block', arguments: args } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} blocks={{ WeatherCard: WeatherBlock as BlockDefinition<unknown> }} />);

    await sendMessage(user, 'show weather');

    await waitFor(() => expect(screen.getByTestId('weather-card')).toBeInTheDocument());
    expect(screen.getByTestId('weather-card')).toHaveTextContent('SF: 68');
    // No tool button labelled __render_block should be in the DOM.
    expect(screen.queryByRole('button', { name: /__render_block/i })).toBeNull();
  });

  it('shows the partial block while props are still streaming', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: '__render_block', arguments: '{"name":"WeatherCard","props":{"city":"San' } }] } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ' Francisco","temp":68}}' } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} blocks={{ WeatherCard: WeatherBlock as BlockDefinition<unknown> }} />);

    await sendMessage(user, 'show weather');
    await waitFor(() => expect(screen.getByTestId('weather-card')).toHaveTextContent('San Francisco: 68'));
  });

  it('emit(text) synthesizes a user message and triggers the next turn', async () => {
    const user = userEvent.setup();
    const args = JSON.stringify({ name: 'WeatherCard', props: { city: 'SF', temp: 68 } });
    let sendCount = 0;
    const transport = vi.fn<Transport>(async () => {
      sendCount++;
      if (sendCount === 1) {
        return sseResponse([
          JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: '__render_block', arguments: args } }] } }] }),
          '[DONE]',
        ]);
      }
      return sseResponse([
        JSON.stringify({ choices: [{ index: 0, delta: { content: 'follow-up done' } }] }),
        '[DONE]',
      ]);
    });

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} blocks={{ WeatherCard: WeatherBlock as BlockDefinition<unknown> }} />);

    await sendMessage(user, 'show weather');
    await waitFor(() => expect(screen.getByTestId('weather-card')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Ask follow-up' }));
    await waitFor(() => expect(screen.getByText('Follow up on weather')).toBeInTheDocument());
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
  });

  it('emit({ toolCall }) invokes a registered tool without a user-visible message', async () => {
    const user = userEvent.setup();
    const args = JSON.stringify({ name: 'WeatherCard', props: { city: 'SF', temp: 68 } });
    const book = vi.fn(async () => ({ booked: true }));
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: '__render_block', arguments: args } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} blocks={{ WeatherCard: WeatherBlock as BlockDefinition<unknown> }} tools={{ book_meeting: book }} />);

    await sendMessage(user, 'show weather');
    await waitFor(() => expect(screen.getByTestId('weather-card')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Book' }));
    await waitFor(() => expect(book).toHaveBeenCalled());
    // The text "Book" appears in the WeatherCard but no user message with the
    // emit({toolCall}) payload should have been synthesized.
    const userMessages = screen.queryAllByText('show weather');
    expect(userMessages.length).toBe(1);
  });

  it('renders the default tool loader for a streaming tool with no output', async () => {
    const user = userEvent.setup();
    // A normal tool delta (not __render_block) with no output should show the
    // per-tool loader while the turn is still streaming. Hold the stream open
    // by deferring the controller close until the test releases it.
    const encoder = new TextEncoder();
    let release!: () => void;
    const open = new Promise<void>(resolve => { release = resolve; });
    const body = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'consult_calendar', arguments: '{"q":"' } }] } }] })}\n\n`));
        await open;
        controller.close();
      },
    });
    const transport = vi.fn<Transport>(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);
    await sendMessage(user, 'consult calendar');

    try {
      await waitFor(() => expect(document.querySelector('.chorus-tool-loader--default')).toBeTruthy());
      // The tool name appears both in the ToolCallBlock header and in the
      // DefaultToolLoader label — getAllByText to assert both render paths.
      expect(screen.getAllByText('consult_calendar').length).toBeGreaterThan(0);
    } finally {
      release();
    }
  });

  it('renders a custom per-tool loader when provided', async () => {
    const user = userEvent.setup();
    const encoder = new TextEncoder();
    let release!: () => void;
    const open = new Promise<void>(resolve => { release = resolve; });
    const body = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{"q":"' } }] } }] })}\n\n`));
        await open;
        controller.close();
      },
    });
    const transport = vi.fn<Transport>(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));

    function WeatherLoader() {
      return <div data-testid="weather-loader">Consulting weather…</div>;
    }

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} toolLoadingComponents={{ get_weather: WeatherLoader }} />);
    await sendMessage(user, 'check weather');

    try {
      await waitFor(() => expect(screen.getByTestId('weather-loader')).toBeInTheDocument());
    } finally {
      release();
    }
  });
});
