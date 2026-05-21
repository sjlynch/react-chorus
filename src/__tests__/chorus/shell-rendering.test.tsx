import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import type { ChorusRef, Message, OnSend } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus shell rendering', () => {
  it('applies className, style, palette variables, and HTML attributes to the root element', () => {
    const { container } = render(
      <Chorus
        id="chorus-root"
        data-testid="chorus-root"
        className="my-chat"
        style={{ height: '500px' }}
        palette={{
          chatBg: '#000',
          actionText: '#111',
          actionHoverBg: '#222',
          actionHoverText: '#333',
          errorBg: '#444',
          errorBorder: '#555',
          errorText: '#666',
          toolHeaderBg: '#777',
        }}
      />
    );

    const root = container.firstElementChild as HTMLElement;

    expect(root).toHaveClass('chorus', 'my-chat');
    expect(root).toHaveAttribute('id', 'chorus-root');
    expect(root).toHaveAttribute('data-testid', 'chorus-root');
    expect(root.style.height).toBe('500px');
    expect(root.style.getPropertyValue('--chorus-chat-bg')).toBe('#000');
    expect(root.style.getPropertyValue('--chorus-action-text')).toBe('#111');
    expect(root.style.getPropertyValue('--chorus-action-hover-bg')).toBe('#222');
    expect(root.style.getPropertyValue('--chorus-action-hover-text')).toBe('#333');
    expect(root.style.getPropertyValue('--chorus-error-bg')).toBe('#444');
    expect(root.style.getPropertyValue('--chorus-error-border')).toBe('#555');
    expect(root.style.getPropertyValue('--chorus-error-text')).toBe('#666');
    expect(root.style.getPropertyValue('--chorus-tool-header-bg')).toBe('#777');
  });

  it('adds the chorus--always-show-actions root class when alwaysShowMessageActions is enabled', () => {
    const { container, rerender } = render(<Chorus />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toHaveClass('chorus--always-show-actions');

    rerender(<Chorus alwaysShowMessageActions />);
    expect(root).toHaveClass('chorus', 'chorus--always-show-actions');
  });

  it('renders per-message timestamps when showTimestamps is enabled', () => {
    const { container } = render(
      <Chorus
        showTimestamps
        initialMessages={[
          { id: 'u1', role: 'user', text: 'Hello', createdAt: '2026-05-20T15:47:06.425Z' },
          { id: 'a1', role: 'assistant', text: 'Hi there', createdAt: '2026-05-20T15:48:00.000Z' },
        ]}
      />
    );

    const times = container.querySelectorAll('time.chorus-msg-time');
    expect(times).toHaveLength(2);
    expect(times[0]).toHaveAttribute('datetime', '2026-05-20T15:47:06.425Z');
    expect(times[1]).toHaveAttribute('datetime', '2026-05-20T15:48:00.000Z');
    expect(times[0].textContent?.trim()).not.toBe('');
  });

  it('does not render per-message timestamps without showTimestamps', () => {
    const { container } = render(
      <Chorus initialMessages={[{ id: 'u1', role: 'user', text: 'Hello', createdAt: '2026-05-20T15:47:06.425Z' }]} />
    );

    expect(container.querySelector('.chorus-msg-time')).not.toBeInTheDocument();
  });

  it('applies a custom formatTimestamp on the Chorus timestamp path', () => {
    render(
      <Chorus
        showTimestamps
        formatTimestamp={(timestamp) => `formatted:${timestamp}`}
        initialMessages={[{ id: 'u1', role: 'user', text: 'Hello', createdAt: '2026-05-20T15:47:06.425Z' }]}
      />
    );

    expect(screen.getByText('formatted:2026-05-20T15:47:06.425Z')).toBeInTheDocument();
  });

  it('seeds feedback through getMessageFeedback', () => {
    const message: Message<{ storedFeedback: 'down' | null }> = {
      id: 'stored-feedback',
      role: 'assistant',
      text: 'Persisted reply',
      metadata: { storedFeedback: 'down' },
    };

    render(
      <Chorus
        initialMessages={[message]}
        onFeedback={vi.fn()}
        getMessageFeedback={(m) => m.metadata?.storedFeedback === 'down' ? 'down' : null}
      />
    );

    expect(screen.getByRole('button', { name: 'Thumbs down' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders initialMessages in uncontrolled mode', () => {
    render(<Chorus initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Welcome!' }]} />);

    expect(screen.getByText('Welcome!')).toBeInTheDocument();
  });

  it('fills and focuses the composer when a suggested prompt is clicked', async () => {
    const user = userEvent.setup();

    render(<Chorus suggestedPrompts={['Plan a launch checklist', 'Write a test plan']} />);

    await user.click(screen.getByRole('button', { name: 'Plan a launch checklist' }));

    const composer = screen.getByRole('textbox', { name: /send a message/i });
    expect(composer).toHaveValue('Plan a launch checklist');
    await waitFor(() => expect(composer).toHaveFocus());
  });

  it.each([
    ['disabled', { disabled: true }],
    ['read-only', { readOnly: true }],
  ] as const)('blocks composer sends, suggested prompts, and imperative send while %s', async (label, modeProps) => {
    const user = userEvent.setup();
    const ref = React.createRef<ChorusRef>();
    const onSend = vi.fn<OnSend>(async () => undefined);

    render(
      <Chorus
        ref={ref}
        {...modeProps}
        disabledReason="Select a conversation first"
        suggestedPrompts={['Plan a launch checklist']}
        onSend={onSend}
      />,
    );

    const composer = screen.getByRole('textbox', { name: /send a message/i });
    const prompt = screen.getByRole('button', { name: 'Plan a launch checklist' });

    if (label === 'disabled') expect(composer).toBeDisabled();
    else expect(composer).toHaveAttribute('readonly');
    expect(composer).toHaveAttribute('placeholder', 'Select a conversation first');
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
    expect(prompt).toBeDisabled();

    await user.click(prompt);
    expect(composer).toHaveValue('');

    let imperativeAccepted: boolean | undefined;
    act(() => { imperativeAccepted = ref.current?.send('imperative send'); });
    expect(imperativeAccepted).toBe(false);
    let imperativeClearAccepted: boolean | undefined;
    act(() => { imperativeClearAccepted = ref.current?.clear(); });
    expect(imperativeClearAccepted).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
  });

  it.each([
    ['disabled', { disabled: true }],
    ['read-only', { readOnly: true }],
  ] as const)('hides write message actions and disables clear while %s', (_label, modeProps) => {
    render(
      <Chorus
        {...modeProps}
        onSend={vi.fn<OnSend>(async () => undefined)}
        messages={[
          { id: 'u1', role: 'user', text: 'Hello' },
          { id: 'a1', role: 'assistant', text: 'Hi' },
        ]}
        showClearButton
      />,
    );

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear conversation' })).toBeDisabled();
  });

  it('prefers custom emptyState over suggestedPrompts', () => {
    render(<Chorus emptyState={<div>Custom welcome</div>} suggestedPrompts={['Hidden prompt']} />);

    expect(screen.getByText('Custom welcome')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hidden prompt' })).not.toBeInTheDocument();
  });
});
