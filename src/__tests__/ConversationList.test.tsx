import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationList } from '../components/ConversationList';
import type { ConversationSummary } from '../hooks/useConversations';

const CONVERSATIONS: ConversationSummary[] = [
  { id: 'a', title: 'Support chat', createdAt: '2026-05-14T00:00:00.000Z', updatedAt: '2026-05-14T00:01:00.000Z' },
  { id: 'b', title: 'Roadmap ideas', createdAt: '2026-05-14T00:02:00.000Z', updatedAt: '2026-05-14T00:03:00.000Z' },
];

function renderedTitles(container: HTMLElement) {
  return Array.from(container.querySelectorAll('.chorus-conversation-title')).map(node => node.textContent?.trim());
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('ConversationList', () => {
  it('renders conversations by recency with active state, formatted timestamps, and actions', () => {
    const { container } = render(
      <ConversationList
        conversations={CONVERSATIONS}
        activeId="a"
        createConversation={vi.fn()}
        selectConversation={vi.fn()}
        renameConversation={vi.fn()}
        deleteConversation={vi.fn()}
        pinConversation={vi.fn()}
        formatTimestamp={(timestamp) => `formatted ${timestamp}`}
        palette={{ chatBg: '#101010', actionText: '#aaaaaa' }}
      />,
    );

    const items = screen.getAllByRole('listitem');
    expect(renderedTitles(container)).toEqual(['Roadmap ideas', 'Support chat']);
    expect(items).toHaveLength(2);
    expect(items[0]).not.toHaveAttribute('data-active');
    expect(items[1]).toHaveClass('chorus-conversation-item--active');
    expect(items[1]).toHaveAttribute('data-active', 'true');
    expect(within(items[1]).getByText('Support chat').closest('button')).toHaveAttribute('aria-current', 'true');

    const roadmap = within(items[0]);
    expect(roadmap.getByText('formatted 2026-05-14T00:03:00.000Z')).toHaveAttribute('dateTime', '2026-05-14T00:03:00.000Z');
    expect(roadmap.getByRole('button', { name: /pin roadmap ideas/i })).toHaveAttribute('aria-pressed', 'false');
    expect(roadmap.getByRole('button', { name: /rename roadmap ideas/i })).toBeInTheDocument();
    expect(roadmap.getByRole('button', { name: /delete roadmap ideas/i })).toBeInTheDocument();

    const support = within(items[1]);
    expect(support.getByText('formatted 2026-05-14T00:01:00.000Z')).toHaveAttribute('dateTime', '2026-05-14T00:01:00.000Z');
    expect(support.getByRole('button', { name: /pin support chat/i })).toHaveAttribute('aria-pressed', 'false');
    expect(support.getByRole('button', { name: /rename support chat/i })).toBeInTheDocument();
    expect(support.getByRole('button', { name: /delete support chat/i })).toBeInTheDocument();
  });

  it('applies the palette as --chorus-* variables on the root in both default and headless renders', () => {
    const { rerender } = render(
      <ConversationList conversations={CONVERSATIONS} palette={{ chatBg: '#101010' }} style={{ borderRadius: '4px' }} />,
    );
    let nav = screen.getByRole('navigation');
    expect(nav.style.getPropertyValue('--chorus-chat-bg')).toBe('#101010');
    expect(nav.style.borderRadius).toBe('4px');

    // A host-supplied palette is a theme, not default styling, so headless renders honor it too.
    rerender(<ConversationList conversations={CONVERSATIONS} palette={{ chatBg: '#202020' }} headless />);
    nav = screen.getByRole('navigation');
    expect(nav.style.getPropertyValue('--chorus-chat-bg')).toBe('#202020');
  });

  it('supports select, rename, delete, and create affordances', () => {
    const createConversation = vi.fn();
    const selectConversation = vi.fn();
    const renameConversation = vi.fn();
    const deleteConversation = vi.fn();
    const pinConversation = vi.fn();

    render(
      <ConversationList
        conversations={CONVERSATIONS}
        activeId="a"
        createConversation={createConversation}
        selectConversation={selectConversation}
        renameConversation={renameConversation}
        deleteConversation={deleteConversation}
        pinConversation={pinConversation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /new conversation/i }));
    expect(createConversation).toHaveBeenCalledOnce();

    const roadmapSelect = screen.getByText('Roadmap ideas').closest('button');
    expect(roadmapSelect).not.toBeNull();
    fireEvent.click(roadmapSelect!);
    expect(selectConversation).toHaveBeenCalledWith('b');

    fireEvent.click(screen.getByRole('button', { name: /rename support chat/i }));
    const input = screen.getByLabelText(/rename support chat/i);
    fireEvent.change(input, { target: { value: 'Renamed support' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(renameConversation).toHaveBeenCalledWith('a', 'Renamed support');

    fireEvent.click(screen.getByRole('button', { name: /pin support chat/i }));
    expect(pinConversation).toHaveBeenCalledWith('a', true);

    fireEvent.click(screen.getByRole('button', { name: /delete roadmap ideas/i }));
    expect(deleteConversation).toHaveBeenCalledWith('b');
  });

  it('cancels conversation delete when confirmDeleteConversation resolves false', async () => {
    const user = userEvent.setup();
    const pendingConfirmation = deferred<boolean>();
    const deleteConversation = vi.fn();
    const confirmDeleteConversation = vi.fn(() => pendingConfirmation.promise);

    render(
      <ConversationList
        conversations={CONVERSATIONS}
        activeId="a"
        deleteConversation={deleteConversation}
        confirmDeleteConversation={confirmDeleteConversation}
      />,
    );

    const deleteButton = screen.getByRole('button', { name: /delete roadmap ideas/i });
    await user.click(deleteButton);

    expect(confirmDeleteConversation).toHaveBeenCalledWith({
      conversation: expect.objectContaining({ id: 'b', title: 'Roadmap ideas' }),
      conversations: CONVERSATIONS,
      activeId: 'a',
    });
    expect(deleteButton).toBeDisabled();

    pendingConfirmation.resolve(false);

    await waitFor(() => expect(deleteButton).not.toBeDisabled());
    expect(deleteConversation).not.toHaveBeenCalled();
  });

  it('disables conversation actions while async storage is loading', async () => {
    const user = userEvent.setup();
    const createConversation = vi.fn();
    const selectConversation = vi.fn();
    const renameConversation = vi.fn();
    const deleteConversation = vi.fn();
    const pinConversation = vi.fn();

    render(
      <ConversationList
        conversations={CONVERSATIONS}
        loaded={false}
        createConversation={createConversation}
        selectConversation={selectConversation}
        renameConversation={renameConversation}
        deleteConversation={deleteConversation}
        pinConversation={pinConversation}
      />,
    );

    expect(screen.getByRole('button', { name: /new conversation/i })).toBeDisabled();
    expect(screen.getByText('Support chat').closest('button')).toBeDisabled();
    expect(screen.getByRole('button', { name: /rename support chat/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /pin support chat/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /delete support chat/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /new conversation/i }));
    expect(createConversation).not.toHaveBeenCalled();
    expect(selectConversation).not.toHaveBeenCalled();
    expect(renameConversation).not.toHaveBeenCalled();
    expect(deleteConversation).not.toHaveBeenCalled();
    expect(pinConversation).not.toHaveBeenCalled();
  });

  it('auto-focuses and selects the rename input when entering rename mode', () => {
    render(
      <ConversationList
        conversations={CONVERSATIONS}
        activeId="a"
        renameConversation={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /rename support chat/i }));
    const input = screen.getByLabelText(/rename support chat/i) as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('disables the Save button and skips renameConversation when the trimmed draft is empty', () => {
    const renameConversation = vi.fn();
    render(
      <ConversationList
        conversations={CONVERSATIONS}
        activeId="a"
        renameConversation={renameConversation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /rename support chat/i }));
    const input = screen.getByLabelText(/rename support chat/i);
    const saveButton = screen.getByRole('button', { name: /save/i });

    expect(saveButton).not.toBeDisabled();
    expect(input).not.toHaveAttribute('aria-invalid');

    fireEvent.change(input, { target: { value: '   ' } });
    expect(saveButton).toBeDisabled();
    expect(input).toHaveAttribute('aria-invalid', 'true');

    fireEvent.submit(input.closest('form')!);
    expect(renameConversation).not.toHaveBeenCalled();
    // Form remains in rename mode so user can correct the input.
    expect(screen.getByLabelText(/rename support chat/i)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Trimmed title' } });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);
    expect(renameConversation).toHaveBeenCalledWith('a', 'Trimmed title');
  });

  it('clears rename mode when the conversation disappears from the list underneath it', () => {
    const renameConversation = vi.fn();
    const { rerender } = render(
      <ConversationList
        conversations={CONVERSATIONS}
        activeId="a"
        renameConversation={renameConversation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /rename support chat/i }));
    expect(screen.getByLabelText(/rename support chat/i)).toBeInTheDocument();

    act(() => {
      rerender(
        <ConversationList
          conversations={CONVERSATIONS.filter(c => c.id !== 'a')}
          activeId={null}
          renameConversation={renameConversation}
        />,
      );
    });

    expect(screen.queryByLabelText(/rename support chat/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
    expect(renameConversation).not.toHaveBeenCalled();
  });

  it('renders pinned conversations first, toggles pinning, and formats timestamps', async () => {
    const user = userEvent.setup();
    const pinConversation = vi.fn();
    const pinnedConversations: ConversationSummary[] = [
      { id: 'old-pin', title: 'Pinned old', createdAt: '2026-05-14T00:00:00.000Z', updatedAt: '2026-05-14T00:02:00.000Z', pinned: true },
      { id: 'new-unpinned', title: 'Unpinned new', createdAt: '2026-05-14T00:00:00.000Z', updatedAt: '2026-05-14T00:05:00.000Z' },
      { id: 'new-pin', title: 'Pinned new', createdAt: '2026-05-14T00:00:00.000Z', updatedAt: '2026-05-14T00:04:00.000Z', pinned: true },
    ];

    const { container } = render(
      <ConversationList
        conversations={pinnedConversations}
        pinConversation={pinConversation}
        formatTimestamp={(timestamp, conversation) => `${conversation.title} at ${timestamp.slice(11, 16)}`}
      />,
    );

    expect(renderedTitles(container)).toEqual(['★Pinned new', '★Pinned old', 'Unpinned new']);
    expect(screen.getByText('Pinned new at 00:04')).toHaveAttribute('dateTime', '2026-05-14T00:04:00.000Z');

    await user.click(screen.getByRole('button', { name: /unpin pinned new/i }));
    expect(pinConversation).toHaveBeenCalledWith('new-pin', false);
  });

  it('stops Escape propagation in the rename input and restores focus to the row trigger on cancel', () => {
    const onParentKeyDown = vi.fn();
    render(
      <div onKeyDown={onParentKeyDown}>
        <ConversationList
          conversations={CONVERSATIONS}
          activeId="a"
          renameConversation={vi.fn()}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: /rename support chat/i }));
    const input = screen.getByLabelText(/rename support chat/i);
    fireEvent.keyDown(input, { key: 'Escape' });

    // Escape must not bubble out to an enclosing modal/dialog handler.
    expect(onParentKeyDown).not.toHaveBeenCalled();
    // Rename mode exited and focus landed back on the row trigger, not <body>.
    expect(screen.queryByRole('textbox', { name: /rename support chat/i })).toBeNull();
    expect(screen.getByRole('button', { name: /rename support chat/i })).toHaveFocus();
  });

  it('restores focus to the rename trigger after a successful rename submit', () => {
    const renameConversation = vi.fn();
    render(
      <ConversationList
        conversations={CONVERSATIONS}
        activeId="a"
        renameConversation={renameConversation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /rename support chat/i }));
    const input = screen.getByLabelText(/rename support chat/i);
    fireEvent.change(input, { target: { value: 'Renamed support' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(renameConversation).toHaveBeenCalledWith('a', 'Renamed support');
    expect(screen.getByRole('button', { name: /rename support chat/i })).toHaveFocus();
  });

  it('shows an inline validation message and enforces maxLength when submitting an empty rename draft', () => {
    const renameConversation = vi.fn();
    render(
      <ConversationList
        conversations={CONVERSATIONS}
        activeId="a"
        renameConversation={renameConversation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /rename support chat/i }));
    const input = screen.getByLabelText(/rename support chat/i) as HTMLInputElement;
    expect(input).toHaveAttribute('maxlength', '120');
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);

    expect(renameConversation).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/enter a name/i);
    expect(input).toHaveAttribute('aria-describedby', alert.id);
    // Focus stays in the input so the validation message is reachable.
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: 'Recovered title' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('blocks an over-long rename draft with an inline message and a disabled Save control', () => {
    const renameConversation = vi.fn();
    render(
      <ConversationList
        conversations={CONVERSATIONS}
        activeId="a"
        renameConversation={renameConversation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /rename support chat/i }));
    const input = screen.getByLabelText(/rename support chat/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'x'.repeat(200) } });

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/120 characters or fewer/i);

    fireEvent.submit(input.closest('form')!);
    expect(renameConversation).not.toHaveBeenCalled();
  });

  it('moves focus to a sibling row and announces the deletion when a conversation is deleted', () => {
    function Harness() {
      const [items, setItems] = React.useState(CONVERSATIONS);
      return (
        <ConversationList
          conversations={items}
          activeId="a"
          deleteConversation={id => setItems(prev => prev.filter(c => c.id !== id))}
        />
      );
    }
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: /delete roadmap ideas/i }));

    expect(screen.queryByText('Roadmap ideas')).toBeNull();
    // Focus moved to the surviving row instead of falling back to <body>.
    expect(screen.getByText('Support chat').closest('button')).toHaveFocus();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/deleted/i);
    expect(status).toHaveTextContent(/roadmap ideas/i);
  });

  it('moves focus to the list container when the last conversation is deleted', () => {
    function Harness() {
      const [items, setItems] = React.useState<ConversationSummary[]>([CONVERSATIONS[0]]);
      return (
        <ConversationList
          conversations={items}
          deleteConversation={id => setItems(prev => prev.filter(c => c.id !== id))}
        />
      );
    }
    const { container } = render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: /delete support chat/i }));

    expect(screen.queryByText('Support chat')).toBeNull();
    expect(container.querySelector('.chorus-conversation-items')).toHaveFocus();
  });
});
