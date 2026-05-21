import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chorus } from '../../Chorus';
import { sendMessage, sseResponse } from './testUtils';
import type { OnSend, Transport } from './testUtils';

vi.mock('../../components/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

describe('Chorus observer error isolation', () => {
  it('ignores throwing onChunk observers on the transport path', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onChunk = vi.fn(() => { throw new Error('analytics failed'); });
    const transport = vi.fn<Transport>(async () => sseResponse(['safe']));

    render(<Chorus transport={transport} onChunk={onChunk} minAssistantDelayMs={0} />);

    await sendMessage(user, 'hello');

    expect(await screen.findByText('safe')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`onChunk` callback threw'), expect.any(Error));
    warn.mockRestore();
  });

  it('ignores throwing onChunk observers on the onSend helper path', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onChunk = vi.fn(() => { throw new Error('analytics failed'); });
    const onSend = vi.fn<OnSend>(async (_text, _messages, helpers) => {
      helpers.appendAssistant('helper safe');
      helpers.finalizeAssistant();
    });

    render(<Chorus onSend={onSend} onChunk={onChunk} minAssistantDelayMs={0} />);

    await sendMessage(user, 'hello');

    expect(await screen.findByText('helper safe')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument());
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`onChunk` callback threw'), expect.any(Error));
    warn.mockRestore();
  });
});
