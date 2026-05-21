import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { sendMessage } from './testUtils';
import type { OnSend, Transport } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus onSend and transport abort lifecycle', () => {
  it('calls onAbort with the partial assistant when Stop cancels streamed onSend output', async () => {
    const user = userEvent.setup();
    const onAbort = vi.fn();
    let capturedSignal: AbortSignal | undefined;
    const onSend = vi.fn<OnSend>((_text, _messages, helpers) => {
      capturedSignal = helpers.signal;
      helpers.appendAssistant('partial abort');
      return new Promise<void>((_resolve, reject) => {
        helpers.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} onAbort={onAbort} />);

    await sendMessage(user, 'stop after token');
    expect(await screen.findByText('partial abort')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /stop/i }));

    await waitFor(() => expect(onAbort).toHaveBeenCalledOnce());
    expect(capturedSignal?.aborted).toBe(true);
    expect(onAbort.mock.calls[0][0]).toEqual(expect.objectContaining({
      reason: 'stop',
      source: 'user',
      path: 'onSend',
      message: expect.objectContaining({ role: 'assistant', text: 'partial abort' }),
    }));
    expect(onAbort.mock.calls[0][0].messages).toEqual([
      expect.objectContaining({ role: 'user', text: 'stop after token' }),
      expect.objectContaining({ role: 'assistant', text: 'partial abort' }),
    ]);
  });

  it('calls onAbort with a null assistant when Stop happens before the first transport token', async () => {
    const user = userEvent.setup();
    const onAbort = vi.fn();
    let capturedSignal: AbortSignal | undefined;
    const transport = vi.fn<Transport>((_text, _history, signal) => {
      capturedSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        }, { once: true });
      });
    });

    render(<Chorus transport={transport} connector="openai" minAssistantDelayMs={0} onAbort={onAbort} />);

    await sendMessage(user, 'stop before token');
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /stop/i }));

    await waitFor(() => expect(onAbort).toHaveBeenCalledOnce());
    expect(capturedSignal?.aborted).toBe(true);
    expect(onAbort.mock.calls[0][0]).toEqual(expect.objectContaining({
      reason: 'stop',
      source: 'user',
      path: 'transport',
      message: null,
    }));
    expect(onAbort.mock.calls[0][0].messages).toEqual([
      expect.objectContaining({ role: 'user', text: 'stop before token' }),
    ]);
  });
});
