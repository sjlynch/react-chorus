import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { sendMessage, sseResponse } from './testUtils';
import type { ChorusProps, Message } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus', () => {
  it('warns in development when an update produces duplicate message IDs', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onSend = vi.fn<NonNullable<ChorusProps['onSend']>>(async () => undefined);

    render(<Chorus messages={[
      { id: 'dup', role: 'assistant', text: 'one' },
      { id: 'dup', role: 'assistant', text: 'two' },
    ]} onSend={onSend} minAssistantDelayMs={0} />);

    await sendMessage(user, 'hello');

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

  it('warns once at send time when neither transport nor onSend is provided without mutating the transcript', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<Chorus />);

    const textbox = screen.getByPlaceholderText('Send a message');
    await user.type(textbox, 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('`transport` nor `onSend`')));
    expect(warn.mock.calls.filter(call => String(call[0]).includes('`transport` nor `onSend`'))).toHaveLength(1);
    expect(screen.getByRole('log')).not.toHaveTextContent('hello');
    expect(textbox).toHaveValue('hello');
    warn.mockRestore();
  });

  it('warns when sending is provided with a transport', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(<Chorus transport={async () => sseResponse([])} sending={false} />);

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('`sending` was provided alongside `transport`')));
    warn.mockRestore();
  });

  it('warns about ignored transport-only props for transport={null} + onSend', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onSend = vi.fn<NonNullable<ChorusProps['onSend']>>(async () => undefined);

    // `transport={null}` is absent (isTransportPresent === false), so the real
    // send path is `onSend` and `onStreamDone` is genuinely ignored. Hosts hit
    // this via a conditionally-computed transport, e.g. `transport={url ?? null}`.
    const nullTransport = null as unknown as ChorusProps['transport'];
    render(<Chorus transport={nullTransport} onSend={onSend} onStreamDone={vi.fn()} />);

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('`onStreamDone` only fires on the `transport` send path')));
    warn.mockRestore();
  });

  it('warns when sending is provided with an empty-string transport', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // `transport=""` is still transport-present (a misconfigured URL), so it
    // owns the busy state and `sending` is redundant.
    render(<Chorus transport="" sending={false} />);

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('`sending` was provided alongside `transport`')));
    warn.mockRestore();
  });

  it('warns once when the initialMessages reference changes after mount', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    function Harness({ seed }: { seed: Message[] }) {
      return <Chorus initialMessages={seed} />;
    }

    const first: Message[] = [{ id: 'w1', role: 'assistant', text: 'Welcome (en)' }];
    const second: Message[] = [{ id: 'w1', role: 'assistant', text: 'Bienvenue (fr)' }];
    const third: Message[] = [{ id: 'w1', role: 'assistant', text: 'Willkommen (de)' }];

    const { rerender } = render(<Harness seed={first} />);
    rerender(<Harness seed={second} />);
    rerender(<Harness seed={third} />);

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('`initialMessages` array reference changed after mount')));
    const seedWarnings = warn.mock.calls.filter(call => String(call[0]).includes('array reference changed after mount'));
    expect(seedWarnings).toHaveLength(1);
    warn.mockRestore();
  });

  it('does not warn when the initialMessages reference is stable across renders', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const seed: Message[] = [{ id: 'w1', role: 'assistant', text: 'Welcome' }];
    function Harness() {
      return <Chorus initialMessages={seed} />;
    }

    const { rerender } = render(<Harness />);
    rerender(<Harness />);
    rerender(<Harness />);

    await waitFor(() => expect(screen.getByText('Welcome')).toBeInTheDocument());
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('array reference changed after mount'));
    warn.mockRestore();
  });

  it('keeps resetToInitialMessages on the frozen mount-time seed after an initialMessages reference change', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onSend = vi.fn<NonNullable<ChorusProps['onSend']>>(async () => ({ id: 'a1', role: 'assistant', text: 'reply' } as Message));

    const mountSeed: Message[] = [{ id: 'w-en', role: 'assistant', text: 'Welcome' }];
    const swappedSeed: Message[] = [{ id: 'w-fr', role: 'assistant', text: 'Bienvenue' }];

    function Harness({ seed }: { seed: Message[] }) {
      return (
        <Chorus
          initialMessages={seed}
          onSend={onSend}
          minAssistantDelayMs={0}
          showClearButton
          resetToInitialMessages
        />
      );
    }

    const { rerender } = render(<Harness seed={mountSeed} />);

    // Diverge the transcript from the seed.
    await sendMessage(user, 'question');
    expect(await screen.findByText('reply')).toBeInTheDocument();

    // Parent rebuilds initialMessages after mount (e.g. a locale switch).
    rerender(<Harness seed={swappedSeed} />);

    await user.click(screen.getByRole('button', { name: /clear conversation/i }));

    // Frozen-seed contract: clear restores the mount-time seed, not the swapped one.
    expect(screen.getByText('Welcome')).toBeInTheDocument();
    expect(screen.queryByText('Bienvenue')).not.toBeInTheDocument();
    expect(screen.queryByText('question')).not.toBeInTheDocument();
    expect(screen.queryByText('reply')).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`initialMessages` array reference changed after mount'));
    warn.mockRestore();
  });
});
