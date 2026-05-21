import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { sendMessage, sseResponse } from './testUtils';
import type { ChorusRef, OnSend, Transport } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus transport streaming', () => {
  it('transport path send() fires transport and streams tokens into the message list', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse(['Hel', 'lo']));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await sendMessage(user, 'hi');

    await waitFor(() => expect(transport).toHaveBeenCalledOnce());
    expect(transport.mock.calls[0][0]).toBe('hi');
    expect(screen.getByText('hi')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Hello')).toBeInTheDocument());
  });

  it('renders streamed reasoning in a collapsed details block on the assistant message', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: 'plan first' } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'final answer' } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await sendMessage(user, 'why');

    expect(await screen.findByText('final answer')).toBeInTheDocument();
    const summary = screen.getByText('Reasoning');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('plan first')).toBeInTheDocument();
  });

  it('threads connectorOptions through the transport path so a custom reasoning tag is split out', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { content: '<reasoning>plan first</reasoning>final answer' } }] }),
      '[DONE]',
    ]));

    render(
      <Chorus
        transport={transport}
        connector="openai"
        connectorOptions={{ thinkTag: { start: '<reasoning>', end: '</reasoning>' } }}
        minAssistantDelayMs={0}
      />,
    );

    await sendMessage(user, 'why');

    expect(await screen.findByText('final answer')).toBeInTheDocument();
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('plan first')).toBeInTheDocument();
  });

  it('routes a non-fatal connector warning to onStreamWarning while the stream still completes', async () => {
    const user = userEvent.setup();
    const onStreamWarning = vi.fn();
    const onFinish = vi.fn();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'cut off here' }] } }] }),
    ]));

    render(
      <Chorus
        transport={transport}
        connector="gemini"
        minAssistantDelayMs={0}
        onStreamWarning={onStreamWarning}
        onFinish={onFinish}
      />,
    );

    await sendMessage(user, 'long answer');

    expect(await screen.findByText('cut off here')).toBeInTheDocument();
    await waitFor(() => expect(onStreamWarning).toHaveBeenCalledTimes(1));
    expect(onStreamWarning).toHaveBeenCalledWith(expect.objectContaining({ code: 'truncated' }));
    expect(onFinish).toHaveBeenCalled();
  });

  it('routes connector metadata to onStreamMetadata while the stream still completes', async () => {
    const user = userEvent.setup();
    const onStreamMetadata = vi.fn();
    const onFinish = vi.fn();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'all done' }, finish_reason: 'stop' }] }),
    ]));

    render(
      <Chorus
        transport={transport}
        connector="openai"
        minAssistantDelayMs={0}
        onStreamMetadata={onStreamMetadata}
        onFinish={onFinish}
      />,
    );

    await sendMessage(user, 'wrap up');

    expect(await screen.findByText('all done')).toBeInTheDocument();
    await waitFor(() => expect(onStreamMetadata).toHaveBeenCalledTimes(1));
    expect(onStreamMetadata).toHaveBeenCalledWith({ finishReason: 'stop' });
    expect(onFinish).toHaveBeenCalled();
  });

  it('reports completed when a transport stream ends with no auto-continue tool calls', async () => {
    const user = userEvent.setup();
    const onStreamDone = vi.fn();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { content: 'hi there' } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} onStreamDone={onStreamDone} />);

    await sendMessage(user, 'hello');

    await screen.findByText('hi there');
    expect(onStreamDone).toHaveBeenCalledTimes(1);
    expect(onStreamDone).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'completed',
      willContinue: false,
      iteration: 1,
      maxToolIterations: 4,
    }));
  });

  it('accepts a custom connector object on the transport path', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse(['ignored']));

    render(<Chorus transport={transport} connector={{ name: 'custom', extract: () => ({ text: 'X' }) }} minAssistantDelayMs={0} />);

    await sendMessage(user, 'hi');

    expect(await screen.findByText('X')).toBeInTheDocument();
  });

  it('delays the first transport token until minAssistantDelayMs elapses', async () => {
    vi.useFakeTimers();
    try {
      const transport = vi.fn<Transport>(async () => sseResponse(['Delayed']));

      render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={500} />);

      fireEvent.change(screen.getByPlaceholderText('Send a message'), { target: { value: 'hi' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(transport).toHaveBeenCalledOnce();
      expect(screen.getByText('hi')).toBeInTheDocument();
      expect(screen.queryByText('Delayed')).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(499);
      });
      expect(screen.queryByText('Delayed')).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByText('Delayed')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('prepends systemPrompt to transport history without rendering it', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([]));

    render(<Chorus transport={transport} systemPrompt="Stay concise." minAssistantDelayMs={0} />);

    await sendMessage(user, 'hi');

    await waitFor(() => expect(transport).toHaveBeenCalledOnce());
    expect(transport.mock.calls[0][1]).toEqual([
      { id: 'chorus-system-prompt', role: 'system', text: 'Stay concise.' },
      expect.objectContaining({ role: 'user', text: 'hi' }),
    ]);
    expect(screen.queryByText('Stay concise.')).not.toBeInTheDocument();
  });

  it('dispatches send() to the transport from the same commit that swapped the transport prop', async () => {
    const transportA = vi.fn<Transport>(async () => sseResponse(['from A']));
    const transportB = vi.fn<Transport>(async () => sseResponse(['from B']));
    const ref = React.createRef<ChorusRef>();

    // The layout effect runs right after Chorus re-renders with transportB but
    // before any passive effect — exercising a "latest ref read inside the same
    // commit" path. A useLatestRef that updated in a passive effect would still
    // hold transportA at this point and post to the previous endpoint.
    function Host({ transport, sendNow }: { transport: Transport; sendNow: boolean }) {
      React.useLayoutEffect(() => {
        if (sendNow) ref.current?.send('same-commit send');
      }, [sendNow]);
      return <Chorus ref={ref} transport={transport} connector="openai" minAssistantDelayMs={0} />;
    }

    const { rerender } = render(<Host transport={transportA} sendNow={false} />);
    expect(transportA).not.toHaveBeenCalled();

    rerender(<Host transport={transportB} sendNow />);

    await waitFor(() => expect(transportB).toHaveBeenCalledOnce());
    expect(transportA).not.toHaveBeenCalled();
    expect(transportB.mock.calls[0][0]).toBe('same-commit send');
  });

  it('uses transport instead of onSend when both are provided', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const transport = vi.fn<Transport>(async () => sseResponse([]));
    const onSend = vi.fn<OnSend>(async () => undefined);

    render(<Chorus transport={transport} onSend={onSend} systemPrompt="Stay concise." minAssistantDelayMs={0} />);

    await sendMessage(user, 'hi');

    await waitFor(() => expect(transport).toHaveBeenCalledOnce());
    expect(onSend).not.toHaveBeenCalled();
    expect(transport.mock.calls[0][1][0]).toEqual({ id: 'chorus-system-prompt', role: 'system', text: 'Stay concise.' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`transport` takes precedence'));
    warn.mockRestore();
  });
});
