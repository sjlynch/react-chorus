import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatWindow } from '../components/ChatWindow';
import type { Message } from '../types';

// Mock Markdown to avoid DOMPurify/highlight.js complexity in unit tests
vi.mock('../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
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

  it('hides system and tool messages by default', () => {
    render(<ChatWindow messages={[SYS_MSG, USER_MSG]} />);
    expect(screen.queryByText('You are helpful.')).not.toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('shows system messages when showSystemMessages=true', () => {
    render(<ChatWindow messages={[SYS_MSG, USER_MSG]} showSystemMessages />);
    expect(screen.getByText('You are helpful.')).toBeInTheDocument();
  });

  it('renders the typing indicator when typing=true', () => {
    const { container } = render(<ChatWindow messages={[]} typing />);
    expect(container.querySelector('.chorus-typing')).toBeInTheDocument();
  });

  it('does not render the typing indicator when typing=false', () => {
    const { container } = render(<ChatWindow messages={[]} typing={false} />);
    expect(container.querySelector('.chorus-typing')).not.toBeInTheDocument();
  });

  it('renders an error message when error is provided', () => {
    render(<ChatWindow messages={[]} error="Network error" />);
    expect(screen.getByText('Network error')).toBeInTheDocument();
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
    expect(renderMessage).toHaveBeenCalledWith(USER_MSG);
  });

  it('falls back to default rendering when renderMessage returns null', () => {
    const renderMessage = vi.fn(() => null);
    render(<ChatWindow messages={[USER_MSG]} renderMessage={renderMessage} />);
    // Falls back to the default MessageRow render
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('shows action buttons when onEdit/onRegenerate/onDelete are provided', () => {
    render(
      <ChatWindow
        messages={[USER_MSG]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByTitle('Edit')).toBeInTheDocument();
    expect(screen.getByTitle('Delete')).toBeInTheDocument();
  });

  it('calls onDelete with message id when delete button is clicked', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<ChatWindow messages={[USER_MSG]} onDelete={onDelete} />);
    await user.click(screen.getByTitle('Delete'));
    expect(onDelete).toHaveBeenCalledWith('u1');
  });

  it('calls onRegenerate with message id when regenerate is clicked', async () => {
    const user = userEvent.setup();
    const onRegenerate = vi.fn();
    render(<ChatWindow messages={[ASST_MSG]} onRegenerate={onRegenerate} />);
    await user.click(screen.getByTitle('Regenerate'));
    expect(onRegenerate).toHaveBeenCalledWith('a1');
  });
});
