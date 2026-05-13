import type React from 'react';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatWindow, MessageBubble } from '../components/ChatWindow';
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

// ---------------------------------------------------------------------------

describe('ChatWindow', () => {
  it('renders user and assistant messages', () => {
    render(<ChatWindow messages={[USER_MSG, ASST_MSG]} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
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

  it('renders an alert error message when error is provided', () => {
    render(<ChatWindow messages={[]} error="Network error" />);
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
    }));
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

  it('preserves local edit state when messages stream in', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const { rerender } = render(<ChatWindow messages={[USER_MSG, { ...ASST_MSG, text: 'H' }]} onEdit={onEdit} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Edit message' }), ' draft');

    rerender(<ChatWindow messages={[USER_MSG, { ...ASST_MSG, text: 'Hi there streaming' }]} onEdit={onEdit} />);

    expect(screen.getByRole('textbox', { name: 'Edit message' })).toHaveValue('Hello draft');
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

    expect(screen.getByAltText('photo.png')).toHaveAttribute('src', 'data:image/png;base64,abc');
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
});
