import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../components/ChatInput';
import type { ChatInputProps } from '../components/ChatInput';
import type { AttachmentUploadResult } from '../types';

function ControlledChatInput(props: Partial<ChatInputProps>) {
  const [value, setValue] = useState(props.value ?? '');

  return (
    <ChatInput
      {...props}
      value={value}
      onChange={setValue}
      onSend={props.onSend ?? vi.fn()}
    />
  );
}

function fileTransfer(...files: File[]) {
  return {
    files,
    items: files.map(file => ({ kind: 'file', getAsFile: () => file })),
    types: ['Files'],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

  it('has an accessible name from the placeholder or default label', () => {
    const { rerender } = render(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} placeholder="Ask Chorus" />);

    expect(screen.getByRole('textbox', { name: 'Ask Chorus' })).toBeInTheDocument();

    rerender(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} />);

    expect(screen.getByRole('textbox', { name: 'Send a message' })).toBeInTheDocument();
  });

  it('grows as multiple lines are typed and collapses after send', async () => {
    const user = userEvent.setup();
    render(<ControlledChatInput />);

    const textarea = screen.getByRole('textbox');
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 120 });

    await user.type(textarea, 'Hello{Shift>}{Enter}{/Shift}world');

    expect(textarea).toHaveValue('Hello\nworld');
    expect(textarea).toHaveStyle({ height: '120px' });

    await user.click(screen.getByRole('button', { name: /send/i }));

    expect((textarea as HTMLTextAreaElement).style.height).toBe('');
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
    expect(await screen.findByAltText('photo.png')).toHaveAttribute('loading', 'lazy');
    expect(screen.getByAltText('photo.png')).toHaveAttribute('decoding', 'async');
    await user.click(screen.getByRole('button', { name: /remove photo\.png/i }));

    expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
  });

  it('attaches accepted files pasted from the clipboard', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const file = new File(['image-bytes'], 'pasted.png', { type: 'image/png' });
    render(<ControlledChatInput onSend={onSend} accept="image/*" />);

    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: fileTransfer(file) });

    expect(await screen.findByText('pasted.png')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'pasted.png',
        type: 'image/png',
        data: expect.stringMatching(/^data:image\/png;base64,/),
      }),
    ]);
  });

  it('attaches accepted files dropped onto the composer', async () => {
    const file = new File(['drop-bytes'], 'dropped.png', { type: 'image/png' });
    render(<ControlledChatInput accept="image/*" />);

    fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: fileTransfer(file) });

    expect(await screen.findByText('dropped.png')).toBeInTheDocument();
  });

  it('rejects oversized files and calls onAttachmentError with a useful reason', async () => {
    const onAttachmentError = vi.fn();
    const file = new File(['too large'], 'large.txt', { type: 'text/plain' });
    render(<ControlledChatInput accept="text/plain" maxAttachmentBytes={3} onAttachmentError={onAttachmentError} />);

    fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: fileTransfer(file) });

    await waitFor(() => expect(onAttachmentError).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'too-large',
      source: 'drop',
      file,
      maxAttachmentBytes: 3,
    })));
    expect(screen.queryByText('large.txt')).not.toBeInTheDocument();
  });

  it('rejects pasted files that do not match accept', async () => {
    const onAttachmentError = vi.fn();
    const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    render(<ControlledChatInput accept="image/*" onAttachmentError={onAttachmentError} />);

    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: fileTransfer(file) });

    await waitFor(() => expect(onAttachmentError).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'unsupported-type',
      source: 'paste',
      file,
      accept: 'image/*',
    })));
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument();
  });

  it('enforces maxAttachments while keeping accepted files', async () => {
    const onAttachmentError = vi.fn();
    const first = new File(['one'], 'one.png', { type: 'image/png' });
    const second = new File(['two'], 'two.png', { type: 'image/png' });
    render(<ControlledChatInput accept="image/*" maxAttachments={1} onAttachmentError={onAttachmentError} />);

    fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: fileTransfer(first, second) });

    expect(await screen.findByText('one.png')).toBeInTheDocument();
    expect(screen.queryByText('two.png')).not.toBeInTheDocument();
    await waitFor(() => expect(onAttachmentError).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'too-many',
      source: 'drop',
      file: second,
      maxAttachments: 1,
    })));
  });

  it('shows a pending upload chip and disables send until uploadAttachment resolves', async () => {
    const upload = deferred<AttachmentUploadResult>();
    const uploadAttachment = vi.fn(() => upload.promise);
    const file = new File(['image-bytes'], 'slow.png', { type: 'image/png' });
    const { container } = render(<ControlledChatInput accept="image/*" uploadAttachment={uploadAttachment} />);

    fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: fileTransfer(file) });

    expect(await screen.findByText('slow.png')).toBeInTheDocument();
    expect(container.querySelector('.chorus-attachment-chip--pending')).toBeInTheDocument();
    expect(container.querySelector('.chorus-attachment-spinner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();

    upload.resolve({
      name: 'slow.png',
      type: 'image/png',
      size: file.size,
      url: 'https://cdn.example.com/slow.png',
    });

    await waitFor(() => expect(container.querySelector('.chorus-attachment-chip--pending')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /send/i })).toBeEnabled();
  });

  it('removes a pending upload chip and reports upload-failed when uploadAttachment rejects', async () => {
    const upload = deferred<AttachmentUploadResult>();
    const uploadAttachment = vi.fn(() => upload.promise);
    const onAttachmentError = vi.fn();
    const file = new File(['image'], 'broken.png', { type: 'image/png' });
    const { container } = render(<ControlledChatInput accept="image/*" uploadAttachment={uploadAttachment} onAttachmentError={onAttachmentError} />);

    fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: fileTransfer(file) });
    expect(await screen.findByText('broken.png')).toBeInTheDocument();
    expect(container.querySelector('.chorus-attachment-chip--pending')).toBeInTheDocument();

    upload.reject(new Error('network down'));

    await waitFor(() => expect(onAttachmentError).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'upload-failed',
      source: 'drop',
      file,
    })));
    await waitFor(() => expect(screen.queryByText('broken.png')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('uses uploadAttachment results instead of forcing data URLs', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const uploadAttachment = vi.fn(async (file: File) => ({
      name: file.name,
      type: file.type,
      size: file.size,
      url: 'https://cdn.example.com/uploaded.png',
      id: 'file_123',
    }));
    const file = new File(['image-bytes'], 'uploaded.png', { type: 'image/png' });
    render(<ControlledChatInput accept="image/*" uploadAttachment={uploadAttachment} onSend={onSend} />);

    fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: fileTransfer(file) });
    await waitFor(() => expect(screen.getByText('uploaded.png')).toBeInTheDocument());

    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(uploadAttachment).toHaveBeenCalledWith(file);
    expect(onSend).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'uploaded.png',
        url: 'https://cdn.example.com/uploaded.png',
        id: 'file_123',
        data: 'https://cdn.example.com/uploaded.png',
      }),
    ]);
  });
});
