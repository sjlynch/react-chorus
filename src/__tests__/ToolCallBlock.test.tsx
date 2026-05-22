import type React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolCallBlock } from '../components/ToolCallBlock';
import type { ToolCall } from '../types';

const CALL_WITH_IO: ToolCall = {
  name: 'web_search',
  input: { query: 'vitest testing' },
  output: { results: ['a', 'b'] },
};

const CALL_NAME_ONLY: ToolCall = { name: 'do_something' };

// ---------------------------------------------------------------------------

describe('ToolCallBlock', () => {
  it('renders the tool name', () => {
    render(<ToolCallBlock toolCall={CALL_WITH_IO} />);
    expect(screen.getByText('web_search')).toBeInTheDocument();
  });

  it('shows a chevron toggle when input or output is present', () => {
    render(<ToolCallBlock toolCall={CALL_WITH_IO} />);
    expect(screen.getByRole('button')).toHaveTextContent('▼');
  });

  it('toggle button does not submit an enclosing form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<form onSubmit={onSubmit}><ToolCallBlock toolCall={CALL_WITH_IO} /></form>);

    await user.click(screen.getByRole('button'));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('links the expandable header to the body it controls', async () => {
    const user = userEvent.setup();
    render(<ToolCallBlock toolCall={CALL_WITH_IO} />);
    const button = screen.getByRole('button');
    const controls = button.getAttribute('aria-controls');

    expect(controls).toBeTruthy();
    await user.click(button);
    expect(document.getElementById(controls!)).toHaveClass('chorus-tool-call-body');
  });

  it('shows a settled "no output" status instead of a dead button when no input/output', () => {
    render(<ToolCallBlock toolCall={CALL_NAME_ONLY} />);
    // No interactive control: nothing to expand, so it must not look clickable.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('▼')).not.toBeInTheDocument();
    expect(screen.queryByText('▲')).not.toBeInTheDocument();
    expect(screen.getByText('do_something')).toBeInTheDocument();
    expect(screen.getByText('No output')).toBeInTheDocument();
  });

  it('shows a running status for an empty tool call while the turn is still streaming', () => {
    render(<ToolCallBlock toolCall={CALL_NAME_ONLY} streaming />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Running…')).toBeInTheDocument();
    expect(screen.queryByText('No output')).not.toBeInTheDocument();
  });

  it('treats an empty tool call as settled once streaming has finished', () => {
    render(<ToolCallBlock toolCall={CALL_NAME_ONLY} streaming={false} />);
    expect(screen.getByText('No output')).toBeInTheDocument();
    expect(screen.queryByText('Running…')).not.toBeInTheDocument();
  });

  it('does not show a running status once the call has a body to expand', () => {
    render(<ToolCallBlock toolCall={CALL_WITH_IO} streaming />);
    // A call with input/output is intentional on its own — the streaming flag
    // must not turn its expandable header into a status row.
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.queryByText('Running…')).not.toBeInTheDocument();
  });

  it('honors an overridden running label', () => {
    render(<ToolCallBlock toolCall={CALL_NAME_ONLY} streaming labels={{ running: 'Working' }} />);
    expect(screen.getByText('Working')).toBeInTheDocument();
  });

  it('honors an overridden empty label', () => {
    render(<ToolCallBlock toolCall={CALL_NAME_ONLY} labels={{ empty: 'Nothing' }} />);
    expect(screen.getByText('Nothing')).toBeInTheDocument();
  });

  it('body is hidden before expansion', () => {
    render(<ToolCallBlock toolCall={CALL_WITH_IO} />);
    expect(screen.queryByText('Input')).not.toBeInTheDocument();
    expect(screen.queryByText('Output')).not.toBeInTheDocument();
  });

  it('expands to show input and output on click', async () => {
    const user = userEvent.setup();
    render(<ToolCallBlock toolCall={CALL_WITH_IO} />);

    await user.click(screen.getByRole('button'));

    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
  });

  it('chevron points up when expanded', async () => {
    const user = userEvent.setup();
    render(<ToolCallBlock toolCall={CALL_WITH_IO} />);

    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('▲');
  });

  it('collapses again on second click', async () => {
    const user = userEvent.setup();
    render(<ToolCallBlock toolCall={CALL_WITH_IO} />);

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('button'));

    expect(screen.queryByText('Input')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveTextContent('▼');
  });

  it('renders input as formatted JSON', async () => {
    const user = userEvent.setup();
    render(<ToolCallBlock toolCall={CALL_WITH_IO} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByText(/vitest testing/)).toBeInTheDocument();
  });

  it('safely renders circular, BigInt, function, and undefined payloads', async () => {
    const user = userEvent.setup();
    const circular: Record<string, unknown> = {
      count: 123n,
      fn: function namedTool() { return 'ok'; },
      optional: undefined,
    };
    circular.self = circular;
    const call: ToolCall = { name: 'complex', input: circular, output: undefined };

    render(<ToolCallBlock toolCall={call} />);
    await user.click(screen.getByRole('button'));

    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
    expect(screen.getByText(/123n/)).toBeInTheDocument();
    expect(screen.getByText(/\[Circular\]/)).toBeInTheDocument();
    expect(screen.getByText(/\[Function namedTool\]/)).toBeInTheDocument();
    expect(screen.getAllByText(/undefined|\[undefined\]/).length).toBeGreaterThan(0);
  });

  it('shows only input section when output is absent', async () => {
    const user = userEvent.setup();
    const callInputOnly: ToolCall = { name: 'fetch', input: { url: 'https://example.com' } };
    render(<ToolCallBlock toolCall={callInputOnly} />);

    await user.click(screen.getByRole('button'));

    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.queryByText('Output')).not.toBeInTheDocument();
  });

  it('shows only output section when input is absent', async () => {
    const user = userEvent.setup();
    const callOutputOnly: ToolCall = { name: 'read_file', output: 'file contents here' };
    render(<ToolCallBlock toolCall={callOutputOnly} />);

    await user.click(screen.getByRole('button'));

    expect(screen.queryByText('Input')).not.toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
  });

  it('merges a custom className after the built-in class on the root', () => {
    const { container } = render(
      <ToolCallBlock toolCall={CALL_WITH_IO} className="my-tool extra" />,
    );
    const root = container.firstElementChild as HTMLElement;
    // The built-in hook must remain so default styling/palette wiring still applies,
    // and the host class must follow it so its rules win cascade ties when needed.
    expect(root.className).toBe('chorus-tool-call my-tool extra');
  });

  it('merges className on the static "no output" root the same way', () => {
    const { container } = render(
      <ToolCallBlock toolCall={CALL_NAME_ONLY} className="my-tool" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe('chorus-tool-call my-tool');
  });

  it('forwards inline style onto the root element', () => {
    const { container } = render(
      <ToolCallBlock toolCall={CALL_WITH_IO} style={{ paddingBlock: '2px' }} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.paddingBlock).toBe('2px');
  });
});
