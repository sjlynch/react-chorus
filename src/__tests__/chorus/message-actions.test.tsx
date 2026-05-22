import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { sendMessage, sseResponse, erroringSSEResponse, deferred } from './testUtils';
import type { ChorusRef, Message, OnSend, OnSendHelpers, Transport } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus message actions', () => {
  it('controlled mode forwards new messages via onChange and renders the externally-controlled list', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [{ id: 'seed', role: 'assistant', text: 'seeded reply' }];
    const onChange = vi.fn<(next: Message[]) => void>();
    const onSend = vi.fn(async () => undefined);

    render(<Chorus value={initial} onChange={onChange} onSend={onSend} minAssistantDelayMs={0} />);

    // The externally-controlled list is rendered as-is.
    expect(screen.getByText('seeded reply')).toBeInTheDocument();

    await sendMessage(user, 'hello there');

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const latestCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(latestCall).toEqual(
      expect.arrayContaining([
        initial[0],
        expect.objectContaining({ role: 'user', text: 'hello there' }),
      ]),
    );
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('Retry re-triggers the assistant with the last user text', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([], 500));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await sendMessage(user, 'try again');
    await screen.findByRole('button', { name: /retry/i });

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    expect(transport.mock.calls[0][0]).toBe('try again');
    expect(transport.mock.calls[1][0]).toBe('try again');
  });

  it('Retry resubmits an image-only message with its attachment', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => sseResponse([], 500));
    const file = new File(['image-bytes'], 'photo.png', { type: 'image/png' });
    const { container } = render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} accept="image/*" />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await screen.findByText('photo.png');

    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByRole('button', { name: /retry/i });

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    expect(transport.mock.calls[1][0]).toBe('');
    expect(transport.mock.calls[1][1]).toEqual([
      expect.objectContaining({
        role: 'user',
        text: '',
        attachments: [expect.objectContaining({
          name: 'photo.png',
          type: 'image/png',
          size: file.size,
          data: expect.stringMatching(/^data:image\/png;base64,/),
        })],
      }),
    ]);
  });

  it('Retry preserves a text-and-attachment turn without duplicating it', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => (
      transport.mock.calls.length === 1
        ? sseResponse([], 500)
        : sseResponse(['ok'])
    ));
    const file = new File(['image-bytes'], 'photo.png', { type: 'image/png' });
    const { container } = render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} accept="image/*" />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await screen.findByText('photo.png');
    await sendMessage(user, 'describe this');
    await screen.findByRole('button', { name: /retry/i });

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    const retryHistory = transport.mock.calls[1][1];
    const userTurns = retryHistory.filter(message => message.role === 'user');
    expect(userTurns).toHaveLength(1);
    expect(userTurns[0]).toEqual(expect.objectContaining({
      role: 'user',
      text: 'describe this',
      attachments: [expect.objectContaining({
        name: 'photo.png',
        type: 'image/png',
        size: file.size,
        data: expect.stringMatching(/^data:image\/png;base64,/),
      })],
    }));
    expect(screen.getAllByText('describe this')).toHaveLength(1);
    await waitFor(() => expect(screen.getAllByAltText('Attached image: photo.png')).toHaveLength(1));
  });

  it('removes a failed partial transport response before retrying', async () => {
    const user = userEvent.setup();
    const transport = vi.fn<Transport>(async () => (
      transport.mock.calls.length === 1
        ? erroringSSEResponse(['partial answer'])
        : sseResponse(['fresh answer'])
    ));

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await sendMessage(user, 'try again');

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('partial answer')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText('fresh answer')).toHaveLength(1));
    expect(transport.mock.calls[1][1]).toEqual([
      expect.objectContaining({ role: 'user', text: 'try again' }),
    ]);
    expect(transport.mock.calls[1][1]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'partial answer' })]),
    );
  });

  it('blocks built-in sends during an active transport request even when sending is visually overridden false', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const transport = vi.fn<Transport>(() => new Promise<Response>(() => undefined));
    const file = new File(['image-bytes'], 'blocked.png', { type: 'image/png' });

    const { container } = render(<Chorus transport={transport} sending={false} minAssistantDelayMs={0} accept="image/*" />);

    await sendMessage(user, 'first');
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await screen.findByText('blocked.png');
    await sendMessage(user, 'second');

    expect(transport).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('first')).toHaveLength(1);
    expect(screen.getByRole('log')).not.toHaveTextContent('second');
    expect(screen.getByText('blocked.png')).toBeInTheDocument();
    warn.mockRestore();
  });

  it('Stop button aborts the active transport stream', async () => {
    const user = userEvent.setup();
    let capturedSignal: AbortSignal | undefined;
    const transport = vi.fn((_text: string, _history: Message[], signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await sendMessage(user, 'stop me');
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /stop/i }));

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('handleEdit truncates the message list at the edited index and re-triggers', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'original' },
      { id: 'a1', role: 'assistant', text: 'first answer' },
      { id: 'u2', role: 'user', text: 'follow up' },
      { id: 'a2', role: 'assistant', text: 'second answer' },
    ];
    const onSend = vi.fn(() => new Promise<void>(() => undefined));

    render(<Chorus messages={initial} onSend={onSend} />);

    await user.click(screen.getAllByTitle('Edit')[0]);
    const editBox = screen.getByDisplayValue('original');
    await user.clear(editBox);
    await user.type(editBox, 'edited');
    await user.click(screen.getByTitle('Save'));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      'edited',
      expect.any(Array),
      expect.any(Object),
    ));
    expect(screen.getByText('edited')).toBeInTheDocument();
    expect(screen.queryByText('first answer')).not.toBeInTheDocument();
    expect(screen.queryByText('follow up')).not.toBeInTheDocument();
    expect(screen.queryByText('second answer')).not.toBeInTheDocument();
  });

  it('handleRegenerate removes the assistant message and re-triggers with the preceding user text', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'question' },
      { id: 'a1', role: 'assistant', text: 'old answer' },
    ];
    const onSend = vi.fn(() => new Promise<void>(() => undefined));

    render(<Chorus messages={initial} onSend={onSend} />);

    await user.click(screen.getByTitle('Regenerate'));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      'question',
      expect.any(Array),
      expect.any(Object),
    ));
    expect(screen.getByText('question')).toBeInTheDocument();
    expect(screen.queryByText('old answer')).not.toBeInTheDocument();
  });

  it('handleDelete removes the message from the list', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'remove me' },
      { id: 'a1', role: 'assistant', text: 'keep me' },
    ];

    render(<Chorus messages={initial} />);

    await user.click(screen.getAllByTitle('Delete')[0]);

    expect(screen.queryByText('remove me')).not.toBeInTheDocument();
    expect(screen.getByText('keep me')).toBeInTheDocument();
  });

  it('deleting the errored user turn dismisses the banner and disarms Retry', async () => {
    const user = userEvent.setup();
    const ref = React.createRef<ChorusRef>();
    const transport = vi.fn<Transport>(async () => erroringSSEResponse([]));

    render(<Chorus ref={ref} transport={transport} connector="openai" minAssistantDelayMs={0} />);

    await sendMessage(user, 'doomed turn');

    // Stream error: the banner is armed while the user message stays visible.
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    await screen.findByRole('button', { name: /retry/i });

    // The host deletes the user message tied to the error.
    await user.click(screen.getByTitle('Delete'));

    // The banner and its Retry button are gone with the message that caused them.
    expect(screen.queryByText('doomed turn')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();

    // Retry is disarmed: it no longer references — and cannot resurrect — the deleted turn.
    let retryAfterDelete: boolean | undefined;
    act(() => { retryAfterDelete = ref.current?.retry(); });
    expect(retryAfterDelete).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('doomed turn')).not.toBeInTheDocument();
  });

  it('hides the built-in Delete action on prior messages while a send is streaming', async () => {
    const user = userEvent.setup();
    const initial: Message[] = [
      { id: 'u1', role: 'user', text: 'prior turn' },
      { id: 'a1', role: 'assistant', text: 'prior reply' },
    ];
    const pending = deferred<void>();
    const onSend = vi.fn<OnSend>((_text, _messages, helpers) => {
      helpers.appendAssistant('streaming…');
      return pending.promise;
    });

    render(<Chorus messages={initial} onSend={onSend} minAssistantDelayMs={0} />);

    // Delete buttons present in the idle state.
    expect(screen.getAllByTitle('Delete')).toHaveLength(2);

    await sendMessage(user, 'next');

    expect(await screen.findByText('streaming…')).toBeInTheDocument();

    // No Delete buttons anywhere while sending.
    expect(screen.queryAllByTitle('Delete')).toHaveLength(0);

    pending.resolve();
  });

  it('keeps the streaming assistant message intact when delete is suppressed during a send', async () => {
    const user = userEvent.setup();
    let helpers!: OnSendHelpers;
    const pending = deferred<void>();
    const onFinish = vi.fn();
    const onSend = vi.fn<OnSend>((_text, _messages, h) => {
      helpers = h;
      h.appendAssistant('partial');
      return pending.promise;
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} onFinish={onFinish} />);

    await sendMessage(user, 'go');

    // First token rendered into a streaming assistant message; Delete is suppressed.
    expect(await screen.findByText('partial')).toBeInTheDocument();
    expect(screen.queryAllByTitle('Delete')).toHaveLength(0);

    // Subsequent chunks still land in the streaming message (no orphaned pending state).
    act(() => { helpers.appendAssistant(' done'); });
    act(() => { helpers.finalizeAssistant(); });
    pending.resolve();

    await waitFor(() => expect(onFinish).toHaveBeenCalledOnce());
    expect(onFinish.mock.calls[0][0]).toEqual(expect.objectContaining({
      reason: 'done',
      message: expect.objectContaining({ role: 'assistant', text: 'partial done' }),
    }));
    expect(screen.getByText('partial done')).toBeInTheDocument();
  });
});
