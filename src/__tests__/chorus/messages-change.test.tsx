import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { sendMessage, erroringSSEResponse } from './testUtils';
import type { Message, OnSend, Transport } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus message change observations', () => {
  it('observes uncontrolled initial messages, streams, and clear without requiring controlled state', async () => {
    const user = userEvent.setup();
    const onMessagesChange = vi.fn();
    const onSend = vi.fn<OnSend>(async (_text, _messages, helpers) => {
      helpers.appendAssistant('streamed ');
      helpers.appendAssistant('reply');
      helpers.finalizeAssistant();
    });

    render(
      <Chorus
        initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Welcome!' }]}
        onMessagesChange={onMessagesChange}
        onSend={onSend}
        minAssistantDelayMs={0}
        showClearButton
      />,
    );

    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'welcome', text: 'Welcome!' })],
      expect.objectContaining({ source: 'uncontrolled', reason: 'initial' }),
    ));

    await sendMessage(user, 'observe me');

    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ role: 'assistant', text: 'streamed reply' })]),
      expect.objectContaining({ source: 'uncontrolled', reason: 'assistant' }),
    ));

    await user.click(screen.getAllByTitle('Delete')[0]);
    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledWith(
      expect.not.arrayContaining([expect.objectContaining({ id: 'welcome' })]),
      expect.objectContaining({ source: 'uncontrolled', reason: 'delete' }),
    ));

    await user.click(screen.getByRole('button', { name: /clear conversation/i }));
    await waitFor(() => expect(onMessagesChange).toHaveBeenLastCalledWith([], expect.objectContaining({ reason: 'clear' })));
  });

  it('observes controlled value updates without broadening onChange beyond controlled mode', async () => {
    const user = userEvent.setup();
    const onMessagesChange = vi.fn();
    const onChange = vi.fn<(messages: Message[]) => void>();

    function Harness() {
      const [messages, setMessages] = React.useState<Message[]>([{ id: 'seed', role: 'assistant', text: 'controlled seed' }]);
      return (
        <Chorus
          value={messages}
          onChange={(next) => {
            onChange(next);
            setMessages(next);
          }}
          onMessagesChange={onMessagesChange}
          onSend={() => ({ id: 'controlled-assistant', role: 'assistant', text: 'controlled reply' })}
          minAssistantDelayMs={0}
        />
      );
    }

    render(<Harness />);

    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'seed' })],
      expect.objectContaining({ source: 'controlled' }),
    ));

    await sendMessage(user, 'controlled send');

    await waitFor(() => expect(screen.getByText('controlled reply')).toBeInTheDocument());
    expect(onChange).toHaveBeenCalled();
    expect(onMessagesChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'controlled-assistant', text: 'controlled reply' })]),
      expect.objectContaining({ source: 'controlled', reason: 'assistant' }),
    );
  });

  it('reports each controlled change once when the host derives a new array in onChange', async () => {
    const user = userEvent.setup();
    const onMessagesChange = vi.fn();

    function CloningHarness() {
      const [messages, setMessages] = React.useState<Message[]>([{ id: 'seed', role: 'assistant', text: 'controlled seed' }]);
      return (
        <>
          <button
            type="button"
            onClick={() => setMessages((prev) => [...prev, { id: 'host-added', role: 'user', text: 'host added' }])}
          >
            host append
          </button>
          <Chorus
            value={messages}
            // The host normalizes by cloning the emitted array back into a NEW
            // array — the exact pattern that used to double-report changes.
            onChange={(next) => setMessages([...next])}
            onMessagesChange={onMessagesChange}
            onSend={() => ({ id: 'controlled-assistant', role: 'assistant', text: 'controlled reply' })}
            minAssistantDelayMs={0}
          />
        </>
      );
    }

    render(<CloningHarness />);

    await waitFor(() => expect(onMessagesChange).toHaveBeenCalled());

    await sendMessage(user, 'controlled send');
    await waitFor(() => expect(screen.getByText('controlled reply')).toBeInTheDocument());

    const reasonsAfterSend = onMessagesChange.mock.calls.map(([, context]) => context.reason);
    // The clone in onChange must not turn one logical change into two calls —
    // once correctly labeled, once mislabeled 'external'.
    expect(reasonsAfterSend.filter((reason) => reason === 'send')).toHaveLength(1);
    expect(reasonsAfterSend.filter((reason) => reason === 'assistant').length).toBeGreaterThanOrEqual(1);
    // Only the initial mount observation is 'external' — no round-trip echoes.
    expect(reasonsAfterSend.filter((reason) => reason === 'external')).toHaveLength(1);

    // A genuine host-driven change still surfaces as an 'external' observation.
    await user.click(screen.getByRole('button', { name: 'host append' }));
    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'host-added' })]),
      expect.objectContaining({ source: 'controlled', reason: 'external' }),
    ));
    const externalReasons = onMessagesChange.mock.calls
      .map(([, context]) => context.reason)
      .filter((reason) => reason === 'external');
    expect(externalReasons).toHaveLength(2);
  });

  it('reports a transport-error partial removal with the error-cleanup reason, not delete', async () => {
    const user = userEvent.setup();
    const onMessagesChange = vi.fn();
    // The stream emits a partial token, then errors before completing.
    const transport = vi.fn<Transport>(async () => erroringSSEResponse(['partial answer']));

    render(
      <Chorus
        transport={transport}
        connector="openai"
        minAssistantDelayMs={0}
        onMessagesChange={onMessagesChange}
      />,
    );

    await sendMessage(user, 'trigger failure');
    await waitFor(() => expect(screen.queryByText('partial answer')).not.toBeInTheDocument());

    // Discarding the half-streamed partial is internal stream-failure cleanup,
    // distinguishable from a host-initiated `'delete'`.
    const reasons = onMessagesChange.mock.calls.map(([, context]) => context.reason);
    expect(reasons).toContain('error-cleanup');
    expect(reasons).not.toContain('delete');
  });
});
