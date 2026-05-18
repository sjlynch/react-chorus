import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { sseResponse, deferred } from './testUtils';
import type { Message, OnSend, OnSendHelpers, Transport } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus', () => {
  it('delays custom onSend helper chunks until minAssistantDelayMs elapses', async () => {
    vi.useFakeTimers();
    try {
      const onSend = vi.fn<OnSend>((_text, _messages, helpers) => {
        helpers.appendAssistant('Delayed helper');
        helpers.finalizeAssistant();
      });

      render(<Chorus onSend={onSend} minAssistantDelayMs={500} />);

      fireEvent.change(screen.getByPlaceholderText('Send a message'), { target: { value: 'hi' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(onSend).toHaveBeenCalledOnce();
      expect(screen.queryByText('Delayed helper')).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(499);
      });
      expect(screen.queryByText('Delayed helper')).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByText('Delayed helper')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes systemPrompt to onSend helpers without prepending it to messages', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn<OnSend>(async () => undefined);

    render(<Chorus onSend={onSend} systemPrompt="Stay concise." minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    const [, messages, helpers] = onSend.mock.calls[0];
    expect(messages).toEqual([expect.objectContaining({ role: 'user', text: 'hi' })]);
    expect(messages.some(message => message.role === 'system')).toBe(false);
    expect(helpers.systemPrompt).toBe('Stay concise.');
    expect(screen.queryByText('Stay concise.')).not.toBeInTheDocument();
  });

  it('onSend can return a message for a non-streaming assistant response', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn<OnSend>(async () => ({
      id: 'assistant-1',
      role: 'assistant',
      text: 'non-streamed reply',
      metadata: { source: 'rest' },
    }));

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(await screen.findByText('non-streamed reply')).toBeInTheDocument();
  });

  it('calls onFinish for completed transport streams with the final assistant message', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse(['Hel', 'lo']));
    const onFinish = vi.fn();

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} onFinish={onFinish} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'finish transport');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onFinish).toHaveBeenCalledOnce());
    expect(onFinish.mock.calls[0][0]).toEqual(expect.objectContaining({
      reason: 'done',
      message: expect.objectContaining({ role: 'assistant', text: 'Hello' }),
      response: expect.any(Response),
    }));
    expect(onFinish.mock.calls[0][0].messages.at(-1)).toEqual(expect.objectContaining({ text: 'Hello' }));
  });

  it('calls onFinish for helper streams, auto-finalized helper streams, and returned messages', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onFinish = vi.fn();
    const onSend = vi.fn<OnSend>(async (text, _messages, helpers) => {
      if (text === 'stream') {
        helpers.appendAssistant('helper done');
        helpers.finalizeAssistant();
        return;
      }
      if (text === 'auto') {
        helpers.appendAssistant('auto done');
        return;
      }
      return { id: 'returned', role: 'assistant', text: 'returned done' };
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} onFinish={onFinish} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stream');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
    expect(onFinish.mock.calls[0][0]).toEqual(expect.objectContaining({ reason: 'done', message: expect.objectContaining({ text: 'helper done' }) }));

    await user.type(screen.getByPlaceholderText('Send a message'), 'auto');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(2));
    expect(onFinish.mock.calls[1][0]).toEqual(expect.objectContaining({ reason: 'done', message: expect.objectContaining({ text: 'auto done' }) }));

    await user.type(screen.getByPlaceholderText('Send a message'), 'return');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(3));
    expect(onFinish.mock.calls[2][0]).toEqual(expect.objectContaining({ reason: 'returned-message', message: expect.objectContaining({ text: 'returned done' }) }));
    warn.mockRestore();
  });

  it('does not call onFinish on aborts, errors, or sends with no assistant output', async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    let helpers!: OnSendHelpers;
    const onSend = vi.fn<OnSend>((text, _messages, h) => {
      helpers = h;
      if (text === 'error') throw new Error('boom');
      if (text === 'empty') return undefined;
      h.appendAssistant('partial');
      return new Promise<void>((_resolve, reject) => {
        h.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} onFinish={onFinish} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stop');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /stop/i }));
    await waitFor(() => expect(helpers.signal.aborted).toBe(true));

    await user.type(screen.getByPlaceholderText('Send a message'), 'error');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('Something went wrong. Please try again.');

    await user.type(screen.getByPlaceholderText('Send a message'), 'empty');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('empty', expect.any(Array), expect.any(Object)));

    expect(onFinish).not.toHaveBeenCalled();
  });

  it('calls onAbort with the partial assistant when Stop cancels streamed onSend output', async () => {
    const user = userEvent.setup();
    const onAbort = vi.fn();
    let capturedSignal: AbortSignal | undefined;
    const onSend = vi.fn<OnSend>((_text, _messages, helpers) => {
      capturedSignal = helpers.signal;
      helpers.appendAssistant('partial abort');
      return new Promise<void>((_resolve, reject) => {
        helpers.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} onAbort={onAbort} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stop after token');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(await screen.findByText('partial abort')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /stop/i }));

    await waitFor(() => expect(onAbort).toHaveBeenCalledOnce());
    expect(capturedSignal?.aborted).toBe(true);
    expect(onAbort.mock.calls[0][0]).toEqual(expect.objectContaining({
      reason: 'stop',
      source: 'user',
      path: 'onSend',
      message: expect.objectContaining({ role: 'assistant', text: 'partial abort' }),
    }));
    expect(onAbort.mock.calls[0][0].messages).toEqual([
      expect.objectContaining({ role: 'user', text: 'stop after token' }),
      expect.objectContaining({ role: 'assistant', text: 'partial abort' }),
    ]);
  });

  it('calls onAbort with a null assistant when Stop happens before the first transport token', async () => {
    const user = userEvent.setup();
    const onAbort = vi.fn();
    let capturedSignal: AbortSignal | undefined;
    const transport = vi.fn<Transport>((_text, _history, signal) => {
      capturedSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        }, { once: true });
      });
    });

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} onAbort={onAbort} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stop before token');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /stop/i }));

    await waitFor(() => expect(onAbort).toHaveBeenCalledOnce());
    expect(capturedSignal?.aborted).toBe(true);
    expect(onAbort.mock.calls[0][0]).toEqual(expect.objectContaining({
      reason: 'stop',
      source: 'user',
      path: 'transport',
      message: null,
    }));
    expect(onAbort.mock.calls[0][0].messages).toEqual([
      expect.objectContaining({ role: 'user', text: 'stop before token' }),
    ]);
  });

  it('onSend path calls onSend with text, messages, and helpers', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [{ id: 'm1', role: 'assistant', text: 'Welcome' }];
    const onSend = vi.fn<OnSend>(async () => undefined);

    render(<Chorus messages={initial} onSend={onSend} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    const [text, messages, helpers] = onSend.mock.calls[0];
    expect(text).toBe('hello');
    expect(messages).toEqual([
      initial[0],
      expect.objectContaining({ role: 'user', text: 'hello' }),
    ]);
    expect(helpers).toEqual(expect.objectContaining({
      appendAssistant: expect.any(Function),
      finalizeAssistant: expect.any(Function),
      signal: expect.any(AbortSignal),
    }));
  });

  it('adds the user message before the assistant response arrives', async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    const onSend = vi.fn(() => pending.promise);

    render(<Chorus onSend={onSend} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'waiting prompt');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(screen.getByText('waiting prompt')).toBeInTheDocument();
    expect(screen.queryByText('late response')).not.toBeInTheDocument();

    pending.resolve();
  });

  it('finalizeAssistant ends the stream and sets sending=false', async () => {
    const user = userEvent.setup();
    let helpers!: OnSendHelpers;
    const onSend = vi.fn((_text: string, _messages: Message[], h: OnSendHelpers) => {
      helpers = h;
      return new Promise<void>(() => undefined);
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stream');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());

    act(() => helpers.appendAssistant('partial'));
    expect(await screen.findByText('partial')).toBeInTheDocument();

    act(() => helpers.finalizeAssistant());
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
  });

  it('auto-finalizes helper chunks when onSend resolves without finalizeAssistant', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onSend = vi.fn<OnSend>(async (_text, _messages, helpers) => {
      helpers.appendAssistant('forgotten finalize');
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stream');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('forgotten finalize')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('resolved without calling `helpers.finalizeAssistant()`'));
    warn.mockRestore();
  });

  it('auto-finalizes helper chunks without a process global', async () => {
    const user = userEvent.setup();
    const originalProcess = globalThis.process;
    const processWithoutEnv = Object.create(originalProcess ?? null) as typeof process;
    Object.defineProperty(processWithoutEnv, 'env', { value: undefined, configurable: true, writable: true });
    const onSend = vi.fn<OnSend>(async (_text, _messages, helpers) => {
      helpers.appendAssistant('browser finalize');
    });

    Object.defineProperty(globalThis, 'process', { value: processWithoutEnv, configurable: true, writable: true });
    try {
      render(<Chorus onSend={onSend} minAssistantDelayMs={0} />);

      await user.type(screen.getByPlaceholderText('Send a message'), 'stream');
      await user.click(screen.getByRole('button', { name: /send/i }));

      expect(await screen.findByText('browser finalize')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
      expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(globalThis, 'process', { value: originalProcess, configurable: true, writable: true });
    }
  });
});
