import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus, type ChorusProps, type Transport } from '../Chorus';
import type { Message, StorageAdapter } from '../types';

type OnSend = NonNullable<ChorusProps['onSend']>;
type OnSendHelpers = Parameters<OnSend>[2];

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
  it('applies className, style, and palette variables to the root element', () => {
    const { container } = render(
      <Chorus
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
    expect(root.style.height).toBe('500px');
    expect(root.style.getPropertyValue('--chorus-chat-bg')).toBe('#000');
    expect(root.style.getPropertyValue('--chorus-action-text')).toBe('#111');
    expect(root.style.getPropertyValue('--chorus-action-hover-bg')).toBe('#222');
    expect(root.style.getPropertyValue('--chorus-action-hover-text')).toBe('#333');
    expect(root.style.getPropertyValue('--chorus-error-bg')).toBe('#444');
    expect(root.style.getPropertyValue('--chorus-error-border')).toBe('#555');
    expect(root.style.getPropertyValue('--chorus-error-text')).toBe('#666');
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

  it('renders initialMessages in uncontrolled mode', () => {
    render(<Chorus initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Welcome!' }]} />);

    expect(screen.getByText('Welcome!')).toBeInTheDocument();
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

    render(<Chorus onSend={onSend} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'stream');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());

    act(() => helpers.appendAssistant('partial'));
    expect(await screen.findByText('partial')).toBeInTheDocument();

    act(() => helpers.finalizeAssistant());
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
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
    expect(onError.mock.calls[0][0].message).toMatch(/Bad response \(500\) or missing body/i);
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/Bad response \(500\) or missing body/i)).not.toBeInTheDocument();
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
});
