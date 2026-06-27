import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatInput } from '../../components/ChatInput';
import { Chorus } from '../../Chorus';

describe('ChatInput composerFooter slot', () => {
  it('renders a static footer node inside .chorus-composer-footer', () => {
    const { container } = render(
      <ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} composerFooter={<span data-testid="meter">42 tok/s</span>} />,
    );
    const footer = container.querySelector('.chorus-composer-footer');
    expect(footer).not.toBeNull();
    expect(footer).toContainElement(screen.getByTestId('meter'));
    expect(screen.getByTestId('meter')).toHaveTextContent('42 tok/s');
  });

  it('omits the footer element entirely when composerFooter is not provided', () => {
    const { container } = render(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} />);
    expect(container.querySelector('.chorus-composer-footer')).toBeNull();
  });

  it('passes the live { sending } flag to a render-prop footer and re-renders on change', () => {
    const footer = vi.fn(({ sending }: { sending: boolean }) => (
      <span data-testid="state">{sending ? 'sending' : 'idle'}</span>
    ));
    const { rerender } = render(
      <ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} composerFooter={footer} />,
    );
    expect(screen.getByTestId('state')).toHaveTextContent('idle');
    expect(footer).toHaveBeenCalledWith({ sending: false });

    rerender(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} sending composerFooter={footer} />);
    expect(screen.getByTestId('state')).toHaveTextContent('sending');
    expect(footer).toHaveBeenCalledWith({ sending: true });
  });

  it('threads composerFooter through the full <Chorus> shell', () => {
    render(<Chorus composerFooter={<span data-testid="chorus-footer">stats</span>} />);
    expect(screen.getByTestId('chorus-footer')).toBeInTheDocument();
    expect(screen.getByTestId('chorus-footer').closest('.chorus-composer-footer')).not.toBeNull();
  });
});
