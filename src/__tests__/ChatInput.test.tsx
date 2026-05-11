import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../components/ChatInput';
import type { ChatInputProps } from '../components/ChatInput';

function ControlledChatInput(props: Partial<ChatInputProps>) {
  const [value, setValue] = useState(props.value ?? '');

  return (
    <ChatInput
      value={value}
      onChange={setValue}
      onSend={props.onSend ?? vi.fn()}
      onStop={props.onStop}
      placeholder={props.placeholder}
      sending={props.sending}
      accept={props.accept}
    />
  );
}

describe('ChatInput', () => {
  it('sends textarea contents on Enter', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ControlledChatInput onSend={onSend} />);

    await user.type(screen.getByRole('textbox'), 'Hello{Enter}');

    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith([]);
  });

  it('does not send on Shift+Enter and inserts a newline', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ControlledChatInput onSend={onSend} />);

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Hello{Shift>}{Enter}{/Shift}world');

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('Hello\nworld');
  });

  it('disables the send button when textarea is empty and no attachments are present', () => {
    render(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} />);

    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('enables the send button when textarea has text', () => {
    render(<ChatInput value="Hello" onChange={vi.fn()} onSend={vi.fn()} />);

    expect(screen.getByRole('button', { name: /send/i })).toBeEnabled();
  });

  it('calls onSend and clears attachments when the send button is clicked', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const { container } = render(<ControlledChatInput onSend={onSend} accept="text/plain" />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await screen.findByText('notes.txt');

    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'notes.txt',
        type: 'text/plain',
        size: file.size,
        data: expect.stringMatching(/^data:text\/plain;base64,/),
      }),
    ]);
    await waitFor(() => expect(screen.queryByText('notes.txt')).not.toBeInTheDocument());
  });

  it('shows the stop button when sending=true', () => {
    render(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} sending />);

    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('calls onStop when the stop button is clicked', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} onStop={onStop} sending />);

    await user.click(screen.getByRole('button', { name: /stop/i }));

    expect(onStop).toHaveBeenCalledOnce();
  });

  it('hides the attach button when accept prop is not provided', () => {
    render(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /attach file/i })).not.toBeInTheDocument();
  });

  it('shows the attach button when accept prop is provided', () => {
    render(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} accept="image/*" />);

    expect(screen.getByRole('button', { name: /attach file/i })).toBeInTheDocument();
  });

  it('renders attachments as chips and removes them with the X button', async () => {
    const user = userEvent.setup();
    const file = new File(['image-bytes'], 'photo.png', { type: 'image/png' });
    const { container } = render(<ControlledChatInput accept="image/*" />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(await screen.findByText('photo.png')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /remove photo\.png/i }));

    expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
  });
});
