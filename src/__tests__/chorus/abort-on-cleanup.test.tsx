import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { sendMessage, deferred, makeSyncStorage } from './testUtils';
import type { OnSend, OnSendHelpers, Transport } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus abort-on-cleanup', () => {
  it('aborts the onSend helper signal when <Chorus> unmounts mid-send', async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    let capturedSignal: AbortSignal | undefined;
    const onSend = vi.fn<OnSend>((_text, _messages, helpers) => {
      capturedSignal = helpers.signal;
      return pending.promise;
    });

    const { unmount } = render(<Chorus onSend={onSend} minAssistantDelayMs={0} />);

    await sendMessage(user, 'hi');
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
    pending.resolve();
  });

  it('aborts the in-flight transport request when <Chorus> unmounts mid-stream', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let capturedSignal: AbortSignal | undefined;
    const transport = vi.fn<Transport>((_text, _history, signal) => {
      capturedSignal = signal;
      // A streaming response that never resolves — the request stays open
      // until something aborts the signal.
      return new Promise<Response>(() => undefined);
    });

    const { unmount } = render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await sendMessage(user, 'hi');
    await waitFor(() => expect(transport).toHaveBeenCalledOnce());
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
    warn.mockRestore();
  });

  it('aborts the active stream and routes onAbort when persistenceKey switches conversations', async () => {
    const user = userEvent.setup();
    const storage = makeSyncStorage();
    const onAbort = vi.fn();
    let helpers!: OnSendHelpers;
    const onSend = vi.fn<OnSend>((_text, _messages, h) => {
      helpers = h;
      // Stays open so the turn is still streaming when the conversation switches.
      return new Promise<void>(() => undefined);
    });

    const { rerender } = render(
      <Chorus persistenceKey="conv-a" persistenceStorage={storage} onSend={onSend} minAssistantDelayMs={0} onAbort={onAbort} />,
    );

    await sendMessage(user, 'hello A');
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());

    act(() => helpers.appendAssistant('A-only assistant token'));
    expect(await screen.findByText('A-only assistant token')).toBeInTheDocument();

    // Switch to a different conversation while the assistant is still streaming.
    rerender(
      <Chorus persistenceKey="conv-b" persistenceStorage={storage} onSend={onSend} minAssistantDelayMs={0} onAbort={onAbort} />,
    );

    // The stale stream is aborted and the abort is reported to the host.
    expect(helpers.signal.aborted).toBe(true);
    await waitFor(() => expect(onAbort).toHaveBeenCalledOnce());
    // A `'superseded'` abort discards the half-streamed partial instead of
    // finalizing it, so `message` is null rather than the truncated turn.
    expect(onAbort.mock.calls[0][0]).toEqual(expect.objectContaining({
      reason: 'superseded',
      source: 'programmatic',
      path: 'onSend',
      message: null,
    }));

    // Conversation B never shows conversation A's streamed token...
    expect(screen.queryByText('A-only assistant token')).not.toBeInTheDocument();
    // ...and a late token from the aborted stream cannot land in B either.
    act(() => helpers.appendAssistant('late stale token'));
    expect(screen.queryByText('late stale token')).not.toBeInTheDocument();
  });

  it('warns once in development when onSend resolves without appending or returning a message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onFinish = vi.fn();
    const onAbort = vi.fn();
    const onSend = vi.fn<OnSend>(async () => undefined);

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} onFinish={onFinish} onAbort={onAbort} />);

    const input = screen.getByPlaceholderText('Send a message');
    const sendButton = screen.getByRole('button', { name: /send/i });
    const emptyOnSendWarnings = () =>
      warn.mock.calls.filter(call => String(call[0]).includes('resolved without appending'));

    fireEvent.change(input, { target: { value: 'noop one' } });
    fireEvent.click(sendButton);
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(emptyOnSendWarnings()).toHaveLength(1));
    expect(emptyOnSendWarnings()[0][0]).toContain('no `onFinish`/`onAbort` observer fires');

    // A second no-op turn runs, but the warning is once-guarded per instance.
    fireEvent.change(input, { target: { value: 'noop two' } });
    fireEvent.click(sendButton);
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    expect(emptyOnSendWarnings()).toHaveLength(1);

    // A silent turn closes without any lifecycle observer.
    expect(onFinish).not.toHaveBeenCalled();
    expect(onAbort).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
