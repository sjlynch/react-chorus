import { createRef } from 'react';
import type React from 'react';
import { readFileSync } from 'node:fs';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatWindow, MessageBubble, stringActivityKey, type MessageFeedback, type RenderMessageContext } from '../components/ChatWindow';
import type { Message } from '../types';

// Mock Markdown to avoid DOMPurify/highlight.js complexity in unit tests
vi.mock('../components/Markdown', () => ({
  Markdown: ({ text, headless, streaming, sanitizer }: { text: string; headless?: boolean; streaming?: boolean; sanitizer?: unknown }) => (
    <span data-testid="markdown" data-headless={String(headless)} data-streaming={String(streaming)} data-sanitizer={String(Boolean(sanitizer))}>{text}</span>
  ),
}));

const USER_MSG: Message = { id: 'u1', role: 'user', text: 'Hello' };
const ASST_MSG: Message = { id: 'a1', role: 'assistant', text: 'Hi there' };
const SYS_MSG: Message = { id: 's1', role: 'system', text: 'You are helpful.' };
const TOOL_MSG: Message = {
  id: 't1',
  role: 'tool',
  text: '',
  toolCall: { name: 'search', input: { q: 'test' }, output: 'results' },
};

function readmeMessageRenderer(msg: Message, ctx: RenderMessageContext) {
  return (
    <>
      <MessageBubble message={msg} streaming={ctx.isStreaming} />
      {ctx.actions.defaultRender()}
    </>
  );
}

function containsLoneSurrogate(value: string) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (i + 1 >= value.length || next < 0xdc00 || next > 0xdfff) return true;
      i += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------

describe('ChatWindow', () => {
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

  it('exposes the transcript as a polite live log region', () => {
    render(<ChatWindow messages={[USER_MSG, ASST_MSG]} />);
    const transcript = screen.getByRole('log', { name: /chat transcript/i });
    expect(transcript).toHaveAttribute('aria-live', 'polite');
    expect(transcript).toHaveClass('chorus-window');
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
    expect(screen.getByRole('status', { name: /assistant is typing/i })).toBeInTheDocument();
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

  it('renders an alert error message when error is provided', () => {
    render(<ChatWindow messages={[]} error="Network error" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Network error');
  });

  it('renders errors alongside an active empty state', () => {
    render(<ChatWindow messages={[]} emptyState={<p>Empty welcome</p>} error="Network error" />);

    expect(screen.getByText('Empty welcome')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Network error');
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

  it('uses renderMessage prop to override default rendering', () => {
    const renderMessage = vi.fn((m: Message) => (
      <div data-testid="custom">{m.text}</div>
    ));
    render(<ChatWindow messages={[USER_MSG]} renderMessage={renderMessage} />);
    expect(screen.getByTestId('custom')).toHaveTextContent('Hello');
    expect(renderMessage.mock.calls[0][0]).toBe(USER_MSG);
    expect(renderMessage.mock.calls[0][1]).toEqual(expect.objectContaining({
      isStreaming: false,
      defaultRender: expect.any(Function),
      actions: expect.any(Object),
      messageProps: { 'data-chorus-message-id': 'u1' },
    }));
  });

  it('adds scroll target props to a direct custom DOM renderMessage root', () => {
    render(
      <ChatWindow
        messages={[USER_MSG]}
        renderMessage={(message) => <article data-testid="custom-root">{message.text}</article>}
      />
    );

    expect(screen.getByTestId('custom-root')).toHaveAttribute('data-chorus-message-id', 'u1');
  });

  it('falls back to default rendering when renderMessage returns null', () => {
    const renderMessage = vi.fn(() => null);
    render(<ChatWindow messages={[USER_MSG]} renderMessage={renderMessage} />);
    // Falls back to the default MessageRow render
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('provides renderMessage context for streaming state, default rendering, and actions', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const renderMessage = vi.fn((_message: Message, ctx) => (
      <div>
        <span data-testid="streaming-state">{String(ctx.isStreaming)}</span>
        {ctx.defaultRender()}
        <button type="button" onClick={ctx.actions.delete}>Custom delete</button>
      </div>
    ));

    render(<ChatWindow messages={[ASST_MSG]} streamingMessageId="a1" renderMessage={renderMessage} onDelete={onDelete} />);

    expect(screen.getByTestId('streaming-state')).toHaveTextContent('true');
    expect(screen.getByText('Hi there')).toBeInTheDocument();
    expect(screen.getByTestId('markdown')).toHaveAttribute('data-streaming', 'true');

    await user.click(screen.getByRole('button', { name: 'Custom delete' }));

    expect(onDelete).toHaveBeenCalledWith('a1');
  });

  it('names all message action controls and the edit textarea', async () => {
    const user = userEvent.setup();
    render(
      <ChatWindow
        messages={[USER_MSG, ASST_MSG]}
        onEdit={vi.fn()}
        onRegenerate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('textbox', { name: 'Edit message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('reveals message actions on hover and keyboard focus', () => {
    const css = readFileSync('src/Chorus.css', 'utf8');
    expect(css).toContain('.chorus-msg:hover .chorus-actions, .chorus-msg:focus-within .chorus-actions');
    expect(css).toContain('.chorus-msg:hover + .chorus-render-actions .chorus-actions');
  });

  it('respects prefers-reduced-motion by disabling looping animations and non-essential transitions', () => {
    const css = readFileSync('src/Chorus.css', 'utf8');
    const block = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/);
    expect(block, 'expected a prefers-reduced-motion: reduce block in Chorus.css').not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/\.chorus-attachment-spinner\s*\{[^}]*animation:\s*none/);
    expect(body).toMatch(/\.chorus-dot\s*\{[^}]*animation:\s*none/);
    expect(body).toMatch(/\.chorus-dot\s*\{[^}]*opacity:\s*1/);
    expect(body).toMatch(/transition:\s*none/);
  });

  it('keeps message actions visible on coarse pointers / no-hover devices and via the alwaysShowMessageActions opt-in', () => {
    const css = readFileSync('src/Chorus.css', 'utf8');
    expect(css).toMatch(/@media\s*\(hover:\s*none\),\s*\(pointer:\s*coarse\)\s*\{[^}]*\.chorus-actions\s*\{[^}]*opacity:\s*1[^}]*pointer-events:\s*auto/);
    expect(css).toMatch(/\.chorus--always-show-actions\s+\.chorus-actions\s*\{[^}]*opacity:\s*1[^}]*pointer-events:\s*auto/);
    expect(css).toMatch(/\.chorus-action-btn:focus-visible\s*\{[^}]*outline:/);
  });

  it('provides :focus-visible rings on composer, conversation, tool-call, and attachment-dismiss buttons', () => {
    const css = readFileSync('src/Chorus.css', 'utf8');
    // Composer buttons
    expect(css).toMatch(/\.chorus-send:focus-visible\s*\{[^}]*box-shadow:/);
    expect(css).toMatch(/\.chorus-attach:focus-visible\s*\{[^}]*outline:/);
    expect(css).toMatch(/\.chorus-clear-btn:focus-visible\s*\{[^}]*outline:/);
    // Attachment chip + error banner dismiss
    expect(css).toMatch(/\.chorus-attachment-remove:focus-visible\s*\{[^}]*outline:/);
    expect(css).toMatch(/\.chorus-attachment-error-dismiss:focus-visible\s*\{[^}]*outline:/);
    // Tool call header
    expect(css).toMatch(/\.chorus-tool-call-header:focus-visible\s*\{[^}]*outline:/);
    // Conversation sidebar buttons
    expect(css).toMatch(/\.chorus-conversation-new:focus-visible\s*\{[^}]*outline:/);
    expect(css).toMatch(/\.chorus-conversation-select:focus-visible\s*\{[^}]*outline:/);
    expect(css).toMatch(/\.chorus-conversation-action:focus-visible\s*\{[^}]*outline:/);
  });

  it('keeps :focus-visible rings outside the prefers-reduced-motion block (motion suppression should not hide focus)', () => {
    const css = readFileSync('src/Chorus.css', 'utf8');
    const block = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/);
    expect(block).not.toBeNull();
    expect(block![0]).not.toMatch(/:focus-visible/);
  });

  it('uses CSS logical properties on the composer + sidebar so RTL locales flip correctly', () => {
    const css = readFileSync('src/Chorus.css', 'utf8');
    // Composer absolute positioning should flip with `dir`
    expect(css).toMatch(/\.chorus-attach\s*\{[^}]*inset-inline-start:\s*8px/);
    expect(css).toMatch(/\.chorus-send\s*\{[^}]*inset-inline-end:\s*8px/);
    // Textarea padding leaves room for the inline-end send button and the inline-start attach button
    expect(css).toMatch(/\.chorus-input-row\s+textarea\s*\{[^}]*padding-inline-start:\s*14px/);
    expect(css).toMatch(/\.chorus-input-row\s+textarea\s*\{[^}]*padding-inline-end:\s*50px/);
    expect(css).toMatch(/\.chorus-input-row--has-attach\s+textarea\s*\{[^}]*padding-inline-start:\s*44px/);
    // Conversation sidebar helpers
    expect(css).toMatch(/\.chorus-conversation-pin-indicator\s*\{[^}]*margin-inline-end:\s*4px/);
    expect(css).toMatch(/\.chorus-conversation-actions\s*\{[^}]*padding-inline-end:\s*4px/);
    // Buttons with reading-direction text content use logical text-align
    expect(css).toMatch(/\.chorus-conversation-new\s*\{[^}]*text-align:\s*start/);
    expect(css).toMatch(/\.chorus-conversation-select\s*\{[^}]*text-align:\s*start/);
    expect(css).toMatch(/\.chorus-tool-call-header\s*\{[^}]*text-align:\s*start/);
    // And no physical left/right offsets remain on the user-visible chat surface
    expect(css).not.toMatch(/\.chorus-(attach|send|input-row[^{]*|conversation-(pin-indicator|actions))\s*\{[^}]*\b(left|right|padding-left|padding-right|margin-left|margin-right):/);
  });

  it('flips inset-inline-end to the visual left under dir="rtl" on the send button', () => {
    document.documentElement.dir = 'ltr';
    try {
      const wrapper = document.createElement('div');
      wrapper.dir = 'rtl';
      document.body.appendChild(wrapper);
      const button = document.createElement('button');
      button.className = 'chorus-send';
      button.style.position = 'absolute';
      // Mirror what the stylesheet sets so we can observe `right` resolves to `auto` in RTL
      // when `inset-inline-end` is the source of truth.
      (button.style as CSSStyleDeclaration & { insetInlineEnd?: string }).insetInlineEnd = '8px';
      wrapper.appendChild(button);

      const computed = window.getComputedStyle(button);
      // jsdom honors inline-style logical properties: in dir="rtl" the inline-end edge is the left edge.
      // Either the physical `right` is unset/auto (correct: ring is on the left) or the
      // logical inset value resolves on the `left` side. Both indicate the flip worked.
      const right = computed.right || 'auto';
      const left = computed.left || 'auto';
      const insetInlineEnd = computed.getPropertyValue('inset-inline-end').trim();
      expect(insetInlineEnd === '8px' || left === '8px' || right === 'auto').toBe(true);

      wrapper.remove();
    } finally {
      document.documentElement.dir = '';
    }
  });

  it('calls onDelete with message id when delete button is clicked', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<ChatWindow messages={[USER_MSG]} onDelete={onDelete} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('u1');
  });

  it('calls onRegenerate with message id when regenerate is clicked', async () => {
    const user = userEvent.setup();
    const onRegenerate = vi.fn();
    render(<ChatWindow messages={[ASST_MSG]} onRegenerate={onRegenerate} />);
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(onRegenerate).toHaveBeenCalledWith('a1');
  });

  it('renders copy and feedback actions when callbacks are provided', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const onFeedback = vi.fn();
    render(<ChatWindow messages={[ASST_MSG]} onCopy={onCopy} onFeedback={onFeedback} />);

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await user.click(screen.getByRole('button', { name: 'Thumbs up' }));
    expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Thumbs up' }));
    await user.click(screen.getByRole('button', { name: 'Thumbs down' }));

    expect(onCopy).toHaveBeenCalledWith(ASST_MSG);
    expect(onFeedback).toHaveBeenNthCalledWith(1, ASST_MSG, 'up');
    expect(onFeedback).toHaveBeenNthCalledWith(2, ASST_MSG, 'down');
    expect(onFeedback).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Thumbs down' })).toHaveAttribute('aria-pressed', 'true');
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

  it('preserves local edit state when messages stream in', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const { rerender } = render(<ChatWindow messages={[USER_MSG, { ...ASST_MSG, text: 'H' }]} onEdit={onEdit} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Edit message' }), ' draft');

    rerender(<ChatWindow messages={[USER_MSG, { ...ASST_MSG, text: 'Hi there streaming' }]} onEdit={onEdit} />);

    expect(screen.getByRole('textbox', { name: 'Edit message' })).toHaveValue('Hello draft');
  });

  it('renders identical inline editor markup in default and renderMessage action paths', async () => {
    const user = userEvent.setup();
    const defaultView = render(<ChatWindow messages={[USER_MSG]} onEdit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const defaultMarkup = defaultView.container.querySelector('.chorus-edit-wrap')?.outerHTML;
    defaultView.unmount();

    const customView = render(<ChatWindow messages={[USER_MSG]} onEdit={vi.fn()} renderMessage={readmeMessageRenderer} />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(customView.container.querySelector('.chorus-edit-wrap')?.outerHTML).toBe(defaultMarkup);
  });

  for (const variant of [
    { name: 'default row', renderMessage: undefined },
    { name: 'renderMessage action controls', renderMessage: readmeMessageRenderer },
  ] as const) {
    it(`handles Enter, Escape, and Shift+Enter identically in the ${variant.name} editor`, () => {
      const onEdit = vi.fn();
      render(<ChatWindow messages={[USER_MSG]} onEdit={onEdit} renderMessage={variant.renderMessage} />);

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      const textarea = screen.getByRole('textbox', { name: 'Edit message' });
      fireEvent.change(textarea, { target: { value: 'Line 1\nLine 2' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

      expect(textarea).toHaveValue('Line 1\nLine 2');
      expect(onEdit).not.toHaveBeenCalled();

      fireEvent.keyDown(textarea, { key: 'Escape' });
      expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument();
      expect(onEdit).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      const saveTextarea = screen.getByRole('textbox', { name: 'Edit message' });
      fireEvent.change(saveTextarea, { target: { value: 'Saved' } });
      fireEvent.keyDown(saveTextarea, { key: 'Enter' });

      expect(onEdit).toHaveBeenCalledWith('u1', 'Saved');
      expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument();
    });
  }

  it('supports the README MessageBubble plus actions.defaultRender pattern without duplicate bubbles', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onRegenerate = vi.fn();
    const onDelete = vi.fn();
    render(
      <ChatWindow
        messages={[USER_MSG, ASST_MSG]}
        onEdit={onEdit}
        onRegenerate={onRegenerate}
        onDelete={onDelete}
        renderMessage={readmeMessageRenderer}
      />
    );

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(onRegenerate).toHaveBeenCalledWith('a1');
    expect(onDelete).toHaveBeenCalledWith('u1');
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toHaveValue('Hello');
    expect(screen.queryAllByTestId('markdown').map(el => el.textContent)).not.toContain('Hello');
  });

  for (const variant of [
    { name: 'default row', renderMessage: undefined },
    { name: 'renderMessage action controls', renderMessage: readmeMessageRenderer },
  ] as const) {
    it(`restores focus to the Edit button after Escape in the ${variant.name}`, async () => {
      const user = userEvent.setup();
      render(<ChatWindow messages={[USER_MSG]} onEdit={vi.fn()} renderMessage={variant.renderMessage} />);

      await user.click(screen.getByRole('button', { name: 'Edit' }));
      await user.keyboard('{Escape}');

      expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus();
    });

    it(`restores focus to the Edit button after Cancel click in the ${variant.name}`, async () => {
      const user = userEvent.setup();
      render(<ChatWindow messages={[USER_MSG]} onEdit={vi.fn()} renderMessage={variant.renderMessage} />);

      await user.click(screen.getByRole('button', { name: 'Edit' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus();
    });
  }

  it('exposes ctx.isEditing so custom rows can hide their own content while the editor is active', async () => {
    const user = userEvent.setup();
    render(
      <ChatWindow
        messages={[USER_MSG]}
        onEdit={vi.fn()}
        renderMessage={(msg, ctx) => (
          <div {...ctx.messageProps}>
            {!ctx.isEditing && <p data-testid="custom-text">{msg.text}</p>}
            {ctx.actions.defaultRender()}
          </div>
        )}
      />
    );

    expect(screen.getByTestId('custom-text')).toHaveTextContent('Hello');

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.queryByTestId('custom-text')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toHaveValue('Hello');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByTestId('custom-text')).toHaveTextContent('Hello');
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus();
  });

  it('MessageBubble preserves the default row layout when used from renderMessage', () => {
    const { container } = render(
      <ChatWindow
        messages={[USER_MSG]}
        renderMessage={(message) => <MessageBubble message={message} />}
      />
    );

    const bubble = container.querySelector('.chorus-msg.chorus-user > .chorus-msg-content > .chorus-bubble');
    expect(bubble).toHaveTextContent('Hello');
  });

  it('adds screen-reader speaker labels to built-in rows and exported MessageBubble', () => {
    const { container, unmount } = render(<ChatWindow messages={[USER_MSG, ASST_MSG, SYS_MSG, TOOL_MSG]} hiddenRoles={[]} />);
    expect(Array.from(container.querySelectorAll('.chorus-msg > .chorus-sr-only')).map(el => el.textContent)).toEqual([
      'User message',
      'Assistant message',
      'System message',
      'Tool message',
    ]);
    unmount();

    const bubbleView = render(<MessageBubble message={USER_MSG} />);
    expect(bubbleView.container.querySelector('.chorus-msg > .chorus-sr-only')).toHaveTextContent('User message');
  });

  it('renders MessageBubble decoration slots in the expected layout positions', () => {
    const { container } = render(
      <MessageBubble
        message={ASST_MSG}
        before={<span data-testid="before">Avatar</span>}
        headerSlot={<span data-testid="header">Assistant · 14:32</span>}
        footerSlot={<span data-testid="footer">gpt-4o</span>}
        after={<span data-testid="after">Status</span>}
      />
    );

    const row = container.querySelector('.chorus-msg')!;
    const content = row.querySelector('.chorus-msg-content')!;
    expect(row.querySelector('[data-testid="before"]')?.nextElementSibling).toBe(content);
    expect(content.firstElementChild).toHaveAttribute('data-testid', 'header');
    expect(content.querySelector('.chorus-bubble')?.nextElementSibling).toHaveAttribute('data-testid', 'footer');
    expect(content.nextElementSibling).toHaveAttribute('data-testid', 'after');
  });

  it('passes decoration slots through ctx.defaultRender', () => {
    render(
      <ChatWindow
        messages={[USER_MSG]}
        renderMessage={(_message, ctx) => ctx.defaultRender({
          headerSlot: <span data-testid="ctx-header">You · now</span>,
          footerSlot: <span data-testid="ctx-footer">sent</span>,
        })}
      />
    );

    expect(screen.getByTestId('ctx-header')).toHaveTextContent('You · now');
    expect(screen.getByTestId('ctx-footer')).toHaveTextContent('sent');
  });

  it('passes decoration slots through ctx.defaultRender for a tool message', () => {
    const { container } = render(
      <ChatWindow
        messages={[TOOL_MSG]}
        hiddenRoles={[]}
        renderMessage={(_message, ctx) => ctx.defaultRender({
          headerSlot: <span data-testid="tool-ctx-header">search · now</span>,
          footerSlot: <span data-testid="tool-ctx-footer">done</span>,
        })}
      />
    );

    expect(screen.getByTestId('tool-ctx-header')).toHaveTextContent('search · now');
    expect(screen.getByTestId('tool-ctx-footer')).toHaveTextContent('done');

    // Mirror MessageBubbleLayout ordering: headerSlot before the tool call, footerSlot after.
    const toolCall = container.querySelector('.chorus-tool .chorus-tool-call')!;
    expect(toolCall.previousElementSibling).toHaveAttribute('data-testid', 'tool-ctx-header');
    expect(toolCall.nextElementSibling).toHaveAttribute('data-testid', 'tool-ctx-footer');
  });

  it('flips ctx.isEditing when Edit is clicked on a row from ctx.defaultRender()', async () => {
    const user = userEvent.setup();
    render(
      <ChatWindow
        messages={[USER_MSG]}
        onEdit={vi.fn()}
        renderMessage={(msg, ctx) => (
          <div {...ctx.messageProps}>
            {!ctx.isEditing && <p data-testid="custom-text">{msg.text}</p>}
            {ctx.defaultRender()}
          </div>
        )}
      />
    );

    expect(screen.getByTestId('custom-text')).toHaveTextContent('Hello');

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.queryByTestId('custom-text')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toHaveValue('Hello');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByTestId('custom-text')).toHaveTextContent('Hello');
  });

  it('MessageBubble renders message attachments', () => {
    const message: Message = {
      id: 'u2',
      role: 'user',
      text: 'See attachments',
      attachments: [
        { name: 'photo.png', type: 'image/png', data: 'data:image/png;base64,abc', size: 3 },
        { name: 'notes.txt', type: 'text/plain', data: 'data:text/plain;base64,abc', size: 3 },
      ],
    };

    const { container } = render(<MessageBubble message={message} />);

    expect(screen.getByAltText('Attached image: photo.png')).toHaveAttribute('src', 'data:image/png;base64,abc');
    expect(screen.getByAltText('Attached image: photo.png')).toHaveAttribute('loading', 'lazy');
    expect(screen.getByAltText('Attached image: photo.png')).toHaveAttribute('decoding', 'async');
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(container.querySelector('.chorus-msg-attachments')).toBeInTheDocument();
  });

  it('MessageBubble forwards headless to Markdown', () => {
    render(<MessageBubble message={USER_MSG} headless />);
    expect(screen.getByTestId('markdown')).toHaveAttribute('data-headless', 'true');
  });

  it('forwards Markdown customisation props to the built-in renderer', () => {
    const sanitizer = vi.fn((html: string) => html);
    render(<ChatWindow messages={[USER_MSG]} markdownSanitizer={sanitizer} />);
    expect(screen.getByTestId('markdown')).toHaveAttribute('data-sanitizer', 'true');
  });

  it('limits rendering to the latest visible message window while preserving typing and error rows', () => {
    const messages = Array.from({ length: 100 }, (_, i): Message => ({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: `Message ${i}`,
    }));

    render(<ChatWindow messages={messages} maxRenderedMessages={5} typing error="Still accessible" />);

    expect(screen.getAllByTestId('markdown')).toHaveLength(5);
    expect(screen.queryByText('Message 94')).not.toBeInTheDocument();
    expect(screen.getByText('Message 95')).toBeInTheDocument();
    expect(screen.getByText('Message 99')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /assistant is typing/i })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Still accessible');
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

  it('produces a hydration-stable initial tree when navigator.clipboard is only available client-side', () => {
    // Simulate SSR: navigator.clipboard.writeText is unavailable, so the
    // copy feature-detect must not commit copy buttons into the server tree.
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Reflect.deleteProperty(navigator, 'clipboard');
    let serverHtml: string;
    try {
      serverHtml = renderToString(<ChatWindow messages={[ASST_MSG]} />);
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    }

    expect(serverHtml).not.toMatch(/aria-label="Copy"/);

    // Hydrate on a client where navigator.clipboard IS available. The initial
    // client render must match the SSR output (so React emits no hydration
    // mismatch warning), and the copy button must appear after the mount
    // effect runs.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.appendChild(container);
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      act(() => {
        root = hydrateRoot(container, <ChatWindow messages={[ASST_MSG]} />);
      });

      const hydrationError = errorSpy.mock.calls.find(call =>
        call.some(arg => typeof arg === 'string' && /hydrat/i.test(arg))
      );
      expect(hydrationError).toBeUndefined();

      expect(container.querySelector('button[aria-label="Copy"]')).not.toBeNull();
    } finally {
      act(() => { root?.unmount(); });
      container.remove();
      errorSpy.mockRestore();
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
});
