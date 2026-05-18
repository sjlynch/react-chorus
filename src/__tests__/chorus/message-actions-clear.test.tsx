import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { sseResponse, erroringSSEResponse, deferred, makeSyncStorage } from './testUtils';
import type { Message, OnSend, OnSendHelpers, Transport } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus', () => {
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
    await waitFor(() => expect(screen.getAllByAltText('Attached image: photo.png')).toHaveLength(1));
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
    const file = new File(['image-bytes'], 'blocked.png', { type: 'image/png' });

    const { container } = render(<Chorus transport={transport} sending={false} minAssistantDelayMs={0} accept="image/*" />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'first');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await screen.findByText('blocked.png');
    await user.type(screen.getByPlaceholderText('Send a message'), 'second');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(transport).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('first')).toHaveLength(1);
    expect(screen.getByRole('log')).not.toHaveTextContent('second');
    expect(screen.getByText('blocked.png')).toBeInTheDocument();
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

  it('cancels message delete when confirmDeleteMessage returns false without flushing persistence', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'keep me safe' },
      { id: 'a1', role: 'assistant', text: 'also keep me' },
    ];
    const storage = makeSyncStorage({ chat: JSON.stringify(initial) });
    const setItem = vi.fn(storage.setItem);
    storage.setItem = setItem;
    const confirmDeleteMessage = vi.fn(() => false);

    render(<Chorus persistenceKey="chat" persistenceStorage={storage} confirmDeleteMessage={confirmDeleteMessage} />);

    expect(await screen.findByText('keep me safe')).toBeInTheDocument();
    await user.click(screen.getAllByTitle('Delete')[0]);

    expect(confirmDeleteMessage).toHaveBeenCalledWith({
      message: expect.objectContaining({ id: 'u1', text: 'keep me safe' }),
      messages: initial,
    });
    expect(screen.getByText('keep me safe')).toBeInTheDocument();
    expect(screen.getByText('also keep me')).toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('hides the built-in Delete action on prior messages while a send is streaming', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'prior turn' },
      { id: 'a1', role: 'assistant', text: 'prior reply' },
    ];
    const pending = deferred<void>();
    const onSend = vi.fn<OnSend>((_text, _messages, helpers) => {
      helpers.appendAssistant('streaming…');
      return pending.promise;
    });

    render(<Chorus messages={initial} onSend={onSend} minAssistantDelayMs={0} />);

    // Delete buttons present in the idle state.
    expect(screen.getAllByTitle('Delete')).toHaveLength(2);

    await user.type(screen.getByPlaceholderText('Send a message'), 'next');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('streaming…')).toBeInTheDocument();

    // No Delete buttons anywhere while sending.
    expect(screen.queryAllByTitle('Delete')).toHaveLength(0);

    pending.resolve();
  });

  it('keeps the streaming assistant message intact when delete is suppressed during a send', async () => {
    const user = userEvent.setup();
    let helpers!: OnSendHelpers;
    const pending = deferred<void>();
    const onFinish = vi.fn();
    const onSend = vi.fn<OnSend>((_text, _messages, h) => {
      helpers = h;
      h.appendAssistant('partial');
      return pending.promise;
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} onFinish={onFinish} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'go');
    await user.click(screen.getByRole('button', { name: /send/i }));

    // First token rendered into a streaming assistant message; Delete is suppressed.
    expect(await screen.findByText('partial')).toBeInTheDocument();
    expect(screen.queryAllByTitle('Delete')).toHaveLength(0);

    // Subsequent chunks still land in the streaming message (no orphaned pending state).
    act(() => { helpers.appendAssistant(' done'); });
    act(() => { helpers.finalizeAssistant(); });
    pending.resolve();

    await waitFor(() => expect(onFinish).toHaveBeenCalledOnce());
    expect(onFinish.mock.calls[0][0]).toEqual(expect.objectContaining({
      reason: 'done',
      message: expect.objectContaining({ role: 'assistant', text: 'partial done' }),
    }));
    expect(screen.getByText('partial done')).toBeInTheDocument();
  });

  it('does not commit an async confirmDeleteMessage that resolves after a send has started', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'protect me' },
      { id: 'a1', role: 'assistant', text: 'i stay' },
    ];
    const confirmation = deferred<boolean>();
    const confirmDeleteMessage = vi.fn(() => confirmation.promise);
    const sendPending = deferred<void>();
    const onSend = vi.fn<OnSend>((_text, _messages, helpers) => {
      helpers.appendAssistant('streaming…');
      return sendPending.promise;
    });

    render(
      <Chorus
        messages={initial}
        confirmDeleteMessage={confirmDeleteMessage}
        onSend={onSend}
        minAssistantDelayMs={0}
      />
    );

    // Open the async confirmation while still idle.
    await user.click(screen.getAllByTitle('Delete')[0]);
    await waitFor(() => expect(confirmDeleteMessage).toHaveBeenCalledOnce());

    // Start a send while the confirmation is still pending.
    await user.type(screen.getByPlaceholderText('Send a message'), 'next');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(await screen.findByText('streaming…')).toBeInTheDocument();

    // Confirmation resolves true — but the delete must NOT commit, because a send
    // is in flight and removing prior context would diverge the transcript from
    // the history that produced the active response.
    await act(async () => {
      confirmation.resolve(true);
      await Promise.resolve();
    });

    expect(screen.getByText('protect me')).toBeInTheDocument();
    expect(screen.getByText('i stay')).toBeInTheDocument();

    sendPending.resolve();
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

  it('cancels the built-in clear when confirmClearConversation returns false without touching persistence', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'keep me too' },
      { id: 'a1', role: 'assistant', text: 'preserved reply' },
    ];
    const storage = makeSyncStorage({ chat: JSON.stringify(initial) });
    const setItem = vi.fn(storage.setItem);
    const removeItem = vi.fn();
    storage.setItem = setItem;
    storage.removeItem = removeItem;
    const onClear = vi.fn();
    const confirmClearConversation = vi.fn(() => false);

    render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={storage}
        confirmClearConversation={confirmClearConversation}
        onClear={onClear}
        showClearButton
      />,
    );

    expect(await screen.findByText('keep me too')).toBeInTheDocument();
    setItem.mockClear();

    await user.click(screen.getByRole('button', { name: /clear conversation/i }));

    expect(confirmClearConversation).toHaveBeenCalledWith({
      messages: initial,
      resetToInitialMessages: false,
      source: 'user',
      persistenceKey: 'chat',
    });
    expect(screen.getByText('keep me too')).toBeInTheDocument();
    expect(screen.getByText('preserved reply')).toBeInTheDocument();
    expect(onClear).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(storage.store.chat).toBe(JSON.stringify(initial));
  });

  it('cancels async confirmClearConversation, disables the clear button while pending, and ignores duplicate clicks', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [{ id: 'm1', role: 'assistant', text: 'persist me' }];
    const storage = makeSyncStorage({ chat: JSON.stringify(initial) });
    const setItem = vi.fn(storage.setItem);
    storage.setItem = setItem;

    let pending = deferred<boolean>();
    const confirmClearConversation = vi.fn(() => pending.promise);

    render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={storage}
        confirmClearConversation={confirmClearConversation}
        showClearButton
      />,
    );

    expect(await screen.findByText('persist me')).toBeInTheDocument();
    setItem.mockClear();

    const button = screen.getByRole('button', { name: /clear conversation/i });
    await user.click(button);
    expect(confirmClearConversation).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();

    await user.click(button);
    expect(confirmClearConversation).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(false);
      await pending.promise;
    });

    await waitFor(() => expect(button).not.toBeDisabled());
    expect(screen.getByText('persist me')).toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
    expect(storage.store.chat).toBe(JSON.stringify(initial));

    pending = deferred<boolean>();
    await user.click(button);
    await act(async () => {
      pending.resolve(true);
      await pending.promise;
    });

    await waitFor(() => expect(screen.queryByText('persist me')).not.toBeInTheDocument());
    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify([])));
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
});
