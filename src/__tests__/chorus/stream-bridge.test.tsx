import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { useChorusStream } from '../../hooks/useChorusStream';
import { sendMessage, sseResponse } from './testUtils';
import type { Transport } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus useChorusStream bridge', () => {
  it('renders reasoning and tool deltas from the useChorusStream onSend bridge', async () => {
    const user = userEvent.setup();
    const bridgeTransport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: 'bridge plan' } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'bridge answer' } }] }),
      '[DONE]',
    ]));

    function Bridge() {
      const { send } = useChorusStream(bridgeTransport, { connector: 'openai' });
      return (
        <Chorus
          minAssistantDelayMs={0}
          onSend={(text, messages, helpers) => send(text, messages, helpers.streamCallbacks?.() ?? {
            onChunk: helpers.appendAssistant,
            onReasoning: helpers.appendReasoning,
            onToolDelta: helpers.appendToolDelta,
            onDone: helpers.finalizeAssistant,
          }, helpers.signal)}
        />
      );
    }

    render(<Bridge />);

    await sendMessage(user, 'bridge reasoning');

    expect(await screen.findByText('bridge answer')).toBeInTheDocument();
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('bridge plan')).toBeInTheDocument();
  });

  it('renders a tool-only stream from the useChorusStream onSend bridge', async () => {
    const user = userEvent.setup();
    const bridgeTransport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"bridge"}' } }] } }] }),
      '[DONE]',
    ]));

    function Bridge() {
      const { send } = useChorusStream(bridgeTransport, { connector: 'openai' });
      return <Chorus minAssistantDelayMs={0} onSend={(text, messages, helpers) => send(text, messages, helpers.streamCallbacks?.() ?? { onChunk: helpers.appendAssistant, onDone: helpers.finalizeAssistant }, helpers.signal)} />;
    }

    render(<Bridge />);

    await sendMessage(user, 'bridge tool');

    expect(await screen.findByRole('button', { name: /search/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(screen.queryByText(/assistant is typing/i)).not.toBeInTheDocument();
  });

  it('renders a bridged tool call followed by final assistant text', async () => {
    const user = userEvent.setup();
    const bridgeTransport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":"bridge"}' } }] } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'bridge final' } }] }),
      '[DONE]',
    ]));

    function Bridge() {
      const { send } = useChorusStream(bridgeTransport, { connector: 'openai' });
      return <Chorus minAssistantDelayMs={0} onSend={(text, messages, helpers) => send(text, messages, helpers.streamCallbacks?.() ?? { onChunk: helpers.appendAssistant, onDone: helpers.finalizeAssistant }, helpers.signal)} />;
    }

    render(<Bridge />);

    await sendMessage(user, 'bridge both');

    expect(await screen.findByRole('button', { name: /search/i })).toBeInTheDocument();
    expect(await screen.findByText('bridge final')).toBeInTheDocument();
  });
});
