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

describe('Chorus error bridging', () => {
  it('shows an error banner when the transport path fails', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([], 500));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await sendMessage(user, 'boom');

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('transport path passes the raw error to onError while keeping the UI banner generic', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([], 500));
    const onError = vi.fn();

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} onError={onError} />);

    await sendMessage(user, 'boom');

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

    await sendMessage(user, 'boom');

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

    await sendMessage(user, 'blocked');

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0].message).toContain('finishReason: SAFETY');
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/finishReason: SAFETY/)).not.toBeInTheDocument();
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

    await sendMessage(user, 'boom');

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0].message).toContain('HTTP 502 Bad Gateway: bad gateway');
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('surfaces a bridged streamCallbacks() error even when onSend does not return the send() promise', async () => {
    const user = userEvent.setup();
    const bridgeTransport = vi.fn<Transport>(async () => new Response('bad gateway', { status: 502, statusText: 'Bad Gateway' }));
    const onError = vi.fn();

    function Bridge() {
      const { send } = useChorusStream(bridgeTransport);
      return (
        <Chorus
          minAssistantDelayMs={0}
          onError={onError}
          onSend={(text, messages, helpers) => {
            // Fire-and-forget: the send() promise is intentionally neither
            // returned nor awaited, so onSend resolves void before the stream
            // errors. The bundled streamCallbacks().onError is the only path
            // left to surface the failure. `.catch` only swallows the
            // already-reported rejection so the test sees no unhandled reject.
            send(text, messages, helpers.streamCallbacks?.() ?? {
              onChunk: helpers.appendAssistant,
              onDone: helpers.finalizeAssistant,
            }, helpers.signal).catch(() => {});
          }}
        />
      );
    }

    render(<Bridge />);

    await sendMessage(user, 'boom');

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toContain('HTTP 502 Bad Gateway: bad gateway');
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('onSend non-abort error invokes onError with the Error object', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    const onSend = vi.fn(async () => {
      throw new Error('upstream boom');
    });

    render(<Chorus onSend={onSend} onError={onError} minAssistantDelayMs={0} />);

    await sendMessage(user, 'trigger error');

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

    await sendMessage(user, 'trigger error');

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

    await sendMessage(user, 'trigger error');

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
});
