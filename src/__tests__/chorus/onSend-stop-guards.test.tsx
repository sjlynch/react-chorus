import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { sendMessage } from './testUtils';
import type { Message, OnSendHelpers } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus onSend stop guards', () => {
  it('onSend abort (user stop) does not invoke onError and shows no banner', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    let capturedSignal: AbortSignal | undefined;
    const onSend = vi.fn((_text: string, _messages: Message[], helpers: OnSendHelpers) => {
      capturedSignal = helpers.signal;
      return new Promise<void>((_resolve, reject) => {
        helpers.signal.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    render(<Chorus onSend={onSend} onError={onError} minAssistantDelayMs={0} />);

    await sendMessage(user, 'stop me');
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /stop/i }));

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(onError).not.toHaveBeenCalled();
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
  });

  it('ignores captured onSend helpers after Stop', async () => {
    const user = userEvent.setup();
    let helpers!: OnSendHelpers;
    const onSend = vi.fn((_text: string, _messages: Message[], h: OnSendHelpers) => {
      helpers = h;
      return new Promise<void>(() => undefined);
    });

    render(<Chorus onSend={onSend} minAssistantDelayMs={0} />);

    await sendMessage(user, 'stop stale helpers');
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /stop/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());

    act(() => {
      helpers.appendAssistant('late chunk');
      helpers.finalizeAssistant();
    });

    expect(screen.queryByText('late chunk')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });
});
