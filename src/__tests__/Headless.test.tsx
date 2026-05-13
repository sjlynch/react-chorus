import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ChatWindow, Markdown, MessageBubble } from '../headless';
import type { Message } from '../types';

const USER_MSG: Message = { id: 'u1', role: 'user', text: 'Hello' };

beforeEach(() => {
  document.getElementById('chorus-md-styles')?.remove();
});

afterEach(() => {
  cleanup();
  document.getElementById('chorus-md-styles')?.remove();
});

describe('react-chorus/headless defaults', () => {
  it('Markdown does not inject Markdown styles by default', () => {
    render(<Markdown text="Hello" />);

    expect(document.getElementById('chorus-md-styles')).not.toBeInTheDocument();
  });

  it('MessageBubble does not inject Markdown styles by default', () => {
    render(<MessageBubble message={USER_MSG} />);

    expect(document.getElementById('chorus-md-styles')).not.toBeInTheDocument();
  });

  it('ChatWindow does not inject Markdown styles by default', () => {
    render(<ChatWindow messages={[USER_MSG]} />);

    expect(document.getElementById('chorus-md-styles')).not.toBeInTheDocument();
  });
});
