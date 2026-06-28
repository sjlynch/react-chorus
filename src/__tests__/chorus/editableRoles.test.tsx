import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import type { Message } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus editableRoles', () => {
  it('by default exposes the inline edit action only on user messages', () => {
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'a question' },
      { id: 'a1', role: 'assistant', text: 'an answer' },
    ];
    render(<Chorus messages={initial} onSend={vi.fn()} />);
    // Only the user row carries an Edit button; the assistant bubble does not.
    expect(screen.getAllByTitle('Edit')).toHaveLength(1);
  });

  it('opts assistant bubbles into the edit action when editableRoles includes assistant', () => {
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'a question' },
      { id: 'a1', role: 'assistant', text: 'an answer' },
    ];
    render(<Chorus messages={initial} editableRoles={['user', 'assistant']} onSend={vi.fn()} />);
    expect(screen.getAllByTitle('Edit')).toHaveLength(2);
  });

  it('editing an assistant bubble updates it in place without truncating or re-sending', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'keep me' },
      { id: 'a1', role: 'assistant', text: 'old answer' },
      { id: 'u2', role: 'user', text: 'and me' },
    ];
    const onSend = vi.fn(() => new Promise<void>(() => undefined));
    const onMessagesChange = vi.fn<(messages: Message[]) => void>();

    render(
      <Chorus
        messages={initial}
        editableRoles={['user', 'assistant']}
        onSend={onSend}
        onMessagesChange={onMessagesChange}
      />,
    );

    // Edit the assistant row (Edit buttons are in DOM order: u1, a1, u2).
    await user.click(screen.getAllByTitle('Edit')[1]);
    const editBox = screen.getByDisplayValue('old answer');
    await user.clear(editBox);
    await user.type(editBox, 'corrected answer');
    await user.click(screen.getByTitle('Save'));

    // In place: the text changes, nothing after it is truncated, and no
    // regeneration is dispatched (onSend must not fire for a non-user edit).
    expect(screen.getByText('corrected answer')).toBeInTheDocument();
    expect(screen.queryByText('old answer')).not.toBeInTheDocument();
    expect(screen.getByText('keep me')).toBeInTheDocument();
    expect(screen.getByText('and me')).toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();

    // The transcript observer (persistence handoff) sees the in-place edit.
    await waitFor(() => expect(onMessagesChange).toHaveBeenCalled());
    const latest = onMessagesChange.mock.calls[onMessagesChange.mock.calls.length - 1][0];
    expect(latest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'a1', role: 'assistant', text: 'corrected answer' }),
        expect.objectContaining({ id: 'u2', role: 'user', text: 'and me' }),
      ]),
    );
  });

  it('keeps edit-and-resend for user messages even when assistant editing is enabled', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'original' },
      { id: 'a1', role: 'assistant', text: 'first answer' },
    ];
    const onSend = vi.fn(() => new Promise<void>(() => undefined));

    render(<Chorus messages={initial} editableRoles={['user', 'assistant']} onSend={onSend} />);

    // Edit the user row (first Edit button) — this must still truncate + resend.
    await user.click(screen.getAllByTitle('Edit')[0]);
    const editBox = screen.getByDisplayValue('original');
    await user.clear(editBox);
    await user.type(editBox, 'edited');
    await user.click(screen.getByTitle('Save'));

    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith('edited', expect.any(Array), expect.any(Object)),
    );
    expect(screen.getByText('edited')).toBeInTheDocument();
    expect(screen.queryByText('first answer')).not.toBeInTheDocument();
  });
});
