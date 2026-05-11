import { describe, it, expect } from 'vitest';
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

  it('does not show a chevron or allow expand when no input/output', () => {
    render(<ToolCallBlock toolCall={CALL_NAME_ONLY} />);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.queryByText('▼')).not.toBeInTheDocument();
    expect(screen.queryByText('▲')).not.toBeInTheDocument();
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
});
