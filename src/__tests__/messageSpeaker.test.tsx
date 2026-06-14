import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MessageBubble, MessageRow, MessageSpeakerBadge, resolveMessageSpeakerLabel } from '../components/MessageRow';
import type { Message, MessageSpeaker } from '../types';

vi.mock('../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

const CAPTAIN: MessageSpeaker = {
  id: 'captain-hook',
  name: 'Captain Hook',
  avatarUrl: 'https://example.com/hook.png',
};

const ASSISTANT_MSG: Message = {
  id: 'a1',
  role: 'assistant',
  text: 'Ahoy!',
  speaker: CAPTAIN,
};

const ASSISTANT_NO_SPEAKER: Message = {
  id: 'a2',
  role: 'assistant',
  text: 'Hello',
};

describe('MessageBubble speaker rendering', () => {
  it('renders the speaker name above the bubble when message.speaker is set', () => {
    const { container } = render(<MessageBubble message={ASSISTANT_MSG} />);
    const badge = container.querySelector('.chorus-msg-speaker');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('data-chorus-speaker-id', 'captain-hook');
    // The name appears in both the SR-only label and the visible badge.
    const name = container.querySelector('.chorus-speaker-name');
    expect(name).toHaveTextContent('Captain Hook');
  });

  it('omits the visible badge when message.speaker is missing', () => {
    const { container } = render(<MessageBubble message={ASSISTANT_NO_SPEAKER} />);
    expect(container.querySelector('.chorus-msg-speaker')).not.toBeInTheDocument();
  });

  it('does not render an avatar img until showSpeakerAvatars is true', () => {
    const { container, rerender } = render(<MessageBubble message={ASSISTANT_MSG} />);
    expect(container.querySelector('.chorus-speaker-avatar')).not.toBeInTheDocument();
    rerender(<MessageBubble message={ASSISTANT_MSG} showSpeakerAvatars />);
    const img = container.querySelector('img.chorus-speaker-avatar');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/hook.png');
  });

  it('hides the visible badge from screen readers (the SR-only label is the authoritative announcement)', () => {
    const { container } = render(<MessageBubble message={ASSISTANT_MSG} />);
    const badge = container.querySelector('.chorus-msg-speaker');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses the speaker name as the screen-reader label when present', () => {
    const { container } = render(<MessageBubble message={ASSISTANT_MSG} />);
    const sr = container.querySelector('.chorus-sr-only');
    expect(sr).toHaveTextContent('Captain Hook');
  });

  it('falls back to the role label in the SR announcement when the speaker has no name', () => {
    const noName: Message = { ...ASSISTANT_NO_SPEAKER };
    const { container } = render(<MessageBubble message={noName} />);
    const sr = container.querySelector('.chorus-sr-only');
    expect(sr).toHaveTextContent('Assistant message');
  });
});

describe('MessageRow speaker rendering', () => {
  it('threads message.speaker into both the SR label and the visible badge', () => {
    const { container } = render(<MessageRow m={ASSISTANT_MSG} codeTheme="dark" showSpeakerAvatars />);
    expect(container.querySelector('.chorus-sr-only')).toHaveTextContent('Captain Hook');
    expect(container.querySelector('img.chorus-speaker-avatar')).toHaveAttribute('src', 'https://example.com/hook.png');
  });
});

describe('MessageSpeakerBadge', () => {
  it('renders only the name when showAvatar is false', () => {
    const { container } = render(<MessageSpeakerBadge speaker={CAPTAIN} />);
    expect(container.querySelector('.chorus-speaker-name')).toHaveTextContent('Captain Hook');
    expect(container.querySelector('img.chorus-speaker-avatar')).not.toBeInTheDocument();
  });

  it('returns null when no avatar URL and no name', () => {
    const empty: MessageSpeaker = { id: 'x', name: '' };
    const { container } = render(<MessageSpeakerBadge speaker={empty} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('resolveMessageSpeakerLabel', () => {
  it('returns the speaker name when present and trimmed', () => {
    const label = resolveMessageSpeakerLabel({ role: 'assistant', speaker: { id: 'a', name: '  Smee  ' } });
    expect(label).toBe('Smee');
  });

  it('falls back to the role label when speaker is missing', () => {
    expect(resolveMessageSpeakerLabel({ role: 'user' })).toBe('User message');
  });
});
