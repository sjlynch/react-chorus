import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

  it('supports select, rename, delete, and create affordances', async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole('button', { name: /new conversation/i }));
    expect(createConversation).toHaveBeenCalledOnce();

    const roadmapSelect = screen.getByText('Roadmap ideas').closest('button');
    expect(roadmapSelect).not.toBeNull();
    await user.click(roadmapSelect!);
    expect(selectConversation).toHaveBeenCalledWith('b');

    await user.click(screen.getByRole('button', { name: /rename support chat/i }));
    const input = screen.getByLabelText(/rename support chat/i);
    await user.clear(input);
    await user.type(input, 'Renamed support');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(renameConversation).toHaveBeenCalledWith('a', 'Renamed support');

    await user.click(screen.getByRole('button', { name: /pin support chat/i }));
    expect(pinConversation).toHaveBeenCalledWith('a', true);

    await user.click(screen.getByRole('button', { name: /delete roadmap ideas/i }));
    expect(deleteConversation).toHaveBeenCalledWith('b');
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
});
