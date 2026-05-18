import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { useChorusStream } from '../../hooks/useChorusStream';
import { sseResponse } from './testUtils';
import type { Message, OnSend, OnSendHelpers, Transport } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus', () => {
  it('shows an error banner when the transport path fails', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([], 500));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'boom');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('transport path passes the raw error to onError while keeping the UI banner generic', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([], 500));
    const onError = vi.fn();

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} onError={onError} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'boom');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toMatch(/HTTP 500/i);
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/HTTP 500/i)).not.toBeInTheDocument();
  });

  it('transport path surfaces in-band error payloads through onError and the UI banner', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ delta: { content: 'partial' } }] }),
      JSON.stringify({ error: 'stream failed' }),
    ]));
    const onError = vi.fn();

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} onError={onError} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'boom');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('stream failed');
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('passes Gemini safety finish reasons to onError while keeping the UI banner generic', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }),
    ]));
    const onError = vi.fn();

    render(<Chorus transport={transport} connector="gemini" minAssistantDelayMs={0} onError={onError} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'blocked');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0].message).toContain('finishReason: SAFETY');
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/finishReason: SAFETY/)).not.toBeInTheDocument();
  });

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

    await user.type(screen.getByPlaceholderText('Send a message'), 'bridge reasoning');
    await user.click(screen.getByRole('button', { name: /send/i }));

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

    await user.type(screen.getByPlaceholderText('Send a message'), 'bridge tool');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('button', { name: /search/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(screen.queryByRole('status', { name: /assistant is typing/i })).not.toBeInTheDocument();
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

    await user.type(screen.getByPlaceholderText('Send a message'), 'bridge both');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('button', { name: /search/i })).toBeInTheDocument();
    expect(await screen.findByText('bridge final')).toBeInTheDocument();
  });

  it('surfaces errors from the documented useChorusStream onSend bridge', async () => {
    const user = userEvent.setup();
    const bridgeTransport = vi.fn<Transport>(async () => new Response('bad gateway', { status: 502, statusText: 'Bad Gateway' }));
    const onError = vi.fn();

    function Bridge() {
      const { send } = useChorusStream(bridgeTransport);
      return (
        <Chorus
          minAssistantDelayMs={0}
          onError={onError}
          onSend={(text, messages, helpers) => send(text, messages, {
            onChunk: helpers.appendAssistant,
            onDone: helpers.finalizeAssistant,
          }, helpers.signal)}
        />
      );
    }

    render(<Bridge />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'boom');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0].message).toContain('HTTP 502 Bad Gateway: bad gateway');
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('ignores throwing onChunk observers on the transport path', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onChunk = vi.fn(() => { throw new Error('analytics failed'); });
    const transport = vi.fn<Transport>(async () => sseResponse(['safe']));

    render(<Chorus transport={transport} onChunk={onChunk} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('safe')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`onChunk` callback threw'), expect.any(Error));
    warn.mockRestore();
  });

  it('ignores throwing onChunk observers on the onSend helper path', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onChunk = vi.fn(() => { throw new Error('analytics failed'); });
    const onSend = vi.fn<OnSend>(async (_text, _messages, helpers) => {
      helpers.appendAssistant('helper safe');
      helpers.finalizeAssistant();
    });

    render(<Chorus onSend={onSend} onChunk={onChunk} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('helper safe')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`onChunk` callback threw'), expect.any(Error));
    warn.mockRestore();
  });

  it('onSend non-abort error invokes onError with the Error object', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    const onSend = vi.fn(async () => {
      throw new Error('upstream boom');
    });

    render(<Chorus onSend={onSend} onError={onError} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'trigger error');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    const passed = onError.mock.calls[0][0];
    expect(passed).toBeInstanceOf(Error);
    expect(passed.message).toBe('upstream boom');
  });

  it('onSend non-abort error without an onError prop falls back to the UI banner', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => {
      throw new Error('upstream boom');
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'trigger error');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/upstream boom/i)).not.toBeInTheDocument();
  });

  it('custom renderError receives error context and dismiss clears the banner without retrying', async () => {
    const user = userEvent.setup();
    const rawError = new Error('upstream boom');
    const onSend = vi.fn(async () => {
      throw rawError;
    });
    const renderError = vi.fn(({ error, rawError, dismiss }) => (
      <div role="alert">
        <span>{error}</span>
        <span>{rawError?.message}</span>
        <button type="button" onClick={dismiss}>Dismiss problem</button>
      </div>
    ));

    render(<Chorus onSend={onSend} renderError={renderError} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'trigger error');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.');
    expect(screen.getByRole('alert')).toHaveTextContent('upstream boom');
    expect(renderError).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Something went wrong. Please try again.',
      rawError,
      retry: expect.any(Function),
      dismiss: expect.any(Function),
    }));

    await user.click(screen.getByRole('button', { name: /dismiss problem/i }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('onSend abort (user stop) does not invoke onError and shows no banner', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    let capturedSignal: AbortSignal | undefined;
    const onSend = vi.fn((_text: string, _messages: Message[], helpers: OnSendHelpers) => {
      capturedSignal = helpers.signal;
      return new Promise<void>((_resolve, reject) => {
        helpers.signal.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    render(<Chorus onSend={onSend} onError={onError} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stop me');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /stop/i }));

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(onError).not.toHaveBeenCalled();
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
  });

  it('ignores captured onSend helpers after Stop', async () => {
    const user = userEvent.setup();
    let helpers!: OnSendHelpers;
    const onSend = vi.fn((_text: string, _messages: Message[], h: OnSendHelpers) => {
      helpers = h;
      return new Promise<void>(() => undefined);
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stop stale helpers');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /stop/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());

    act(() => {
      helpers.appendAssistant('late chunk');
      helpers.finalizeAssistant();
    });

    expect(screen.queryByText('late chunk')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });
});
