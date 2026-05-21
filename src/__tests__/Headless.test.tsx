import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ChatInput,
  ChatWindow,
  Chorus,
  ConversationList,
  Markdown,
  MessageBubble,
  formatOpenAIChatCompletionsBody,
  useChorusPersistence,
  useConversations,
} from '../headless';
import type { ChatInputHandle } from '../headless';
import type { ChorusRef } from '../headless';
import {
  formatOpenAIChatCompletionsBody as rootFormatOpenAIChatCompletionsBody,
  useChorusPersistence as rootUseChorusPersistence,
  useConversations as rootUseConversations,
} from '../index';
import type { Message } from '../types';

const USER_MSG: Message = { id: 'u1', role: 'user', text: 'Hello' };
const CONVERSATIONS = [
  { id: 'c1', title: 'General', createdAt: '2026-05-16T00:00:00.000Z', updatedAt: '2026-05-16T00:00:00.000Z' },
];

beforeEach(() => {
  document.getElementById('chorus-md-styles')?.remove();
});

afterEach(() => {
  cleanup();
  document.getElementById('chorus-md-styles')?.remove();
});

describe('react-chorus/headless defaults', () => {
  it('re-exports non-overridden root API sentinels', () => {
    expect(useChorusPersistence).toBe(rootUseChorusPersistence);
    expect(useConversations).toBe(rootUseConversations);
    expect(formatOpenAIChatCompletionsBody).toBe(rootFormatOpenAIChatCompletionsBody);
  });

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

  it('ConversationList defaults to headless mode', () => {
    const { container } = render(<ConversationList conversations={CONVERSATIONS} />);

    expect(container.querySelector('.chorus-conversation-list')).toHaveClass('chorus-conversation-list--headless');
  });

  it('ChatWindow defaults to headless mode', () => {
    const { container } = render(<ChatWindow messages={[USER_MSG]} />);

    expect(container.querySelector('.chorus-window')).toHaveClass('chorus-window--headless');
  });

  it('Chorus does not inject Markdown styles by default', () => {
    render(<Chorus initialMessages={[USER_MSG]} />);

    expect(document.getElementById('chorus-md-styles')).not.toBeInTheDocument();
  });

  it('ChatInput ref.focus() focuses the textarea in headless mode', () => {
    const ref = React.createRef<ChatInputHandle>();
    render(
      <ChatInput
        ref={ref}
        value="hi"
        onChange={() => {}}
        onSend={vi.fn()}
      />,
    );

    act(() => ref.current?.focus({ caret: 'end' }));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(2);
  });

  it('Chorus headless suggestedPrompt and imperative focus both land on the textarea', async () => {
    const user = userEvent.setup();
    const ref = React.createRef<ChorusRef>();
    render(
      <Chorus
        ref={ref}
        suggestedPrompts={['Draft a release note']}
      />,
    );

    const composer = screen.getByRole('textbox');

    await user.click(screen.getByRole('button', { name: 'Draft a release note' }));
    expect(composer).toHaveValue('Draft a release note');
    await waitFor(() => expect(composer).toHaveFocus());

    (composer as HTMLTextAreaElement).blur();
    expect(composer).not.toHaveFocus();

    act(() => ref.current?.focus());
    expect(composer).toHaveFocus();
  });
});
