import { createRef } from 'react';
import type React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ASST_MSG,
  ChatWindow,
  SYS_MSG,
  TOOL_MSG,
  USER_MSG,
  containsLoneSurrogate,
  stringActivityKey,
  type Message,
} from './testUtils';

// Mock Markdown to avoid DOMPurify/highlight.js complexity in unit tests.
vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text, headless, streaming, sanitizer }: { text: string; headless?: boolean; streaming?: boolean; sanitizer?: unknown }) => (
    <span data-testid="markdown" data-headless={String(headless)} data-streaming={String(streaming)} data-sanitizer={String(Boolean(sanitizer))}>{text}</span>
  ),
}));

describe('ChatWindow rendering behavior', () => {
  it('renders user and assistant messages', () => {
    render(<ChatWindow messages={[USER_MSG, ASST_MSG]} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });
  it('forwards root refs and HTML attributes', () => {
    const ref = createRef<HTMLDivElement>();
    render(<ChatWindow ref={ref} messages={[USER_MSG]} id="transcript" data-testid="chat-window" />);

    const transcript = screen.getByTestId('chat-window');
    expect(ref.current).toBe(transcript);
    expect(transcript).toHaveAttribute('id', 'transcript');
  });
  it('applies the palette as --chorus-* variables on the root and merges an explicit style', () => {
    render(
      <ChatWindow
        messages={[USER_MSG]}
        data-testid="chat-window"
        palette={{ chatBg: '#101010', assistantText: '#fafafa' }}
        style={{ borderRadius: '4px' }}
      />,
    );

    const transcript = screen.getByTestId('chat-window');
    expect(transcript.style.getPropertyValue('--chorus-chat-bg')).toBe('#101010');
    expect(transcript.style.getPropertyValue('--chorus-assistant-text')).toBe('#fafafa');
    // Unset palette keys emit no variable so an ancestor theme can still cascade in.
    expect(transcript.style.getPropertyValue('--chorus-user-bg')).toBe('');
    expect(transcript.style.borderRadius).toBe('4px');
  });
  it('adds the chorus-window--headless hook class only in headless mode', () => {
    const { rerender } = render(<ChatWindow messages={[USER_MSG]} data-testid="chat-window" />);
    expect(screen.getByTestId('chat-window')).not.toHaveClass('chorus-window--headless');

    rerender(<ChatWindow messages={[USER_MSG]} data-testid="chat-window" headless />);
    expect(screen.getByTestId('chat-window')).toHaveClass('chorus-window--headless');
  });
  it('builds activity keys for trailing emoji without lone surrogates', () => {
    const value = `${'x'.repeat(23)}\u{1F44B}`;
    const key = stringActivityKey(value);

    expect(key).toContain('\u{1F44B}');
    expect(containsLoneSurrogate(key)).toBe(false);
  });
  it('changes activity keys for same-length middle edits in long strings', () => {
    const head = 'h'.repeat(24);
    const tail = 't'.repeat(24);
    const original = `${head}${'a'.repeat(52)}${tail}`;
    const edited = `${head}${'b'.repeat(52)}${tail}`;

    expect(edited).toHaveLength(original.length);
    expect(Array.from(edited).slice(0, 24).join('')).toBe(Array.from(original).slice(0, 24).join(''));
    expect(Array.from(edited).slice(-24).join('')).toBe(Array.from(original).slice(-24).join(''));
    expect(stringActivityKey(edited)).not.toBe(stringActivityKey(original));
  });
  it('exposes the transcript as the single polite live log region', () => {
    render(<ChatWindow messages={[USER_MSG, ASST_MSG]} typing error="boom" />);
    const transcript = screen.getByRole('log', { name: /chat transcript/i });
    expect(transcript).toHaveAttribute('aria-live', 'polite');
    // aria-atomic=false keeps streaming additions incremental rather than
    // re-announcing the whole transcript per chunk.
    expect(transcript).toHaveAttribute('aria-atomic', 'false');
    expect(transcript).toHaveClass('chorus-window');
    // No nested live regions: typing/error rows must not wrap their own.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('hides system and tool messages by default', () => {
    render(<ChatWindow messages={[SYS_MSG, TOOL_MSG, USER_MSG]} />);
    expect(screen.queryByText('You are helpful.')).not.toBeInTheDocument();
    expect(screen.queryByText('search')).not.toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
  it('shows system and tool messages when deprecated showSystemMessages=true', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<ChatWindow messages={[SYS_MSG, TOOL_MSG, USER_MSG]} showSystemMessages />);
    expect(screen.getByText('You are helpful.')).toBeInTheDocument();
    expect(screen.getByText('search')).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('showSystemMessages'));
    warn.mockRestore();
  });
  it('allows tool messages while hiding system messages with hiddenRoles', () => {
    render(<ChatWindow messages={[SYS_MSG, TOOL_MSG, USER_MSG]} hiddenRoles={['system']} />);
    expect(screen.queryByText('You are helpful.')).not.toBeInTheDocument();
    expect(screen.getByText('search')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
  it('shows all roles when hiddenRoles is empty', () => {
    render(<ChatWindow messages={[SYS_MSG, TOOL_MSG, USER_MSG]} hiddenRoles={[]} />);
    expect(screen.getByText('You are helpful.')).toBeInTheDocument();
    expect(screen.getByText('search')).toBeInTheDocument();
  });
  it('renders the typing indicator when typing=true', () => {
    const { container } = render(<ChatWindow messages={[]} typing />);
    expect(container.querySelector('.chorus-typing')).toBeInTheDocument();
    // The typing label is SR-only text announced by the transcript live
    // region (the row no longer carries its own role="status").
    expect(screen.getByText(/assistant is typing/i)).toHaveClass('chorus-sr-only');
  });
  it('does not render the typing indicator when typing=false', () => {
    const { container } = render(<ChatWindow messages={[]} typing={false} />);
    expect(container.querySelector('.chorus-typing')).not.toBeInTheDocument();
  });
  it('renders a custom empty state only while the visible transcript is empty', () => {
    const { rerender } = render(<ChatWindow messages={[]} emptyState={<p>Ask Chorus anything</p>} />);

    expect(screen.getByText('Ask Chorus anything')).toBeInTheDocument();

    rerender(<ChatWindow messages={[SYS_MSG]} emptyState={<p>Ask Chorus anything</p>} />);

    expect(screen.getByText('Ask Chorus anything')).toBeInTheDocument();
    expect(screen.queryByText('You are helpful.')).not.toBeInTheDocument();

    rerender(<ChatWindow messages={[USER_MSG]} emptyState={<p>Ask Chorus anything</p>} />);

    expect(screen.queryByText('Ask Chorus anything')).not.toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
  it('renders suggested prompts as the default empty state and hides them once a message exists', async () => {
    const user = userEvent.setup();
    const onSuggestedPrompt = vi.fn();
    const { rerender } = render(
      <ChatWindow messages={[]} suggestedPrompts={['Summarize this', 'Write tests']} onSuggestedPrompt={onSuggestedPrompt} />
    );

    await user.click(screen.getByRole('button', { name: 'Summarize this' }));

    expect(onSuggestedPrompt).toHaveBeenCalledWith('Summarize this');

    rerender(<ChatWindow messages={[USER_MSG]} suggestedPrompts={['Summarize this', 'Write tests']} />);

    expect(screen.queryByRole('button', { name: 'Summarize this' })).not.toBeInTheDocument();
  });
  it('exposes the suggested prompts as a labeled group', () => {
    render(<ChatWindow messages={[]} suggestedPrompts={['One', 'Two']} onSuggestedPrompt={vi.fn()} />);

    const group = screen.getByRole('group', { name: 'Suggested prompts' });
    expect(group).toHaveClass('chorus-suggested-prompts');
  });
  it('renders repeated prompt strings without duplicate-key warnings', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<ChatWindow messages={[]} suggestedPrompts={['Repeat', 'Repeat']} onSuggestedPrompt={vi.fn()} />);

    expect(screen.getAllByRole('button', { name: 'Repeat' })).toHaveLength(2);
    expect(errorSpy.mock.calls.some(args => String(args[0]).includes('same key'))).toBe(false);
    errorSpy.mockRestore();
  });
  it('routes focus to the transcript when activating a prompt unmounts the empty state', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ChatWindow messages={[]} suggestedPrompts={['Go']} onSuggestedPrompt={vi.fn()} />,
    );

    const button = screen.getByRole('button', { name: 'Go' });
    await user.click(button);
    expect(button).toHaveFocus();

    rerender(<ChatWindow messages={[USER_MSG]} suggestedPrompts={['Go']} />);

    expect(screen.getByRole('log')).toHaveFocus();
  });
  it('routes focus to the composer input when the empty state unmounts', async () => {
    const user = userEvent.setup();
    function Harness({ messages }: { messages: Message[] }) {
      return (
        <div className="chorus">
          <ChatWindow messages={messages} suggestedPrompts={['Go']} onSuggestedPrompt={vi.fn()} />
          <div className="chorus-input"><textarea aria-label="composer" /></div>
        </div>
      );
    }

    const { rerender } = render(<Harness messages={[]} />);
    await user.click(screen.getByRole('button', { name: 'Go' }));

    rerender(<Harness messages={[USER_MSG]} />);

    expect(screen.getByRole('textbox', { name: 'composer' })).toHaveFocus();
  });
  it('renders an error message when error is provided', () => {
    const { container } = render(<ChatWindow messages={[]} error="Network error" />);
    expect(container.querySelector('.chorus-error')).toHaveTextContent('Network error');
  });
  it('renders errors alongside an active empty state', () => {
    const { container } = render(<ChatWindow messages={[]} emptyState={<p>Empty welcome</p>} error="Network error" />);

    expect(screen.getByText('Empty welcome')).toBeInTheDocument();
    expect(container.querySelector('.chorus-error')).toHaveTextContent('Network error');
  });
  it('shows a retry button when onRetry is provided alongside an error', () => {
    render(<ChatWindow messages={[]} error="Oops" onRetry={vi.fn()} />);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
  it('calls onRetry when retry button is clicked', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ChatWindow messages={[]} error="Oops" onRetry={onRetry} />);
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
  it('retry button does not submit an enclosing form', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<form onSubmit={onSubmit}><ChatWindow messages={[]} error="Oops" onRetry={onRetry} /></form>);

    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it('does not show retry button when error is present but onRetry is absent', () => {
    render(<ChatWindow messages={[]} error="Oops" />);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
  it('shows a dismiss button when onDismissError is provided alongside an error', () => {
    render(<ChatWindow messages={[]} error="Oops" onDismissError={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Dismiss error' })).toBeInTheDocument();
  });
  it('calls onDismissError when the dismiss button is clicked', async () => {
    const user = userEvent.setup();
    const onDismissError = vi.fn();
    render(<ChatWindow messages={[]} error="Oops" onDismissError={onDismissError} />);
    await user.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(onDismissError).toHaveBeenCalledOnce();
  });
  it('does not show dismiss button when error is present but onDismissError is absent', () => {
    render(<ChatWindow messages={[]} error="Oops" />);
    expect(screen.queryByRole('button', { name: 'Dismiss error' })).not.toBeInTheDocument();
  });
  it('dismiss button does not submit an enclosing form', async () => {
    const user = userEvent.setup();
    const onDismissError = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<form onSubmit={onSubmit}><ChatWindow messages={[]} error="Oops" onDismissError={onDismissError} /></form>);

    await user.click(screen.getByRole('button', { name: 'Dismiss error' }));

    expect(onDismissError).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it('localizes the dismiss button label via the labels prop', () => {
    render(
      <ChatWindow
        messages={[]}
        error="Oops"
        onDismissError={vi.fn()}
        labels={{ transcript: { dismissError: "Masquer l'erreur" } }}
      />,
    );
    expect(screen.getByRole('button', { name: "Masquer l'erreur" })).toBeInTheDocument();
  });
  it('renders reasoning in a collapsed details block above the message bubble', () => {
    render(<ChatWindow messages={[{ ...ASST_MSG, reasoning: 'private plan' }]} />);
    const summary = screen.getByText('Reasoning');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('private plan')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });
  it('suppresses an empty bubble for a reasoning-only assistant message', () => {
    const { container } = render(<ChatWindow messages={[{ id: 'r1', role: 'assistant', text: '', reasoning: 'thinking only' }]} />);

    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('thinking only')).toBeInTheDocument();
    expect(container.querySelector('.chorus-assistant .chorus-bubble')).not.toBeInTheDocument();
  });
  it('does not render a reasoning disclosure on a user message carrying a reasoning field', () => {
    const { container } = render(<ChatWindow messages={[{ id: 'u-reasoning', role: 'user', text: 'Hello', reasoning: 'sneaky plan' }]} />);

    expect(screen.queryByText('Reasoning')).not.toBeInTheDocument();
    expect(screen.queryByText('sneaky plan')).not.toBeInTheDocument();
    expect(container.querySelector('.chorus-reasoning')).not.toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
  it('does not render a reasoning disclosure on a system message carrying a reasoning field', () => {
    const { container } = render(
      <ChatWindow hiddenRoles={[]} messages={[{ id: 's-reasoning', role: 'system', text: 'Be concise.', reasoning: 'system-only plan' }]} />
    );

    expect(screen.queryByText('Reasoning')).not.toBeInTheDocument();
    expect(screen.queryByText('system-only plan')).not.toBeInTheDocument();
    expect(container.querySelector('.chorus-reasoning')).not.toBeInTheDocument();
  });
  it('still renders the reasoning disclosure on an assistant message', () => {
    const { container } = render(<ChatWindow messages={[{ ...ASST_MSG, reasoning: 'assistant plan' }]} />);

    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.getByText('assistant plan')).toBeInTheDocument();
    expect(container.querySelector('.chorus-reasoning')).toBeInTheDocument();
  });
  it('opens the reasoning disclosure for a reasoning-only streaming turn', () => {
    render(
      <ChatWindow
        streamingMessageId="r-stream"
        messages={[{ id: 'r-stream', role: 'assistant', text: '', reasoning: 'streaming thoughts' }]}
      />
    );

    // A reasoning-first model streams chain-of-thought before any answer text;
    // the disclosure must be open so the trace is visible instead of frozen.
    expect(screen.getByText('Reasoning').closest('details')).toHaveAttribute('open');
  });
  it('leaves the reasoning disclosure collapsed once streamed answer text arrives', () => {
    render(
      <ChatWindow
        streamingMessageId="r-answer"
        messages={[{ id: 'r-answer', role: 'assistant', text: 'Here is the answer', reasoning: 'streaming thoughts' }]}
      />
    );

    expect(screen.getByText('Reasoning').closest('details')).not.toHaveAttribute('open');
  });
  it('leaves the reasoning disclosure collapsed on a settled (non-streaming) message', () => {
    render(<ChatWindow messages={[{ id: 'r-done', role: 'assistant', text: '', reasoning: 'finished thoughts' }]} />);

    expect(screen.getByText('Reasoning').closest('details')).not.toHaveAttribute('open');
  });
  it('renders a per-message timestamp when showTimestamps is set', () => {
    const { container } = render(<ChatWindow showTimestamps messages={[{ ...USER_MSG, createdAt: '2026-05-20T15:47:06.425Z' }]} />);

    const time = container.querySelector('time.chorus-msg-time');
    expect(time).toBeInTheDocument();
    expect(time).toHaveAttribute('datetime', '2026-05-20T15:47:06.425Z');
    expect(time?.textContent?.trim()).not.toBe('');
  });
  it('does not render per-message timestamps by default', () => {
    const { container } = render(<ChatWindow messages={[{ ...USER_MSG, createdAt: '2026-05-20T15:47:06.425Z' }]} />);

    expect(container.querySelector('.chorus-msg-time')).not.toBeInTheDocument();
  });
  it('omits the timestamp for a message with no createdAt even when showTimestamps is set', () => {
    const { container } = render(<ChatWindow showTimestamps messages={[USER_MSG]} />);

    expect(container.querySelector('.chorus-msg-time')).not.toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
  it('uses a custom formatTimestamp override with the message in context', () => {
    const formatTimestamp = vi.fn((_timestamp: string, message: Message) => `sent by ${message.role}`);
    render(<ChatWindow showTimestamps formatTimestamp={formatTimestamp} messages={[{ ...USER_MSG, createdAt: '2026-05-20T15:47:06.425Z' }]} />);

    expect(formatTimestamp).toHaveBeenCalledWith('2026-05-20T15:47:06.425Z', expect.objectContaining({ id: 'u1', role: 'user' }));
    expect(screen.getByText('sent by user')).toBeInTheDocument();
  });
  it('echoes an unparseable createdAt string through the default timestamp formatter', () => {
    render(<ChatWindow showTimestamps messages={[{ ...USER_MSG, createdAt: 'definitely-not-a-date' }]} />);

    expect(screen.getByText('definitely-not-a-date')).toBeInTheDocument();
  });
  it('preserves a bubble for attachment-only user messages', () => {
    const { container } = render(<ChatWindow messages={[{
      id: 'u-attachment',
      role: 'user',
      text: '',
      attachments: [{ name: 'photo.png', type: 'image/png', data: 'data:image/png;base64,abc', size: 3 }],
    }]} />);

    expect(screen.getByAltText('Attached image: photo.png')).toBeInTheDocument();
    expect(container.querySelector('.chorus-user .chorus-bubble')).toBeInTheDocument();
  });
  it('prefers Attachment.alt for the image alt attribute when provided', () => {
    render(<ChatWindow messages={[{
      id: 'u-alt',
      role: 'user',
      text: '',
      attachments: [{
        name: 'photo.png',
        type: 'image/png',
        data: 'data:image/png;base64,abc',
        size: 3,
        alt: 'A red bicycle leaning on a fence',
      }],
    }]} />);

    expect(screen.getByAltText('A red bicycle leaning on a fence')).toBeInTheDocument();
    expect(screen.queryByAltText('Attached image: photo.png')).not.toBeInTheDocument();
  });
  it('uses the localized fallback alt label when Attachment.alt is missing', () => {
    render(<ChatWindow
      messages={[{
        id: 'u-fallback',
        role: 'user',
        text: '',
        attachments: [{ name: 'photo.png', type: 'image/png', data: 'data:image/png;base64,abc', size: 3 }],
      }]}
      labels={{ attachments: { imageFallbackAlt: (name) => `Image jointe : ${name}` } }}
    />);
    expect(screen.getByAltText('Image jointe : photo.png')).toBeInTheDocument();
  });
  it('preserves a bubble for normal assistant text', () => {
    const { container } = render(<ChatWindow messages={[ASST_MSG]} />);

    expect(screen.getByText('Hi there')).toBeInTheDocument();
    expect(container.querySelector('.chorus-assistant .chorus-bubble')).toBeInTheDocument();
  });
  it('uses renderError instead of the default error banner', async () => {
    const user = userEvent.setup();
    const rawError = new Error('raw upstream');
    const onRetry = vi.fn();
    const onDismissError = vi.fn();
    const renderError = vi.fn(({ error, rawError, retry, dismiss }) => (
      <div role="alert" data-testid="custom-error">
        <span>{error}</span>
        <span>{rawError?.message}</span>
        <button type="button" onClick={retry}>Try custom retry</button>
        <button type="button" onClick={dismiss}>Dismiss custom error</button>
      </div>
    ));

    render(
      <ChatWindow
        messages={[]}
        error="Friendly error"
        rawError={rawError}
        onRetry={onRetry}
        onDismissError={onDismissError}
        renderError={renderError}
      />
    );

    expect(screen.getByTestId('custom-error')).toHaveTextContent('Friendly error');
    expect(screen.getByTestId('custom-error')).toHaveTextContent('raw upstream');
    expect(document.querySelector('.chorus-error')).not.toBeInTheDocument();
    expect(renderError).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Friendly error',
      rawError,
      retry: expect.any(Function),
      dismiss: expect.any(Function),
    }));

    await user.click(screen.getByRole('button', { name: 'Try custom retry' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss custom error' }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onDismissError).toHaveBeenCalledOnce();
  });
  it('renders a ToolCallBlock for tool messages', () => {
    render(<ChatWindow messages={[TOOL_MSG]} showSystemMessages />);
    expect(screen.getByText('search')).toBeInTheDocument();
  });
  it('renders a tool message\'s text summary above the ToolCallBlock', () => {
    const toolWithText: Message = { ...TOOL_MSG, id: 't-text', text: 'Found 3 matching results.' };
    render(<ChatWindow messages={[toolWithText]} showSystemMessages />);
    expect(screen.getByText('Found 3 matching results.')).toBeInTheDocument();
    expect(screen.getByText('search')).toBeInTheDocument();
  });
  it('omits the tool text bubble when text is empty or whitespace', () => {
    const blankTool: Message = { ...TOOL_MSG, id: 't-blank', text: '   ' };
    render(<ChatWindow messages={[blankTool]} showSystemMessages />);
    expect(screen.queryByTestId('markdown')).not.toBeInTheDocument();
    expect(screen.getByText('search')).toBeInTheDocument();
  });
  it('shows a running status for an empty-bodied tool row inside the streaming turn', () => {
    const emptyTool: Message = { id: 't-empty', role: 'tool', text: '', toolCall: { name: 'lookup' } };
    render(
      <ChatWindow
        messages={[USER_MSG, emptyTool, { id: 'a2', role: 'assistant', text: '' }]}
        streamingMessageId="a2"
        hiddenRoles={[]}
      />,
    );
    expect(screen.getByText('Running…')).toBeInTheDocument();
    expect(screen.queryByText('No output')).not.toBeInTheDocument();
  });
  it('keeps a finished empty-bodied tool row settled when a separate later turn streams', () => {
    // The empty-bodied tool call precedes a finalized assistant message; an
    // unrelated streaming turn afterwards must not flip it back to "Running…".
    const emptyTool: Message = { id: 't-empty', role: 'tool', text: '', toolCall: { name: 'lookup' } };
    render(
      <ChatWindow
        messages={[
          USER_MSG,
          emptyTool,
          ASST_MSG,
          { id: 'u2', role: 'user', text: 'Again' },
          { id: 'a2', role: 'assistant', text: '' },
        ]}
        streamingMessageId="a2"
        hiddenRoles={[]}
      />,
    );
    expect(screen.getByText('No output')).toBeInTheDocument();
    expect(screen.queryByText('Running…')).not.toBeInTheDocument();
  });
});

describe('ChatWindow maxRenderedMessages windowing with an active stream', () => {
  const emptyTool = (id: string, name: string): Message => ({ id, role: 'tool', text: '', toolCall: { name } });

  it('classifies tool rows by the full pre-window streaming turn, not the windowed slice', () => {
    // `t-old` finished in the first turn; `t-new` belongs to the in-flight
    // streaming turn. The window drops the first user message, so MessageList
    // never sees it — but the streaming turn is derived from the full visible
    // array, so `t-old` stays settled while `t-new` shows "Running…".
    render(
      <ChatWindow
        messages={[
          USER_MSG,
          emptyTool('t-old', 'lookup'),
          ASST_MSG,
          { id: 'u2', role: 'user', text: 'Again' },
          emptyTool('t-new', 'fetch'),
          { id: 'a2', role: 'assistant', text: '' },
        ]}
        streamingMessageId="a2"
        maxRenderedMessages={5}
        hiddenRoles={[]}
      />,
    );
    expect(screen.queryByText('Hello')).not.toBeInTheDocument();
    expect(screen.getByText('No output')).toBeInTheDocument();
    expect(screen.getByText('Running…')).toBeInTheDocument();
  });

  it('force-includes the streaming message when host rows after it push it out of the window', () => {
    render(
      <ChatWindow
        messages={[
          USER_MSG,
          { id: 'a-stream', role: 'assistant', text: 'partial reply' },
          { id: 'x1', role: 'user', text: 'late user' },
          { id: 'x2', role: 'assistant', text: 'late reply' },
        ]}
        streamingMessageId="a-stream"
        maxRenderedMessages={2}
      />,
    );
    // The trailing window is [x1, x2]; the streaming message is unioned back in
    // so its partial text never vanishes mid-stream.
    const streamingMarkdown = screen.getByText('partial reply');
    expect(streamingMarkdown).toBeInTheDocument();
    expect(streamingMarkdown).toHaveAttribute('data-streaming', 'true');
    // A non-streaming windowed row is still parsed as full Markdown.
    expect(screen.getByText('late reply')).toHaveAttribute('data-streaming', 'false');
  });

  it('still renders the streaming message when maxRenderedMessages is 0', () => {
    render(
      <ChatWindow
        messages={[USER_MSG, { id: 'a-stream', role: 'assistant', text: 'partial reply' }]}
        streamingMessageId="a-stream"
        maxRenderedMessages={0}
      />,
    );
    expect(screen.getByText('partial reply')).toHaveAttribute('data-streaming', 'true');
  });
});
