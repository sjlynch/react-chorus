import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { sseResponse, deferred, makeSyncStorage } from './testUtils';
import type { ChorusRef, Message, OnSend, StorageAdapter, Transport } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus', () => {
  it('renders, observes, and persists initialMessages when persistence storage is empty', async () => {
    const storage = makeSyncStorage();
    const onMessagesChange = vi.fn();
    const welcome: Message[] = [{ id: 'welcome', role: 'assistant', text: 'Welcome!' }];

    render(<Chorus persistenceKey="chat" persistenceStorage={storage} initialMessages={welcome} onMessagesChange={onMessagesChange} />);

    expect(screen.getByText('Welcome!')).toBeInTheDocument();
    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify(welcome)));
    expect(onMessagesChange).toHaveBeenCalledWith(welcome, expect.objectContaining({
      source: 'persistence',
      reason: 'persistence-seed',
    }));
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

  it('observes persistence-backed loads and clears', async () => {
    const user = userEvent.setup();
    const stored: Message[] = [{ id: 'stored', role: 'assistant', text: 'Stored observed history' }];
    const storage = makeSyncStorage({ chat: JSON.stringify(stored) });
    const onMessagesChange = vi.fn();

    render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={storage}
        onMessagesChange={onMessagesChange}
        showClearButton
      />,
    );

    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledWith(
      stored,
      expect.objectContaining({ source: 'persistence', reason: 'persistence-load' }),
    ));

    await user.click(screen.getByRole('button', { name: /clear conversation/i }));

    await waitFor(() => expect(onMessagesChange).toHaveBeenLastCalledWith([], expect.objectContaining({ source: 'persistence', reason: 'clear' })));
  });

  it('resets composer draft when persistenceKey switches conversations', async () => {
    const user = userEvent.setup();
    const storage = makeSyncStorage({
      'chat:a': JSON.stringify([{ id: 'a1', role: 'assistant', text: 'Conversation A' }]),
      'chat:b': JSON.stringify([{ id: 'b1', role: 'assistant', text: 'Conversation B' }]),
    });

    const { rerender } = render(<Chorus persistenceKey="chat:a" persistenceStorage={storage} />);

    const composer = screen.getByRole('textbox', { name: /send a message/i });
    await user.type(composer, 'unsent draft for A');
    expect(composer).toHaveValue('unsent draft for A');

    rerender(<Chorus persistenceKey="chat:b" persistenceStorage={storage} />);

    expect(screen.getByRole('textbox', { name: /send a message/i })).toHaveValue('');
  });

  it('waits for an empty async persistence load before rendering and saving the seed', async () => {
    const pendingRead = deferred<string | null>();
    const welcome: Message[] = [{ id: 'welcome', role: 'assistant', text: 'Async welcome!' }];
    const asyncStorage: StorageAdapter = {
      getItem: vi.fn(() => pendingRead.promise),
      setItem: vi.fn(),
    };

    render(<Chorus persistenceKey="chat" persistenceStorage={asyncStorage} initialMessages={welcome} />);

    expect(screen.queryByText('Async welcome!')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /send a message/i })).toBeDisabled();
    expect(screen.getByPlaceholderText('Loading saved conversation…')).toBeInTheDocument();
    expect(asyncStorage.setItem).not.toHaveBeenCalled();

    await act(async () => {
      pendingRead.resolve(null);
      await pendingRead.promise;
    });

    expect(screen.getByText('Async welcome!')).toBeInTheDocument();
    await waitFor(() => expect(asyncStorage.setItem).toHaveBeenCalledWith('chat', JSON.stringify(welcome)));
  });

  it('keeps the initialMessages seed hidden while async persistence loads stored history', async () => {
    const pendingRead = deferred<string | null>();
    const stored: Message[] = [{ id: 'stored', role: 'assistant', text: 'Async stored history' }];
    const asyncStorage: StorageAdapter = {
      getItem: vi.fn(() => pendingRead.promise),
      setItem: vi.fn(),
    };

    render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={asyncStorage}
        initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Async welcome!' }]}
      />
    );

    expect(screen.queryByText('Async welcome!')).not.toBeInTheDocument();
    await act(async () => {
      pendingRead.resolve(JSON.stringify(stored));
      await pendingRead.promise;
    });

    expect(screen.getByText('Async stored history')).toBeInTheDocument();
    expect(screen.queryByText('Async welcome!')).not.toBeInTheDocument();
    expect(asyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('blocks sends while async persistence is still loading so stored transcripts are not clobbered', async () => {
    const ref = React.createRef<ChorusRef>();
    const pendingRead = deferred<string | null>();
    const stored: Message[] = [{ id: 'stored', role: 'assistant', text: 'Stored before send' }];
    const onSend = vi.fn<OnSend>(async () => ({ id: 'reply', role: 'assistant', text: 'reply' }));
    const asyncStorage: StorageAdapter = {
      getItem: vi.fn(() => pendingRead.promise),
      setItem: vi.fn(),
    };

    render(<Chorus ref={ref} persistenceKey="chat" persistenceStorage={asyncStorage} onSend={onSend} minAssistantDelayMs={0} />);

    expect(screen.getByRole('textbox', { name: /send a message/i })).toBeDisabled();
    act(() => ref.current?.send('pre-load send'));
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).not.toHaveBeenCalled();
    expect(asyncStorage.setItem).not.toHaveBeenCalled();
    expect(screen.queryByText('pre-load send')).not.toBeInTheDocument();

    await act(async () => {
      pendingRead.resolve(JSON.stringify(stored));
      await pendingRead.promise;
    });

    expect(screen.getByText('Stored before send')).toBeInTheDocument();
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

  it('surfaces persistence read failures through onPersistenceError', async () => {
    const onPersistenceError = vi.fn();
    const storage = makeSyncStorage({ chat: 'not json {{' });

    render(<Chorus persistenceKey="chat" persistenceStorage={storage} onPersistenceError={onPersistenceError} />);

    await waitFor(() => expect(onPersistenceError).toHaveBeenCalledWith(expect.objectContaining({
      key: 'chat',
      operation: 'deserialize',
    })));
    expect(screen.queryByRole('log')).toBeInTheDocument();
  });

  it('renders without crashing when persisted storage contains a malformed tool message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const onPersistenceError = vi.fn();
      // Corrupted tool message with no toolCall — pre-fix this would render a visible
      // tool row and crash ToolCallBlock when it dereferenced m.toolCall.
      const storage = makeSyncStorage({
        chat: JSON.stringify([
          { id: 'bad-tool', role: 'tool', text: '' },
          { id: 'good', role: 'user', text: 'after the bad one' },
        ]),
      });

      expect(() => render(
        <Chorus persistenceKey="chat" persistenceStorage={storage} onPersistenceError={onPersistenceError} />,
      )).not.toThrow();

      await waitFor(() => expect(screen.getByText('after the bad one')).toBeInTheDocument());
      expect(onPersistenceError).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Dropped 1 invalid persisted message'),
        expect.any(Array),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('does not read ignored built-in persistence in controlled mode', async () => {
    const onPersistenceError = vi.fn();
    const storage: StorageAdapter = {
      getItem: vi.fn(() => { throw new Error('blocked storage'); }),
      setItem: vi.fn(),
    };

    render(
      <Chorus
        value={[{ id: 'controlled', role: 'assistant', text: 'Controlled transcript' }]}
        onChange={vi.fn()}
        persistenceKey="chat"
        persistenceStorage={storage}
        onPersistenceError={onPersistenceError}
      />,
    );

    expect(screen.getByText('Controlled transcript')).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(onPersistenceError).not.toHaveBeenCalled();
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

    render(<Chorus persistenceKey="chat" persistenceStorage={storage} onPersistenceError={onPersistenceError} onSend={() => undefined} />);

    await user.type(screen.getByPlaceholderText('Send a message'), 'will persist');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(screen.getByText('will persist')).toBeInTheDocument();
    await waitFor(() => expect(onPersistenceError).toHaveBeenCalledWith(quotaError));
    expect(warn).toHaveBeenCalledWith('[Chorus] Failed to persist messages.', quotaError);
    warn.mockRestore();
  });

  it('persists the seed when resetToInitialMessages clears a persisted chat', async () => {
    const user = userEvent.setup();
    const storage = makeSyncStorage();
    storage.removeItem = vi.fn((key) => { delete storage.store[key]; });
    const welcome: Message[] = [{ id: 'welcome', role: 'assistant', text: 'persistent reset welcome' }];

    render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={storage}
        initialMessages={welcome}
        showClearButton
        resetToInitialMessages
      />,
    );

    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify(welcome)));
    await user.click(screen.getByRole('button', { name: /clear conversation/i }));

    expect(screen.getByText('persistent reset welcome')).toBeInTheDocument();
    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify(welcome)));
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('persists [] when clearing a seeded persisted chat with a removeItem-capable adapter', async () => {
    const user = userEvent.setup();
    const storage = makeSyncStorage();
    storage.removeItem = vi.fn((key) => { delete storage.store[key]; });
    const welcome: Message[] = [{ id: 'welcome', role: 'assistant', text: 'persistent welcome' }];
    const { unmount } = render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={storage}
        initialMessages={welcome}
        showClearButton
      />
    );

    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify(welcome)));
    await user.click(screen.getByRole('button', { name: /clear conversation/i }));

    await waitFor(() => expect(storage.store.chat).toBe(JSON.stringify([])));
    expect(storage.removeItem).not.toHaveBeenCalled();
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

  it('passes custom persistence serializer and deserializer hooks through Chorus', async () => {
    const user = userEvent.setup();
    const storage = makeSyncStorage({ chat: 'custom:read' });
    const serializeMessages = vi.fn(() => 'custom:write');
    const deserializeMessages = vi.fn(() => [{ id: 'stored', role: 'assistant', text: 'Stored custom' } as Message]);

    render(
      <Chorus
        persistenceKey="chat"
        persistenceStorage={storage}
        serializeMessages={serializeMessages}
        deserializeMessages={deserializeMessages}
        initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Welcome!' }]}
        onSend={() => undefined}
      />
    );

    expect(screen.getByText('Stored custom')).toBeInTheDocument();
    expect(deserializeMessages).toHaveBeenCalledWith('custom:read');

    await user.type(screen.getByPlaceholderText('Send a message'), 'new message');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(serializeMessages).toHaveBeenCalled());
    await waitFor(() => expect(storage.store.chat).toBe('custom:write'));
  });

  it('persists cleared conversations so initialMessages do not resurrect on reload when removeItem is unavailable', async () => {
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
