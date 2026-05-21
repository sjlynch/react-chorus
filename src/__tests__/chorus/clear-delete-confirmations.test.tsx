import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { sendMessage, deferred, makeSyncStorage } from './testUtils';
import type { Message, OnSend } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus clear and delete confirmations', () => {
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
    await sendMessage(user, 'next');
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

    await sendMessage(user, 'question');
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
