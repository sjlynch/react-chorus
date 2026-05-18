import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import type { ChorusRef, Message, OnSend } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus', () => {
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

  it('exposes an imperative ChorusRef for send, focus, clear, stop, and scrollToMessage', async () => {
    const ref = React.createRef<ChorusRef>();
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const onSend = vi.fn<OnSend>(async () => ({ id: 'a1', role: 'assistant', text: 'ref reply' }));

    render(<Chorus ref={ref} onSend={onSend} minAssistantDelayMs={0} showClearButton />);

    act(() => ref.current?.focus());
    expect(screen.getByRole('textbox')).toHaveFocus();

    let sendAccepted: boolean | undefined;
    act(() => { sendAccepted = ref.current?.send('hi from ref'); });
    expect(sendAccepted).toBe(true);
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('hi from ref', expect.any(Array), expect.any(Object)));
    expect(await screen.findByText('ref reply')).toBeInTheDocument();
    expect(ref.current?.getMessages()).toEqual([
      expect.objectContaining({ role: 'user', text: 'hi from ref' }),
      expect.objectContaining({ id: 'a1', role: 'assistant', text: 'ref reply' }),
    ]);

    let scrolled: boolean | undefined;
    act(() => { scrolled = ref.current?.scrollToMessage('a1'); });
    expect(scrolled).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

    act(() => ref.current?.stop());
    let clearAccepted: boolean | undefined;
    act(() => { clearAccepted = ref.current?.clear(); });
    expect(clearAccepted).toBe(true);
    expect(ref.current?.getMessages()).toEqual([]);
    expect(screen.queryByText('hi from ref')).not.toBeInTheDocument();
  });

  it('ref.send returns false when the send would silently drop or be rejected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Controlled mode without onChange: dev warning fires and ref.send is a no-op.
      const controlledRef = React.createRef<ChorusRef>();
      const controlledOnSend = vi.fn<OnSend>(async () => ({ id: 'a1', role: 'assistant', text: 'reply' }));
      render(
        <Chorus
          ref={controlledRef}
          value={[]}
          onSend={controlledOnSend}
          minAssistantDelayMs={0}
        />,
      );

      let accepted: boolean | undefined;
      act(() => { accepted = controlledRef.current?.send('hello'); });
      expect(accepted).toBe(false);
      expect(controlledOnSend).not.toHaveBeenCalled();

      // No transport / no onSend configured: ref.send is also rejected.
      const noHandlerRef = React.createRef<ChorusRef>();
      render(<Chorus ref={noHandlerRef} minAssistantDelayMs={0} />);
      let noHandlerAccepted: boolean | undefined;
      act(() => { noHandlerAccepted = noHandlerRef.current?.send('hi'); });
      expect(noHandlerAccepted).toBe(false);

      // Empty text + no attachments: rejected.
      const emptyRef = React.createRef<ChorusRef>();
      const emptyOnSend = vi.fn<OnSend>(async () => ({ id: 'a2', role: 'assistant', text: '' }));
      render(<Chorus ref={emptyRef} onSend={emptyOnSend} minAssistantDelayMs={0} />);
      let emptyAccepted: boolean | undefined;
      act(() => { emptyAccepted = emptyRef.current?.send('   '); });
      expect(emptyAccepted).toBe(false);
      expect(emptyOnSend).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('ref.send returns true and ref.clear returns true on a successful controlled send', async () => {
    const ref = React.createRef<ChorusRef>();
    const onSend = vi.fn<OnSend>(async () => ({ id: 'a1', role: 'assistant', text: 'controlled reply' }));

    function Host() {
      const [messages, setMessages] = React.useState<Message[]>([]);
      return (
        <Chorus
          ref={ref}
          value={messages}
          onChange={setMessages}
          onSend={onSend}
          minAssistantDelayMs={0}
        />
      );
    }

    render(<Host />);

    let sendAccepted: boolean | undefined;
    act(() => { sendAccepted = ref.current?.send('hi controlled'); });
    expect(sendAccepted).toBe(true);
    await waitFor(() => expect(onSend).toHaveBeenCalled());

    let clearAccepted: boolean | undefined;
    act(() => { clearAccepted = ref.current?.clear(); });
    expect(clearAccepted).toBe(true);
  });

  it('scrollToMessage targets custom renderMessage rows that spread messageProps', () => {
    const ref = React.createRef<ChorusRef>();
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(
      <Chorus
        ref={ref}
        messages={[{ id: 'a1', role: 'assistant', text: 'Custom reply' }]}
        renderMessage={(message, ctx) => (
          <article {...ctx.messageProps} data-testid="custom-message">
            {message.text}
          </article>
        )}
      />
    );

    const customMessage = screen.getByTestId('custom-message');
    let scrolled: boolean | undefined;
    act(() => { scrolled = ref.current?.scrollToMessage('a1'); });

    expect(scrolled).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts[0]).toBe(customMessage);
  });

  it('scrollToMessage returns false when the id is not among rendered messages', () => {
    const ref = React.createRef<ChorusRef>();
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(
      <Chorus
        ref={ref}
        messages={[
          { id: 's1', role: 'system', text: 'Hidden system prompt' },
          { id: 'u1', role: 'user', text: 'Visible user message' },
        ]}
      />
    );

    expect(screen.queryByText('Hidden system prompt')).not.toBeInTheDocument();

    let hiddenResult: boolean | undefined;
    act(() => { hiddenResult = ref.current?.scrollToMessage('s1'); });
    let missingResult: boolean | undefined;
    act(() => { missingResult = ref.current?.scrollToMessage('missing-id'); });

    expect(hiddenResult).toBe(false);
    expect(missingResult).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('renders initialMessages in uncontrolled mode', () => {
    render(<Chorus initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Welcome!' }]} />);

    expect(screen.getByText('Welcome!')).toBeInTheDocument();
  });

  it('observes uncontrolled initial messages, streams, and clear without requiring controlled state', async () => {
    const user = userEvent.setup();
    const onMessagesChange = vi.fn();
    const onSend = vi.fn<OnSend>(async (_text, _messages, helpers) => {
      helpers.appendAssistant('streamed ');
      helpers.appendAssistant('reply');
      helpers.finalizeAssistant();
    });

    render(
      <Chorus
        initialMessages={[{ id: 'welcome', role: 'assistant', text: 'Welcome!' }]}
        onMessagesChange={onMessagesChange}
        onSend={onSend}
        minAssistantDelayMs={0}
        showClearButton
      />,
    );

    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'welcome', text: 'Welcome!' })],
      expect.objectContaining({ source: 'uncontrolled', reason: 'initial' }),
    ));

    await user.type(screen.getByPlaceholderText('Send a message'), 'observe me');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ role: 'assistant', text: 'streamed reply' })]),
      expect.objectContaining({ source: 'uncontrolled', reason: 'assistant' }),
    ));

    await user.click(screen.getAllByTitle('Delete')[0]);
    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledWith(
      expect.not.arrayContaining([expect.objectContaining({ id: 'welcome' })]),
      expect.objectContaining({ source: 'uncontrolled', reason: 'delete' }),
    ));

    await user.click(screen.getByRole('button', { name: /clear conversation/i }));
    await waitFor(() => expect(onMessagesChange).toHaveBeenLastCalledWith([], expect.objectContaining({ reason: 'clear' })));
  });

  it('observes controlled value updates without broadening onChange beyond controlled mode', async () => {
    const user = userEvent.setup();
    const onMessagesChange = vi.fn();
    const onChange = vi.fn<(messages: Message[]) => void>();

    function Harness() {
      const [messages, setMessages] = React.useState<Message[]>([{ id: 'seed', role: 'assistant', text: 'controlled seed' }]);
      return (
        <Chorus
          value={messages}
          onChange={(next) => {
            onChange(next);
            setMessages(next);
          }}
          onMessagesChange={onMessagesChange}
          onSend={() => ({ id: 'controlled-assistant', role: 'assistant', text: 'controlled reply' })}
          minAssistantDelayMs={0}
        />
      );
    }

    render(<Harness />);

    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'seed' })],
      expect.objectContaining({ source: 'controlled' }),
    ));

    await user.type(screen.getByPlaceholderText('Send a message'), 'controlled send');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(screen.getByText('controlled reply')).toBeInTheDocument());
    expect(onChange).toHaveBeenCalled();
    expect(onMessagesChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'controlled-assistant', text: 'controlled reply' })]),
      expect.objectContaining({ source: 'controlled', reason: 'assistant' }),
    );
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
