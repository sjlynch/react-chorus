import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ASST_MSG,
  ChatWindow,
  USER_MSG,
  type Message,
} from './testUtils';

// Mock Markdown to avoid DOMPurify/highlight.js complexity in unit tests.
vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text, headless, streaming, sanitizer }: { text: string; headless?: boolean; streaming?: boolean; sanitizer?: unknown }) => (
    <span data-testid="markdown" data-headless={String(headless)} data-streaming={String(streaming)} data-sanitizer={String(Boolean(sanitizer))}>{text}</span>
  ),
}));

describe('ChatWindow windowing and scroll behavior', () => {
  it('limits rendering to the latest visible message window while preserving typing and error rows', () => {
    const messages = Array.from({ length: 100 }, (_, i): Message => ({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: `Message ${i}`,
    }));

    const { container } = render(<ChatWindow messages={messages} maxRenderedMessages={5} typing error="Still accessible" />);

    expect(screen.getAllByTestId('markdown')).toHaveLength(5);
    expect(screen.queryByText('Message 94')).not.toBeInTheDocument();
    expect(screen.getByText('Message 95')).toBeInTheDocument();
    expect(screen.getByText('Message 99')).toBeInTheDocument();
    expect(screen.getByText(/assistant is typing/i)).toBeInTheDocument();
    expect(container.querySelector('.chorus-error')).toHaveTextContent('Still accessible');
  });
  it('keeps actions wired to original message ids when a render window is active', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const messages = Array.from({ length: 20 }, (_, i): Message => ({
      id: `m${i}`,
      role: 'assistant',
      text: `Windowed ${i}`,
    }));

    render(<ChatWindow messages={messages} maxRenderedMessages={1} onDelete={onDelete} />);

    expect(screen.queryByText('Windowed 18')).not.toBeInTheDocument();
    expect(screen.getByText('Windowed 19')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onDelete).toHaveBeenCalledWith('m19');
  });
  it('shows a jump-to-bottom button for unread activity after the user scrolls away', async () => {
    const user = userEvent.setup();
    const messages: Message[] = [USER_MSG, ASST_MSG];
    const { rerender } = render(<ChatWindow messages={messages} />);
    const transcript = screen.getByRole('log', { name: /chat transcript/i });

    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 200 });
    transcript.scrollTop = 0;
    fireEvent.scroll(transcript);

    expect(screen.queryByRole('button', { name: /jump to latest/i })).not.toBeInTheDocument();

    rerender(<ChatWindow messages={[...messages, { id: 'a2', role: 'assistant', text: 'Newest reply' }]} />);

    const jumpButton = await screen.findByRole('button', { name: /jump to latest/i });
    expect(jumpButton).toHaveClass('chorus-jump-to-bottom');

    await user.click(jumpButton);

    await waitFor(() => expect(screen.queryByRole('button', { name: /jump to latest/i })).not.toBeInTheDocument());
    expect(transcript.scrollTop).toBe(1000);
  });
  it('shows a jump-to-bottom button for scrolled-away reasoning deltas', async () => {
    const { rerender } = render(<ChatWindow messages={[{ ...ASST_MSG, reasoning: 'plan' }]} />);
    const transcript = screen.getByRole('log', { name: /chat transcript/i });

    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 200 });
    transcript.scrollTop = 0;
    fireEvent.scroll(transcript);

    rerender(<ChatWindow messages={[{ ...ASST_MSG, reasoning: 'plan more' }]} />);

    expect(await screen.findByRole('button', { name: /jump to latest/i })).toBeInTheDocument();
  });
  it('shows a jump-to-bottom button for scrolled-away tool-call input and output deltas', async () => {
    const toolStart: Message = { id: 'tool-stream', role: 'tool', text: '', toolCall: { id: 'call_1', name: 'search', input: '{"q":' } };
    const { rerender } = render(<ChatWindow messages={[toolStart]} hiddenRoles={['system']} />);
    const transcript = screen.getByRole('log', { name: /chat transcript/i });

    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 200 });
    transcript.scrollTop = 0;
    fireEvent.scroll(transcript);

    rerender(<ChatWindow messages={[{ ...toolStart, toolCall: { ...toolStart.toolCall!, input: { q: 'test' } } }]} hiddenRoles={['system']} />);
    expect(await screen.findByRole('button', { name: /jump to latest/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /jump to latest/i }));
    transcript.scrollTop = 0;
    fireEvent.scroll(transcript);
    rerender(<ChatWindow messages={[{ ...toolStart, toolCall: { ...toolStart.toolCall!, input: { q: 'test' }, output: 'results' } }]} hiddenRoles={['system']} />);

    expect(await screen.findByRole('button', { name: /jump to latest/i })).toBeInTheDocument();
  });
  it('keeps the view pinned near the bottom for reasoning and tool updates', () => {
    const { rerender } = render(<ChatWindow messages={[{ ...ASST_MSG, reasoning: 'plan' }]} hiddenRoles={['system']} />);
    const transcript = screen.getByRole('log', { name: /chat transcript/i });

    Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1000 });
    transcript.scrollTop = 760;
    fireEvent.scroll(transcript);

    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1200 });
    rerender(<ChatWindow messages={[{ ...ASST_MSG, reasoning: 'plan more' }]} hiddenRoles={['system']} />);
    expect(transcript.scrollTop).toBe(1200);

    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1400 });
    rerender(<ChatWindow messages={[{ id: 'tool-stream', role: 'tool', text: '', toolCall: { id: 'call_1', name: 'search', input: { q: 'test' } } }]} hiddenRoles={['system']} />);
    expect(transcript.scrollTop).toBe(1400);
  });
  it('re-pins to the bottom when the content height grows without an activityKey change', () => {
    const callbacks: ResizeObserverCallback[] = [];
    class StubResizeObserver {
      callback: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.callback = cb;
        callbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', StubResizeObserver);

    try {
      render(<ChatWindow messages={[ASST_MSG]} />);
      const transcript = screen.getByRole('log', { name: /chat transcript/i });

      Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 200 });
      Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1000 });
      transcript.scrollTop = 800;
      fireEvent.scroll(transcript);

      // Simulate a post-stream height bump (image load / lazy highlight pass).
      Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1500 });
      act(() => {
        for (const cb of callbacks) cb([], {} as ResizeObserver);
      });

      expect(transcript.scrollTop).toBe(1500);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('does not re-pin on content resize when the user has scrolled away', () => {
    const callbacks: ResizeObserverCallback[] = [];
    class StubResizeObserver {
      callback: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.callback = cb;
        callbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', StubResizeObserver);

    try {
      render(<ChatWindow messages={[ASST_MSG]} />);
      const transcript = screen.getByRole('log', { name: /chat transcript/i });

      Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 200 });
      Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1000 });
      transcript.scrollTop = 0;
      fireEvent.scroll(transcript);

      Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1500 });
      act(() => {
        for (const cb of callbacks) cb([], {} as ResizeObserver);
      });

      expect(transcript.scrollTop).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('pauses re-pinning after a small upward scroll within the 48px threshold', () => {
    const callbacks: ResizeObserverCallback[] = [];
    class StubResizeObserver {
      callback: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.callback = cb;
        callbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', StubResizeObserver);

    try {
      render(<ChatWindow messages={[ASST_MSG]} />);
      const transcript = screen.getByRole('log', { name: /chat transcript/i });

      Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 200 });
      Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1000 });

      // User sits at the bottom -> auto-scroll engaged.
      transcript.scrollTop = 800;
      fireEvent.scroll(transcript);

      // A small (20px) upward nudge keeps the user well within the 48px
      // threshold, but it must still pause pinning immediately.
      transcript.scrollTop = 780;
      fireEvent.scroll(transcript);

      // Streaming grows the content and fires a resize callback.
      Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1500 });
      act(() => {
        for (const cb of callbacks) cb([], {} as ResizeObserver);
      });

      // The repin is suppressed: the user keeps their scrolled-up position
      // instead of being yanked back to the bottom.
      expect(transcript.scrollTop).toBe(780);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('re-arms auto-scroll when a downward scroll lands back near the bottom', () => {
    const callbacks: ResizeObserverCallback[] = [];
    class StubResizeObserver {
      callback: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.callback = cb;
        callbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', StubResizeObserver);

    try {
      render(<ChatWindow messages={[ASST_MSG]} />);
      const transcript = screen.getByRole('log', { name: /chat transcript/i });

      Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 200 });
      Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1000 });

      transcript.scrollTop = 800;
      fireEvent.scroll(transcript);

      // A small upward nudge pauses auto-scroll.
      transcript.scrollTop = 780;
      fireEvent.scroll(transcript);

      // Scrolling back down to within 48px of the bottom re-arms it.
      transcript.scrollTop = 800;
      fireEvent.scroll(transcript);

      Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1500 });
      act(() => {
        for (const cb of callbacks) cb([], {} as ResizeObserver);
      });

      expect(transcript.scrollTop).toBe(1500);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('treats the scroll event echoed by an auto-pin as programmatic, not a user scroll-away', () => {
    const { rerender } = render(<ChatWindow messages={[ASST_MSG]} />);
    const transcript = screen.getByRole('log', { name: /chat transcript/i });

    Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1000 });
    transcript.scrollTop = 1000;
    fireEvent.scroll(transcript); // user sits at the bottom -> auto-scroll engaged

    // A streamed chunk grows the transcript; the layout effect pins to the new
    // bottom, which is a programmatic scroll.
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1400 });
    rerender(<ChatWindow messages={[{ ...ASST_MSG, text: 'streamed chunk' }]} />);
    expect(transcript.scrollTop).toBe(1400);

    // The browser then echoes a scroll event for that pin. Even if it reports a
    // stale, scrolled-up position, it must not be read as the user leaving.
    transcript.scrollTop = 0;
    fireEvent.scroll(transcript);

    // The next chunk should still auto-pin (no jump-to-bottom button), proving
    // the echoed event did not pause auto-scroll.
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 1800 });
    rerender(<ChatWindow messages={[{ ...ASST_MSG, text: 'streamed chunk two' }]} />);
    expect(transcript.scrollTop).toBe(1800);
    expect(screen.queryByRole('button', { name: /jump to latest/i })).not.toBeInTheDocument();
  });
});
