import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import type { ChorusRef, Message, OnSend } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus imperative ref', () => {
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

  it('exposes ref.retry() to re-run the last turn after a stream error', async () => {
    const ref = React.createRef<ChorusRef>();
    let attempts = 0;
    const onSend = vi.fn<OnSend>(async (_text, _messages, helpers) => {
      attempts += 1;
      if (attempts === 1) throw new Error('first attempt failed');
      helpers.appendAssistant('recovered reply');
      helpers.finalizeAssistant();
    });

    render(<Chorus ref={ref} onSend={onSend} minAssistantDelayMs={0} />);

    // No error yet: retry is a no-op and reports false.
    let earlyRetry: boolean | undefined;
    act(() => { earlyRetry = ref.current?.retry(); });
    expect(earlyRetry).toBe(false);

    act(() => { ref.current?.send('hello'); });
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();

    let retryAccepted: boolean | undefined;
    act(() => { retryAccepted = ref.current?.retry(); });
    expect(retryAccepted).toBe(true);

    expect(await screen.findByText('recovered reply')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it('exposes ref.regenerate(id) to regenerate a specific assistant message', async () => {
    const ref = React.createRef<ChorusRef>();
    const onSend = vi.fn<OnSend>(async () => ({ id: 'a2', role: 'assistant', text: 'regenerated reply' }));

    render(
      <Chorus
        ref={ref}
        initialMessages={[
          { id: 'u1', role: 'user', text: 'first question' },
          { id: 'a1', role: 'assistant', text: 'first answer' },
        ]}
        onSend={onSend}
        minAssistantDelayMs={0}
      />,
    );

    // Unknown id is rejected without touching the transcript.
    let unknownResult: boolean | undefined;
    act(() => { unknownResult = ref.current?.regenerate('missing'); });
    expect(unknownResult).toBe(false);

    let regenAccepted: boolean | undefined;
    act(() => { regenAccepted = ref.current?.regenerate('a1'); });
    expect(regenAccepted).toBe(true);

    expect(await screen.findByText('regenerated reply')).toBeInTheDocument();
    expect(screen.queryByText('first answer')).not.toBeInTheDocument();
    expect(onSend).toHaveBeenCalledWith('first question', expect.any(Array), expect.any(Object));
  });

  it('ref.regenerate returns false for a message with no preceding user turn', () => {
    const ref = React.createRef<ChorusRef>();

    render(
      <Chorus
        ref={ref}
        initialMessages={[{ id: 'a0', role: 'assistant', text: 'orphan assistant' }]}
        onSend={vi.fn<OnSend>(async () => undefined)}
        minAssistantDelayMs={0}
      />,
    );

    let orphanResult: boolean | undefined;
    act(() => { orphanResult = ref.current?.regenerate('a0'); });
    expect(orphanResult).toBe(false);
  });

  it('exposes ref.dismissError() to clear the error banner', async () => {
    const ref = React.createRef<ChorusRef>();
    const onSend = vi.fn<OnSend>(async () => { throw new Error('upstream boom'); });

    render(<Chorus ref={ref} onSend={onSend} minAssistantDelayMs={0} />);

    // No error yet: dismissError is a no-op and reports false.
    let earlyDismiss: boolean | undefined;
    act(() => { earlyDismiss = ref.current?.dismissError(); });
    expect(earlyDismiss).toBe(false);

    act(() => { ref.current?.send('hello'); });
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();

    let dismissed: boolean | undefined;
    act(() => { dismissed = ref.current?.dismissError(); });
    expect(dismissed).toBe(true);
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
  });

  it.each([
    ['disabled', { disabled: true }],
    ['read-only', { readOnly: true }],
  ] as const)('blocks imperative retry/regenerate while %s', (_label, modeProps) => {
    const ref = React.createRef<ChorusRef>();

    render(
      <Chorus
        ref={ref}
        {...modeProps}
        initialMessages={[
          { id: 'u1', role: 'user', text: 'Hello' },
          { id: 'a1', role: 'assistant', text: 'Hi' },
        ]}
        onSend={vi.fn<OnSend>(async () => undefined)}
      />,
    );

    let retryResult: boolean | undefined;
    let regenResult: boolean | undefined;
    act(() => { retryResult = ref.current?.retry(); });
    act(() => { regenResult = ref.current?.regenerate('a1'); });

    expect(retryResult).toBe(false);
    expect(regenResult).toBe(false);
  });

  it.each([
    ['disabled', { disabled: true }],
    ['read-only', { readOnly: true }],
  ] as const)('still allows imperative dismissError() while %s, matching the built-in banner', async (_label, modeProps) => {
    const ref = React.createRef<ChorusRef>();
    const onSend = vi.fn<OnSend>(async () => { throw new Error('upstream boom'); });

    // The Chorus accepts writes long enough to produce a stream error, then the
    // host gates it (`disabled`/`readOnly`). Dismissing the error is not a
    // transcript write, so it must still succeed — exactly like the built-in
    // error banner's dismiss button.
    function Host() {
      const [gated, setGated] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setGated(true)}>gate</button>
          <Chorus ref={ref} {...(gated ? modeProps : {})} onSend={onSend} minAssistantDelayMs={0} />
        </>
      );
    }

    render(<Host />);

    act(() => { ref.current?.send('hello'); });
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'gate' }));

    let dismissed: boolean | undefined;
    act(() => { dismissed = ref.current?.dismissError(); });
    expect(dismissed).toBe(true);
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
  });

  it('rejects imperative retry/regenerate/dismissError in controlled mode without onChange', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ref = React.createRef<ChorusRef>();

      render(
        <Chorus
          ref={ref}
          value={[
            { id: 'u1', role: 'user', text: 'Hello' },
            { id: 'a1', role: 'assistant', text: 'Hi' },
          ]}
          onSend={vi.fn<OnSend>(async () => undefined)}
          minAssistantDelayMs={0}
        />,
      );

      let retryResult: boolean | undefined;
      let regenResult: boolean | undefined;
      let dismissResult: boolean | undefined;
      act(() => { retryResult = ref.current?.retry(); });
      act(() => { regenResult = ref.current?.regenerate('a1'); });
      act(() => { dismissResult = ref.current?.dismissError(); });

      expect(retryResult).toBe(false);
      expect(regenResult).toBe(false);
      expect(dismissResult).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('ref.send resets the composer, discarding attachment chips the user had staged', async () => {
    const user = userEvent.setup();
    const ref = React.createRef<ChorusRef>();
    const onSend = vi.fn<OnSend>(async () => ({ id: 'a1', role: 'assistant', text: 'reply' }));
    const file = new File(['notes'], 'staged.txt', { type: 'text/plain' });

    const { container } = render(
      <Chorus ref={ref} onSend={onSend} accept="text/plain" minAssistantDelayMs={0} />,
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    // Wait for the staged attachment to finish reading so the chip is stable.
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeEnabled());
    expect(screen.getByText('staged.txt')).toBeInTheDocument();

    let accepted: boolean | undefined;
    act(() => { accepted = ref.current?.send('imperative send'); });
    expect(accepted).toBe(true);

    // The imperative send sends its own (empty) attachments argument, so the
    // staged chip was never sent — and after an accepted send it is cleared.
    await waitFor(() => expect(screen.queryByText('staged.txt')).not.toBeInTheDocument());
  });

  it('ref.clear resets the composer, discarding attachment chips the user had staged', async () => {
    const user = userEvent.setup();
    const ref = React.createRef<ChorusRef>();
    const onSend = vi.fn<OnSend>(async () => ({ id: 'a1', role: 'assistant', text: 'reply' }));
    const file = new File(['notes'], 'staged.txt', { type: 'text/plain' });

    const { container } = render(
      <Chorus ref={ref} onSend={onSend} accept="text/plain" minAssistantDelayMs={0} />,
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    // Wait for the staged attachment to finish reading so the chip is stable.
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeEnabled());
    expect(screen.getByText('staged.txt')).toBeInTheDocument();

    let cleared: boolean | undefined;
    act(() => { cleared = ref.current?.clear(); });
    expect(cleared).toBe(true);

    await waitFor(() => expect(screen.queryByText('staged.txt')).not.toBeInTheDocument());
  });

  it('warns once per method when an imperative call is rejected because writes are gated', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const ref = React.createRef<ChorusRef>();
      // Controlled without `onChange`: imperative writes cannot be reflected.
      render(
        <Chorus
          ref={ref}
          value={[
            { id: 'u1', role: 'user', text: 'Hello' },
            { id: 'a1', role: 'assistant', text: 'Hi' },
          ]}
          onSend={vi.fn<OnSend>(async () => undefined)}
          minAssistantDelayMs={0}
        />,
      );

      const rejectionWarnings = () =>
        warn.mock.calls.filter(call => String(call[0]).includes('distinct from an invalid-argument/no-op'));

      act(() => { ref.current?.send('hello'); });
      act(() => { ref.current?.send('hello again'); });

      // The misconfiguration is reported, and explains it is distinct from an
      // ordinary no-op `false` — but only once for the repeated `send` call.
      expect(rejectionWarnings()).toHaveLength(1);
      expect(rejectionWarnings()[0][0]).toContain('`ChorusRef.send()`');
      expect(rejectionWarnings()[0][0]).toContain('controlled');

      // A different imperative method warns on its own.
      act(() => { ref.current?.regenerate('a1'); });
      expect(rejectionWarnings()).toHaveLength(2);
      expect(rejectionWarnings()[1][0]).toContain('`ChorusRef.regenerate()`');
    } finally {
      warn.mockRestore();
    }
  });
});
