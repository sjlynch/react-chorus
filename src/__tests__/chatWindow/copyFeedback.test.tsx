import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ASST_MSG,
  ChatWindow,
  USER_MSG,
  type Message,
  type MessageFeedback,
} from './testUtils';

// Mock Markdown to avoid DOMPurify/highlight.js complexity in unit tests.
vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text, headless, streaming, sanitizer }: { text: string; headless?: boolean; streaming?: boolean; sanitizer?: unknown }) => (
    <span data-testid="markdown" data-headless={String(headless)} data-streaming={String(streaming)} data-sanitizer={String(Boolean(sanitizer))}>{text}</span>
  ),
}));

describe('ChatWindow copy and feedback actions', () => {
  it('renders copy and feedback actions when callbacks are provided', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const onFeedback = vi.fn();
    render(<ChatWindow messages={[ASST_MSG]} onCopy={onCopy} onFeedback={onFeedback} />);

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await user.click(screen.getByRole('button', { name: 'Thumbs up' }));
    expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute('aria-pressed', 'true');
    // Clicking the active thumb again toggles the rating off.
    await user.click(screen.getByRole('button', { name: 'Thumbs up' }));
    expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Thumbs down' }));

    expect(onCopy).toHaveBeenCalledWith(ASST_MSG);
    expect(onFeedback).toHaveBeenNthCalledWith(1, ASST_MSG, 'up');
    expect(onFeedback).toHaveBeenNthCalledWith(2, ASST_MSG, null);
    expect(onFeedback).toHaveBeenNthCalledWith(3, ASST_MSG, 'down');
    expect(onFeedback).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('button', { name: 'Thumbs down' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('clears seeded feedback when the active thumb is clicked again', async () => {
    type FeedbackMeta = { feedback?: MessageFeedback | null };
    const user = userEvent.setup();
    const onFeedback = vi.fn();
    const seeded: Message<FeedbackMeta> = { id: 'seeded', role: 'assistant', text: 'Seeded reply', metadata: { feedback: 'down' } };
    render(<ChatWindow messages={[seeded]} onFeedback={onFeedback} />);

    expect(screen.getByRole('button', { name: 'Thumbs down' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Thumbs down' }));

    expect(onFeedback).toHaveBeenCalledTimes(1);
    expect(onFeedback).toHaveBeenCalledWith(seeded, null);
    expect(screen.getByRole('button', { name: 'Thumbs down' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('seeds feedback from message metadata when action controls remount', () => {
    type FeedbackMeta = { feedback?: MessageFeedback | null };
    const onFeedback = vi.fn();
    const seeded: Message<FeedbackMeta> = { id: 'seeded', role: 'assistant', text: 'Seeded reply', metadata: { feedback: 'up' } };
    const later: Message<FeedbackMeta> = { id: 'later', role: 'assistant', text: 'Later reply' };
    const { rerender } = render(<ChatWindow messages={[seeded]} maxRenderedMessages={1} onFeedback={onFeedback} />);

    expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute('aria-pressed', 'true');

    rerender(<ChatWindow messages={[seeded, later]} maxRenderedMessages={1} onFeedback={onFeedback} />);
    expect(screen.queryByText('Seeded reply')).not.toBeInTheDocument();

    rerender(<ChatWindow messages={[seeded]} maxRenderedMessages={1} onFeedback={onFeedback} />);
    expect(screen.getByText('Seeded reply')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute('aria-pressed', 'true');
    expect(onFeedback).not.toHaveBeenCalled();
  });
  it('evicts a clicked feedback override when getMessageFeedback later changes it', async () => {
    const user = userEvent.setup();
    const onFeedback = vi.fn();
    const renderWith = (getMessageFeedback: (message: Message) => MessageFeedback | null) =>
      <ChatWindow messages={[ASST_MSG]} onFeedback={onFeedback} getMessageFeedback={getMessageFeedback} />;

    const { rerender } = render(renderWith(() => null));

    // User clicks thumbs up — the local override shadows host state.
    await user.click(screen.getByRole('button', { name: 'Thumbs up' }));
    expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute('aria-pressed', 'true');

    // The host persists a correction and reports the new feedback value.
    rerender(renderWith(() => 'down'));
    expect(screen.getByRole('button', { name: 'Thumbs down' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute('aria-pressed', 'false');

    // The host clears the feedback — the UI follows host state, not the override.
    rerender(renderWith(() => null));
    expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Thumbs down' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('evicts a clicked feedback override when message metadata feedback later changes', async () => {
    type FeedbackMeta = { feedback?: MessageFeedback | null };
    const user = userEvent.setup();
    const onFeedback = vi.fn();
    const base: Message<FeedbackMeta> = { id: 'a1', role: 'assistant', text: 'Hi there' };

    const { rerender } = render(<ChatWindow messages={[base]} onFeedback={onFeedback} />);

    await user.click(screen.getByRole('button', { name: 'Thumbs up' }));
    expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute('aria-pressed', 'true');

    // Host syncs a different persisted value for the same still-present message.
    rerender(<ChatWindow messages={[{ ...base, metadata: { feedback: 'down' } }]} onFeedback={onFeedback} />);
    expect(screen.getByRole('button', { name: 'Thumbs down' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('copies with navigator.clipboard by default when available', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    try {
      render(<ChatWindow messages={[ASST_MSG]} />);
      await user.click(screen.getByRole('button', { name: 'Copy' }));
      expect(writeText).toHaveBeenCalledWith('Hi there');
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
  it('shows failed feedback when the default message copy action rejects', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'));
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    try {
      render(<ChatWindow messages={[ASST_MSG]} />);
      const copyButton = screen.getByRole('button', { name: 'Copy' });

      fireEvent.click(copyButton);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenCalledWith('Hi there');
      expect(screen.getByRole('button', { name: 'Copy failed' })).toHaveTextContent('Copy failed');

      await act(async () => { await vi.advanceTimersByTimeAsync(1200); });

      expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
  it('shows failed feedback when a custom onCopy returns false', async () => {
    vi.useFakeTimers();
    const onCopy = vi.fn(() => false);

    try {
      render(<ChatWindow messages={[ASST_MSG]} onCopy={onCopy} />);

      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      await act(async () => { await Promise.resolve(); });

      expect(onCopy).toHaveBeenCalledWith(ASST_MSG);
      expect(screen.getByRole('button', { name: 'Copy failed' })).toHaveTextContent('Copy failed');

      await act(async () => { await vi.advanceTimersByTimeAsync(1200); });

      expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
  it('shows failed feedback when a custom onCopy promise rejects', async () => {
    vi.useFakeTimers();
    const onCopy = vi.fn().mockRejectedValue(new Error('custom copy failed'));

    try {
      render(<ChatWindow messages={[ASST_MSG]} onCopy={onCopy} />);

      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onCopy).toHaveBeenCalledWith(ASST_MSG);
      expect(screen.getByRole('button', { name: 'Copy failed' })).toHaveTextContent('Copy failed');

      await act(async () => { await vi.advanceTimersByTimeAsync(1200); });

      expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
  it('exposes copy and feedback through renderMessage actions', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const onFeedback = vi.fn();
    render(
      <ChatWindow
        messages={[ASST_MSG]}
        onCopy={onCopy}
        onFeedback={onFeedback}
        renderMessage={(_message, ctx) => (
          <div>
            <button type="button" onClick={ctx.actions.copy}>Custom copy</button>
            <button type="button" onClick={() => ctx.actions.feedback?.('down')}>Custom down</button>
          </div>
        )}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Custom copy' }));
    await user.click(screen.getByRole('button', { name: 'Custom down' }));
    await user.click(screen.getByRole('button', { name: 'Custom down' }));

    expect(onCopy).toHaveBeenCalledWith(ASST_MSG);
    expect(onFeedback).toHaveBeenCalledWith(ASST_MSG, 'down');
    expect(onFeedback).toHaveBeenCalledTimes(1);
  });
  it('renders recorded feedback as read-only thumbs when getMessageFeedback is set without onFeedback', () => {
    const getMessageFeedback = vi.fn((message: Message) => (message.id === 'a1' ? 'up' : null));
    render(<ChatWindow messages={[USER_MSG, ASST_MSG]} getMessageFeedback={getMessageFeedback} />);

    // The recorded reaction renders as an inert indicator, not a control.
    const thumb = screen.getByRole('img', { name: 'Thumbs up' });
    expect(thumb.tagName).toBe('SPAN');
    expect(thumb).toHaveClass('chorus-action-btn--readonly');
    // No interactive feedback buttons and no down-thumb for the unrated message.
    expect(screen.queryByRole('button', { name: 'Thumbs up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thumbs down' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Thumbs down' })).not.toBeInTheDocument();
  });
  it('keeps feedback interactive when both getMessageFeedback and onFeedback are provided', async () => {
    const user = userEvent.setup();
    const onFeedback = vi.fn();
    const getMessageFeedback = (message: Message) => (message.id === 'a1' ? 'up' : null);
    render(<ChatWindow messages={[ASST_MSG]} getMessageFeedback={getMessageFeedback} onFeedback={onFeedback} />);

    const thumbsUp = screen.getByRole('button', { name: 'Thumbs up' });
    expect(thumbsUp).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Thumbs down' }));
    expect(onFeedback).toHaveBeenCalledWith(ASST_MSG, 'down');
  });
});
