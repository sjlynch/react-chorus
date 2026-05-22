import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageBubble, MessageRow } from '../components/MessageRow';
import type { Message } from '../types';

// Mock Markdown to avoid DOMPurify/highlight.js complexity in unit tests.
vi.mock('../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

const TOOL_MSG: Message = {
  id: 't1',
  role: 'tool',
  text: '',
  toolCall: { name: 'search', input: { q: 'react-chorus' }, output: 'ok' },
};

// --- Defect 1: tool-call content for role:'tool' messages -------------------

describe('standalone MessageBubble / MessageRow — tool-call rendering', () => {
  it('renders the tool call for a role:"tool" message through MessageBubble', () => {
    const { container } = render(<MessageBubble message={TOOL_MSG} />);

    expect(container.querySelector('.chorus-tool-call')).toBeInTheDocument();
    expect(screen.getByText('search')).toBeInTheDocument();
  });

  it('renders the tool call for a role:"tool" message through MessageRow', () => {
    const { container } = render(<MessageRow m={TOOL_MSG} codeTheme="dark" />);

    expect(container.querySelector('.chorus-tool-call')).toBeInTheDocument();
    expect(screen.getByText('search')).toBeInTheDocument();
  });

  it('renders a host-authored summary above the tool call', () => {
    const withSummary: Message = { ...TOOL_MSG, text: 'Found 3 results' };
    const { container } = render(<MessageBubble message={withSummary} />);

    expect(screen.getByText('Found 3 results')).toBeInTheDocument();
    expect(container.querySelector('.chorus-bubble')).toBeInTheDocument();
    expect(container.querySelector('.chorus-tool-call')).toBeInTheDocument();
  });

  it('forwards toolCallLabels to the tool call block', () => {
    const emptyCall: Message = { id: 't2', role: 'tool', text: '', toolCall: { name: 'noop' } };
    render(<MessageBubble message={emptyCall} toolCallLabels={{ empty: 'nothing returned' }} />);

    expect(screen.getByText('nothing returned')).toBeInTheDocument();
  });

  it('marks the tool call running while the tool turn is streaming', () => {
    const emptyCall: Message = { id: 't3', role: 'tool', text: '', toolCall: { name: 'noop' } };
    const { container } = render(<MessageBubble message={emptyCall} streaming />);

    expect(container.querySelector('[data-chorus-tool-call-state="running"]')).toBeInTheDocument();
  });
});

// --- Defect 2: streaming reasoning <details> stays collapsible --------------

describe('MessageBubble — streaming reasoning disclosure', () => {
  const reasoningMsg = (reasoning: string): Message => ({ id: 'r1', role: 'assistant', text: '', reasoning });

  it('opens the reasoning disclosure for a reasoning-only streaming turn', () => {
    const { container } = render(<MessageBubble message={reasoningMsg('thinking')} streaming />);

    expect(container.querySelector('details.chorus-reasoning')).toHaveAttribute('open');
  });

  it('keeps a reader-collapsed reasoning block collapsed as further chunks stream', () => {
    const { container, rerender } = render(<MessageBubble message={reasoningMsg('thinking')} streaming />);
    const details = container.querySelector('details.chorus-reasoning') as HTMLDetailsElement;
    expect(details).toHaveAttribute('open');

    // Reader collapses the chain-of-thought mid-stream.
    details.open = false;
    fireEvent(details, new Event('toggle', { bubbles: false, cancelable: false }));

    // Further reasoning chunks arrive while the turn is still streaming.
    rerender(<MessageBubble message={reasoningMsg('thinking harder')} streaming />);
    rerender(<MessageBubble message={reasoningMsg('thinking hardest')} streaming />);

    expect(container.querySelector('details.chorus-reasoning')).not.toHaveAttribute('open');
  });

  it('keeps an auto-opened reasoning disclosure open once streamed answer text arrives', () => {
    const { container, rerender } = render(<MessageBubble message={reasoningMsg('thinking')} streaming />);
    expect(container.querySelector('details.chorus-reasoning')).toHaveAttribute('open');

    // The first answer token arrives, so the auto-open hint clears. The reader
    // never toggled the disclosure, so it must stay open (the latch) rather
    // than snap shut while they are still following the chain-of-thought.
    rerender(
      <MessageBubble
        message={{ id: 'r1', role: 'assistant', text: 'Here is the answer', reasoning: 'thinking' }}
        streaming
      />,
    );

    expect(container.querySelector('details.chorus-reasoning')).toHaveAttribute('open');
  });

  it('lets the reader collapse the reasoning disclosure after answer text arrives', () => {
    const { container, rerender } = render(<MessageBubble message={reasoningMsg('thinking')} streaming />);

    // Answer text arrives; the latched-open disclosure stays open.
    rerender(
      <MessageBubble
        message={{ id: 'r1', role: 'assistant', text: 'Here is the answer', reasoning: 'thinking' }}
        streaming
      />,
    );
    const details = container.querySelector('details.chorus-reasoning') as HTMLDetailsElement;
    expect(details).toHaveAttribute('open');

    // The reader explicitly collapses it — their choice overrides the latch.
    details.open = false;
    fireEvent(details, new Event('toggle', { bubbles: false, cancelable: false }));
    rerender(
      <MessageBubble
        message={{ id: 'r1', role: 'assistant', text: 'Here is the answer, expanded', reasoning: 'thinking' }}
        streaming
      />,
    );

    expect(container.querySelector('details.chorus-reasoning')).not.toHaveAttribute('open');
  });

  it('leaves the reasoning disclosure collapsed on a settled message', () => {
    const { container } = render(<MessageBubble message={reasoningMsg('finished thoughts')} />);

    expect(container.querySelector('details.chorus-reasoning')).not.toHaveAttribute('open');
  });
});
