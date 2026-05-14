import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus, type ChorusOnSend, type ChorusProps, type ChorusRef, type ChorusSendHelpers, type Transport } from '../Chorus';
import { useChorusStream } from '../hooks/useChorusStream';
import type { Message, StorageAdapter } from '../types';

type OnSend = ChorusOnSend;
type OnSendHelpers = ChorusSendHelpers;

vi.mock('../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

function sseResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(body, { status });
}

function erroringSSEResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(`data: ${chunks[index]}\n\n`));
        index += 1;
        return;
      }
      controller.error(new Error('stream exploded'));
    },
  });

  return new Response(body, { status: 200 });
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSyncStorage(initial: Record<string, string> = {}): StorageAdapter & { store: Record<string, string> } {
  const store = { ...initial };
  return {
    store,
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = value; },
  };
}

describe('Chorus', () => {
  it('applies className, style, palette variables, and HTML attributes to the root element', () => {
    const { container } = render(
      <Chorus
        id="chorus-root"
        data-testid="chorus-root"
        className="my-chat"
        style={{ height: '500px' }}
        palette={{
          chatBg: '#000',
          actionText: '#111',
          actionHoverBg: '#222',
          actionHoverText: '#333',
          errorBg: '#444',
          errorBorder: '#555',
          errorText: '#666',
        }}
      />
    );

    const root = container.firstElementChild as HTMLElement;

    expect(root).toHaveClass('chorus', 'my-chat');
    expect(root).toHaveAttribute('id', 'chorus-root');
    expect(root).toHaveAttribute('data-testid', 'chorus-root');
    expect(root.style.height).toBe('500px');
    expect(root.style.getPropertyValue('--chorus-chat-bg')).toBe('#000');
    expect(root.style.getPropertyValue('--chorus-action-text')).toBe('#111');
    expect(root.style.getPropertyValue('--chorus-action-hover-bg')).toBe('#222');
    expect(root.style.getPropertyValue('--chorus-action-hover-text')).toBe('#333');
    expect(root.style.getPropertyValue('--chorus-error-bg')).toBe('#444');
    expect(root.style.getPropertyValue('--chorus-error-border')).toBe('#555');
    expect(root.style.getPropertyValue('--chorus-error-text')).toBe('#666');
  });

  it('exposes an imperative ChorusRef for send, focus, clear, stop, and scrollToMessage', async () => {
    const ref = React.createRef<ChorusRef>();
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const onSend = vi.fn<OnSend>(async () => ({ id: 'a1', role: 'assistant', text: 'ref reply' }));

    render(<Chorus ref={ref} onSend={onSend} minAssistantDelayMs={0} showClearButton />);

    act(() => ref.current?.focus());
    expect(screen.getByRole('textbox')).toHaveFocus();

    act(() => ref.current?.send('hi from ref'));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('hi from ref', expect.any(Array), expect.any(Object)));
    expect(await screen.findByText('ref reply')).toBeInTheDocument();

    act(() => ref.current?.scrollToMessage('a1'));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

    act(() => ref.current?.stop());
    act(() => ref.current?.clear());
    expect(screen.queryByText('hi from ref')).not.toBeInTheDocument();
  });

  it('transport path send() fires transport and streams tokens into the message list', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse(['Hel', 'lo']));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));

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

    await user.type(screen.getByPlaceholderText('Send a message'), 'why');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('final answer')).toBeInTheDocument();
    const summary = screen.getByText('Reasoning');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('plan first')).toBeInTheDocument();
  });

  it('renders streamed connector tool calls as visible tool rows by default', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '{"q":' } }] } }] }),
      JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"test"}' } }] } }] }),
      '[DONE]',
    ]));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'use a tool');
    await user.click(screen.getByRole('button', { name: /send/i }));

    const toolButton = await screen.findByRole('button', { name: /search/i });
    expect(toolButton).toBeInTheDocument();
    await user.click(toolButton);
    expect(screen.getByText(/"q": "test"/)).toBeInTheDocument();
  });

  it('accepts a custom connector object on the transport path', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse(['ignored']));

    render(<Chorus transport={transport} connector={{ name: 'custom', extract: () => ({ text: 'X' }) }} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));

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

  it('renders initialMessages in uncontrolled mode', () => {
    render(<Chorus initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Welcome!' }]} />);

    expect(screen.getByText('Welcome!')).toBeInTheDocument();
  });

  it('fills and focuses the composer when a suggested prompt is clicked', async () => {
    const user = userEvent.setup();

    render(<Chorus suggestedPrompts={['Plan a launch checklist', 'Write a test plan']} />);

    await user.click(screen.getByRole('button', { name: 'Plan a launch checklist' }));

    const composer = screen.getByRole('textbox', { name: /send a message/i });
    expect(composer).toHaveValue('Plan a launch checklist');
    await waitFor(() => expect(composer).toHaveFocus());
  });

  it('prefers custom emptyState over suggestedPrompts', () => {
    render(<Chorus emptyState={<div>Custom welcome</div>} suggestedPrompts={['Hidden prompt']} />);

    expect(screen.getByText('Custom welcome')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hidden prompt' })).not.toBeInTheDocument();
  });

  it('renders and persists initialMessages when persistence storage is empty', async () => {
    const storage = makeSyncStorage();
    const welcome: Message[] = [{ id: 'welcome', role: 'assistant', text: 'Welcome!' }];

    render(<Chorus persistenceKey="chat" persistenceStorage={storage} initialMessages={welcome} />);

    expect(screen.getByText('Welcome!')).toBeInTheDocument();
    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify(welcome)));
  });

  it('uses legacy messages as a persistence seed when storage is empty', async () => {
    const storage = makeSyncStorage();
    const welcome: Message[] = [{ id: 'welcome', role: 'assistant', text: 'Legacy welcome!' }];

    render(<Chorus persistenceKey="chat" persistenceStorage={storage} messages={welcome} />);

    expect(screen.getByText('Legacy welcome!')).toBeInTheDocument();
    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify(welcome)));
  });

  it('lets existing persisted history win over initialMessages', () => {
    const stored: Message[] = [{ id: 'stored', role: 'assistant', text: 'Stored history' }];
    const storage = makeSyncStorage({ chat: JSON.stringify(stored) });

    render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={storage}
        initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Welcome!' }]}
      />
    );

    expect(screen.getByText('Stored history')).toBeInTheDocument();
    expect(screen.queryByText('Welcome!')).not.toBeInTheDocument();
  });

  it('keeps the initialMessages seed after an empty async persistence load resolves', async () => {
    const welcome: Message[] = [{ id: 'welcome', role: 'assistant', text: 'Async welcome!' }];
    const asyncStorage: StorageAdapter = {
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn(),
    };

    render(<Chorus persistenceKey="chat" persistenceStorage={asyncStorage} initialMessages={welcome} />);

    expect(screen.getByText('Async welcome!')).toBeInTheDocument();
    await waitFor(() => expect(asyncStorage.setItem).toHaveBeenCalledWith('chat', JSON.stringify(welcome)));
    expect(screen.getByText('Async welcome!')).toBeInTheDocument();
  });

  it('replaces the initialMessages seed when async persistence loads stored history', async () => {
    const stored: Message[] = [{ id: 'stored', role: 'assistant', text: 'Async stored history' }];
    const asyncStorage: StorageAdapter = {
      getItem: vi.fn().mockResolvedValue(JSON.stringify(stored)),
      setItem: vi.fn(),
    };

    render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={asyncStorage}
        initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Async welcome!' }]}
      />
    );

    expect(screen.getByText('Async welcome!')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Async stored history')).toBeInTheDocument());
    expect(screen.queryByText('Async welcome!')).not.toBeInTheDocument();
    expect(asyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('coalesces persistence writes during token streams and flushes the final assistant text', async () => {
    const user = userEvent.setup();
    const chunks = Array.from({ length: 100 }, () => 'x');
    const finalText = chunks.join('');
    const store: Record<string, string> = {};
    const storage: StorageAdapter = {
      getItem: vi.fn((key) => store[key] ?? null),
      setItem: vi.fn((key, value) => { store[key] = value; }),
    };
    const transport = vi.fn<Transport>(async () => sseResponse(chunks));

    render(<Chorus persistenceKey="chat" persistenceStorage={storage} transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'persist stream');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(finalText)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    await waitFor(() => expect(storage.setItem).toHaveBeenCalled());

    const callsAfterFinal = vi.mocked(storage.setItem).mock.calls.length;
    expect(callsAfterFinal).toBeLessThanOrEqual(3);

    const lastWrite = vi.mocked(storage.setItem).mock.calls.at(-1);
    expect(lastWrite?.[0]).toBe('chat');
    const persistedMessages = JSON.parse(lastWrite?.[1] ?? '[]') as Message[];
    expect(persistedMessages).toEqual([
      expect.objectContaining({ role: 'user', text: 'persist stream' }),
      expect.objectContaining({ role: 'assistant', text: finalText }),
    ]);

    await new Promise(resolve => setTimeout(resolve, 120));
    expect(storage.setItem).toHaveBeenCalledTimes(callsAfterFinal);
  });

  it('surfaces persistence write failures through onPersistenceError', async () => {
    const user = userEvent.setup();
    const quotaError = new DOMException('Full', 'QuotaExceededError');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onPersistenceError = vi.fn();
    const storage: StorageAdapter = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw quotaError; }),
    };

    render(<Chorus persistenceKey="chat" persistenceStorage={storage} onPersistenceError={onPersistenceError} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'will persist');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(screen.getByText('will persist')).toBeInTheDocument();
    await waitFor(() => expect(onPersistenceError).toHaveBeenCalledWith(quotaError));
    expect(warn).toHaveBeenCalledWith('[Chorus] Failed to persist messages.', quotaError);
    warn.mockRestore();
  });

  it('prepends systemPrompt to transport history without rendering it', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([]));

    render(<Chorus transport={transport} systemPrompt="Stay concise." minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledOnce());
    expect(transport.mock.calls[0][1]).toEqual([
      { id: 'chorus-system-prompt', role: 'system', text: 'Stay concise.' },
      expect.objectContaining({ role: 'user', text: 'hi' }),
    ]);
    expect(screen.queryByText('Stay concise.')).not.toBeInTheDocument();
  });

  it('warns in development when an update produces duplicate message IDs', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onSend = vi.fn<NonNullable<ChorusProps['onSend']>>(async () => undefined);

    render(<Chorus messages={[
      { id: 'dup', role: 'assistant', text: 'one' },
      { id: 'dup', role: 'assistant', text: 'two' },
    ]} onSend={onSend} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(warn).toHaveBeenCalledWith('[Chorus] Duplicate message IDs detected:', ['dup']));
    warn.mockRestore();
  });

  it('generates unique message IDs for rapid sends in the same millisecond', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let latestMessages: Message[] = [];

    function Harness() {
      const [messages, setMessages] = React.useState<Message[]>([]);
      return (
        <Chorus
          value={messages}
          onChange={(next) => {
            latestMessages = next;
            setMessages(next);
          }}
          onSend={() => ({ role: 'assistant', text: 'ok' } as Message)}
          minAssistantDelayMs={0}
        />
      );
    }

    render(<Harness />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'one');
    const firstNow = vi.spyOn(Date, 'now').mockReturnValue(12345);
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(latestMessages).toHaveLength(2));
    firstNow.mockRestore();

    await user.type(screen.getByPlaceholderText('Send a message'), 'two');
    const secondNow = vi.spyOn(Date, 'now').mockReturnValue(12345);
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(latestMessages).toHaveLength(4));
    secondNow.mockRestore();

    const ids = latestMessages.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns when messages is paired with onChange instead of value', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<Chorus messages={[]} onChange={vi.fn()} />);

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('`messages` is initial-only')));
    warn.mockRestore();
  });

  it('warns when value and persistenceKey are both provided', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<Chorus value={[]} persistenceKey="chat" />);

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('Both `value` and `persistenceKey`')));
    warn.mockRestore();
  });

  it('warns once at send time when neither transport nor onSend is provided', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<Chorus />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await user.type(screen.getByPlaceholderText('Send a message'), 'again');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('`transport` nor `onSend`')));
    expect(warn.mock.calls.filter(call => String(call[0]).includes('`transport` nor `onSend`'))).toHaveLength(1);
    warn.mockRestore();
  });

  it('warns when sending is provided with a transport', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<Chorus transport={async () => sseResponse([])} sending={false} />);

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('`sending` was provided alongside `transport`')));
    warn.mockRestore();
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

  it('controlled mode forwards new messages via onChange and renders the externally-controlled list', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [{ id: 'seed', role: 'assistant', text: 'seeded reply' }];
    const onChange = vi.fn<(next: Message[]) => void>();
    const onSend = vi.fn(async () => undefined);

    render(<Chorus value={initial} onChange={onChange} onSend={onSend} minAssistantDelayMs={0} />);

    // The externally-controlled list is rendered as-is.
    expect(screen.getByText('seeded reply')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Send a message'), 'hello there');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const latestCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(latestCall).toEqual(
      expect.arrayContaining([
        initial[0],
        expect.objectContaining({ role: 'user', text: 'hello there' }),
      ]),
    );
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('Retry re-triggers the assistant with the last user text', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([], 500));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'try again');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByRole('button', { name: /retry/i });

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    expect(transport.mock.calls[0][0]).toBe('try again');
    expect(transport.mock.calls[1][0]).toBe('try again');
  });

  it('Retry resubmits an image-only message with its attachment', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([], 500));
    const file = new File(['image-bytes'], 'photo.png', { type: 'image/png' });
    const { container } = render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} accept="image/*" />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await screen.findByText('photo.png');

    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByRole('button', { name: /retry/i });

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    expect(transport.mock.calls[1][0]).toBe('');
    expect(transport.mock.calls[1][1]).toEqual([
      expect.objectContaining({
        role: 'user',
        text: '',
        attachments: [expect.objectContaining({
          name: 'photo.png',
          type: 'image/png',
          size: file.size,
          data: expect.stringMatching(/^data:image\/png;base64,/),
        })],
      }),
    ]);
  });

  it('Retry preserves a text-and-attachment turn without duplicating it', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => (
      transport.mock.calls.length === 1
        ? sseResponse([], 500)
        : sseResponse(['ok'])
    ));
    const file = new File(['image-bytes'], 'photo.png', { type: 'image/png' });
    const { container } = render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} accept="image/*" />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await screen.findByText('photo.png');
    await user.type(screen.getByPlaceholderText('Send a message'), 'describe this');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByRole('button', { name: /retry/i });

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    const retryHistory = transport.mock.calls[1][1];
    const userTurns = retryHistory.filter(message => message.role === 'user');
    expect(userTurns).toHaveLength(1);
    expect(userTurns[0]).toEqual(expect.objectContaining({
      role: 'user',
      text: 'describe this',
      attachments: [expect.objectContaining({
        name: 'photo.png',
        type: 'image/png',
        size: file.size,
        data: expect.stringMatching(/^data:image\/png;base64,/),
      })],
    }));
    expect(screen.getAllByText('describe this')).toHaveLength(1);
    await waitFor(() => expect(screen.getAllByAltText('photo.png')).toHaveLength(1));
  });

  it('removes a failed partial transport response before retrying', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => (
      transport.mock.calls.length === 1
        ? erroringSSEResponse(['partial answer'])
        : sseResponse(['fresh answer'])
    ));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'try again');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('partial answer')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText('fresh answer')).toHaveLength(1));
    expect(transport.mock.calls[1][1]).toEqual([
      expect.objectContaining({ role: 'user', text: 'try again' }),
    ]);
    expect(transport.mock.calls[1][1]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'partial answer' })]),
    );
  });

  it('blocks built-in sends during an active transport request even when sending is visually overridden false', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const transport = vi.fn<Transport>(() => new Promise<Response>(() => undefined));

    render(<Chorus transport={transport} sending={false} minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'first');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));

    await user.type(screen.getByPlaceholderText('Send a message'), 'second');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(transport).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('first')).toHaveLength(1);
    expect(screen.getByRole('log')).not.toHaveTextContent('second');
    warn.mockRestore();
  });

  it('Stop button aborts the active transport stream', async () => {
    const user = userEvent.setup();
    let capturedSignal: AbortSignal | undefined;
    const transport = vi.fn((_text: string, _history: Message[], signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stop me');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /stop/i }));

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('handleEdit truncates the message list at the edited index and re-triggers', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'original' },
      { id: 'a1', role: 'assistant', text: 'first answer' },
      { id: 'u2', role: 'user', text: 'follow up' },
      { id: 'a2', role: 'assistant', text: 'second answer' },
    ];
    const onSend = vi.fn(() => new Promise<void>(() => undefined));

    render(<Chorus messages={initial} onSend={onSend} />);

    await user.click(screen.getAllByTitle('Edit')[0]);
    const editBox = screen.getByDisplayValue('original');
    await user.clear(editBox);
    await user.type(editBox, 'edited');
    await user.click(screen.getByTitle('Save'));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      'edited',
      expect.any(Array),
      expect.any(Object),
    ));
    expect(screen.getByText('edited')).toBeInTheDocument();
    expect(screen.queryByText('first answer')).not.toBeInTheDocument();
    expect(screen.queryByText('follow up')).not.toBeInTheDocument();
    expect(screen.queryByText('second answer')).not.toBeInTheDocument();
  });

  it('handleRegenerate removes the assistant message and re-triggers with the preceding user text', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'question' },
      { id: 'a1', role: 'assistant', text: 'old answer' },
    ];
    const onSend = vi.fn(() => new Promise<void>(() => undefined));

    render(<Chorus messages={initial} onSend={onSend} />);

    await user.click(screen.getByTitle('Regenerate'));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      'question',
      expect.any(Array),
      expect.any(Object),
    ));
    expect(screen.getByText('question')).toBeInTheDocument();
    expect(screen.queryByText('old answer')).not.toBeInTheDocument();
  });

  it('handleDelete removes the message from the list', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'remove me' },
      { id: 'a1', role: 'assistant', text: 'keep me' },
    ];

    render(<Chorus messages={initial} />);

    await user.click(screen.getAllByTitle('Delete')[0]);

    expect(screen.queryByText('remove me')).not.toBeInTheDocument();
    expect(screen.getByText('keep me')).toBeInTheDocument();
  });

  it('clears uncontrolled messages from the built-in clear button', async () => {
    const user = userEvent.setup();

    render(
      <Chorus
        messages={[{ id: 'welcome', role: 'assistant', text: 'clear me' }]}
        showClearButton
      />
    );

    expect(screen.getByText('clear me')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear conversation/i }));

    expect(screen.queryByText('clear me')).not.toBeInTheDocument();
  });

  it('can reset to the initialMessages seed when requested', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn<OnSend>(async () => ({ id: 'a1', role: 'assistant', text: 'reply' }));

    render(
      <Chorus
        initialMessages={[{ id: 'welcome', role: 'assistant', text: 'welcome back' }]}
        onSend={onSend}
        minAssistantDelayMs={0}
        showClearButton
        resetToInitialMessages
      />
    );

    await user.type(screen.getByPlaceholderText('Send a message'), 'question');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(await screen.findByText('reply')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear conversation/i }));

    expect(screen.getByText('welcome back')).toBeInTheDocument();
    expect(screen.queryByText('question')).not.toBeInTheDocument();
    expect(screen.queryByText('reply')).not.toBeInTheDocument();
  });

  it('controlled clear calls onChange with the reset list', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(messages: Message[]) => void>();
    const onClear = vi.fn<(messages: Message[]) => void>();

    function Harness() {
      const [messages, setMessages] = React.useState<Message[]>([{ id: 'm1', role: 'assistant', text: 'controlled message' }]);
      return (
        <Chorus
          value={messages}
          onChange={(next) => {
            onChange(next);
            setMessages(next);
          }}
          onClear={onClear}
          showClearButton
        />
      );
    }

    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /clear conversation/i }));

    expect(onChange).toHaveBeenCalledWith([]);
    expect(onClear).toHaveBeenCalledWith([]);
    expect(screen.queryByText('controlled message')).not.toBeInTheDocument();
  });

  it('persists cleared conversations so initialMessages do not resurrect on reload', async () => {
    const user = userEvent.setup();
    const storage = makeSyncStorage();
    const welcome: Message[] = [{ id: 'welcome', role: 'assistant', text: 'persistent welcome' }];
    const { unmount } = render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={storage}
        initialMessages={welcome}
        showClearButton
      />
    );

    expect(screen.getByText('persistent welcome')).toBeInTheDocument();
    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify(welcome)));

    await user.click(screen.getByRole('button', { name: /clear conversation/i }));
    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify([])));
    expect(screen.queryByText('persistent welcome')).not.toBeInTheDocument();

    unmount();
    render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={storage}
        initialMessages={welcome}
        showClearButton
      />
    );

    expect(screen.queryByText('persistent welcome')).not.toBeInTheDocument();
  });
});
