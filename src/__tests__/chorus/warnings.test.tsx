import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { sseResponse } from './testUtils';
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
});
