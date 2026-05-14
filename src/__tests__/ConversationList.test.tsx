import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationList } from '../components/ConversationList';
import type { ConversationSummary } from '../hooks/useConversations';

const CONVERSATIONS: ConversationSummary[] = [
  { id: 'a', title: 'Support chat', createdAt: '2026-05-14T00:00:00.000Z', updatedAt: '2026-05-14T00:01:00.000Z' },
  { id: 'b', title: 'Roadmap ideas', createdAt: '2026-05-14T00:02:00.000Z', updatedAt: '2026-05-14T00:03:00.000Z' },
];

describe('ConversationList', () => {
  it('matches the rendered snapshot', () => {
    const { container } = render(
      <ConversationList
        conversations={CONVERSATIONS}
        activeId="a"
        createConversation={vi.fn()}
        selectConversation={vi.fn()}
        renameConversation={vi.fn()}
        deleteConversation={vi.fn()}
        palette={{ chatBg: '#101010', actionText: '#aaaaaa' }}
      />,
    );

    expect(container.firstChild).toMatchSnapshot();
  });

  it('supports select, rename, delete, and create affordances', async () => {
    const user = userEvent.setup();
    const createConversation = vi.fn();
    const selectConversation = vi.fn();
    const renameConversation = vi.fn();
    const deleteConversation = vi.fn();

    render(
      <ConversationList
        conversations={CONVERSATIONS}
        activeId="a"
        createConversation={createConversation}
        selectConversation={selectConversation}
        renameConversation={renameConversation}
        deleteConversation={deleteConversation}
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

    await user.click(screen.getByRole('button', { name: /delete roadmap ideas/i }));
    expect(deleteConversation).toHaveBeenCalledWith('b');
  });
});
