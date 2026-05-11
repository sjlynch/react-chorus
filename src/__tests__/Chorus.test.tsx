import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Chorus } from '../Chorus';

vi.mock('../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus', () => {
  it('applies className, style, and palette variables to the root element', () => {
    const { container } = render(
      <Chorus
        className="my-chat"
        style={{ height: '500px' }}
        palette={{ chatBg: '#000' }}
      />
    );

    const root = container.firstElementChild as HTMLElement;

    expect(root).toHaveClass('chorus', 'my-chat');
    expect(root.style.height).toBe('500px');
    expect(root.style.getPropertyValue('--chorus-chat-bg')).toBe('#000');
  });
});
