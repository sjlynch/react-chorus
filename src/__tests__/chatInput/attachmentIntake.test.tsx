import { describe, it, expect, vi } from 'vitest';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ChatInput,
  ControlledChatInput,
  dropFiles,
  fileTransfer,
  pasteFiles,
} from './testUtils';

describe('ChatInput attachment intake', () => {
  it('hides the attach button when accept prop is not provided', () => {
    render(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /attach file/i })).not.toBeInTheDocument();
  });
  it('shows the attach button when accept prop is provided', () => {
    render(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} accept="image/*" />);

    expect(screen.getByRole('button', { name: /attach file/i })).toBeInTheDocument();
  });
  it('treats an empty or whitespace-only accept string as no attachments allowed', async () => {
    const uploadAttachment = vi.fn();
    const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    const { container, rerender } = render(<ControlledChatInput accept="" uploadAttachment={uploadAttachment} />);
    const local = within(container);

    // Empty accept: no attach button and no unfiltered hidden file picker.
    expect(local.queryByRole('button', { name: /attach file/i })).not.toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();

    // Whitespace-only accept is treated the same way.
    rerender(<ControlledChatInput accept="   " uploadAttachment={uploadAttachment} />);
    expect(local.queryByRole('button', { name: /attach file/i })).not.toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();

    // Pasting a file is ignored rather than ingested.
    await pasteFiles(local.getByRole('textbox'), file);
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(local.queryByText('notes.txt')).not.toBeInTheDocument();
  });
  it('treats maxAttachmentBytes=0 as no files allowed rather than unlimited', async () => {
    const onAttachmentError = vi.fn();
    // A zero-byte file would slip past a `size > limit` check when the limit is 0.
    const file = new File([], 'empty.png', { type: 'image/png' });
    const { container } = render(
      <ControlledChatInput accept="image/*" maxAttachmentBytes={0} onAttachmentError={onAttachmentError} />,
    );
    const local = within(container);

    await dropFiles(local.getByRole('textbox'), file);

    await waitFor(() => expect(onAttachmentError).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'too-large',
      file,
      maxAttachmentBytes: 0,
    })));
    expect(local.queryByText('empty.png')).not.toBeInTheDocument();
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
    const uploadAttachment = vi.fn(async (incoming: File) => ({
      name: incoming.name,
      type: incoming.type,
      size: incoming.size,
      data: 'data:image/png;base64,cGFzdGVk',
    }));
    const { container } = render(<ControlledChatInput onSend={onSend} accept="image/*" uploadAttachment={uploadAttachment} />);
    const local = within(container);

    await pasteFiles(local.getByRole('textbox'), file);

    expect(await local.findByText('pasted.png')).toBeInTheDocument();
    await waitFor(() => expect(local.getByRole('button', { name: /send/i })).toBeEnabled());
    await user.click(local.getByRole('button', { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'pasted.png',
        type: 'image/png',
        data: 'data:image/png;base64,cGFzdGVk',
      }),
    ]);
  });
  it('attaches accepted files dropped onto the composer', async () => {
    const file = new File(['drop-bytes'], 'dropped.png', { type: 'image/png' });
    const uploadAttachment = vi.fn(async (incoming: File) => ({
      name: incoming.name,
      type: incoming.type,
      size: incoming.size,
      data: 'data:image/png;base64,ZHJvcA==',
    }));
    const { container } = render(<ControlledChatInput accept="image/*" uploadAttachment={uploadAttachment} />);
    const local = within(container);

    await dropFiles(local.getByRole('textbox'), file);

    expect(await local.findByText('dropped.png')).toBeInTheDocument();
    expect(uploadAttachment).toHaveBeenCalledWith(file, { signal: expect.any(AbortSignal) });
  });
  it('clears the drag overlay when the window drag ends without a drop', async () => {
    const file = new File(['drop-bytes'], 'dragged.png', { type: 'image/png' });
    const { container } = render(<ControlledChatInput accept="image/*" />);
    const root = container.firstElementChild as HTMLElement;

    await act(async () => {
      fireEvent.dragEnter(root, { dataTransfer: fileTransfer(file) });
    });
    expect(root).toHaveClass('chorus-input--dragging');

    await act(async () => {
      fireEvent.dragEnd(window);
    });

    expect(root).not.toHaveClass('chorus-input--dragging');
  });
  it('renders the drop overlay inside the composer root when used without a .chorus surface', async () => {
    const file = new File(['drop-bytes'], 'dragged.png', { type: 'image/png' });
    const { container } = render(<ControlledChatInput accept="image/*" />);
    const root = container.firstElementChild as HTMLElement;

    await act(async () => {
      fireEvent.dragEnter(root, { dataTransfer: fileTransfer(file) });
    });

    // No surrounding `.chorus` to portal onto, so the overlay falls back to the
    // composer root rather than being dropped on document.body.
    const overlay = container.querySelector('.chorus-drop-overlay');
    expect(overlay).not.toBeNull();
    expect(root.contains(overlay)).toBe(true);
  });
  it('rejects oversized files and calls onAttachmentError with a useful reason', async () => {
    const onAttachmentError = vi.fn();
    const file = new File(['too large'], 'large.txt', { type: 'text/plain' });
    const { container } = render(<ControlledChatInput accept="text/plain" maxAttachmentBytes={3} onAttachmentError={onAttachmentError} />);
    const local = within(container);

    await dropFiles(local.getByRole('textbox'), file);

    await waitFor(() => expect(onAttachmentError).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'too-large',
      source: 'drop',
      file,
      maxAttachmentBytes: 3,
    })));
    expect(local.queryByText('large.txt')).not.toBeInTheDocument();
  });
  it('rejects pasted files that do not match accept', async () => {
    const onAttachmentError = vi.fn();
    const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    const { container } = render(<ControlledChatInput accept="image/*" onAttachmentError={onAttachmentError} />);
    const local = within(container);

    await pasteFiles(local.getByRole('textbox'), file);

    await waitFor(() => expect(onAttachmentError).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'unsupported-type',
      source: 'paste',
      file,
      accept: 'image/*',
    })));
    expect(local.queryByText('notes.txt')).not.toBeInTheDocument();
  });
  it('enforces maxAttachments while keeping accepted files', async () => {
    const onAttachmentError = vi.fn();
    const first = new File(['one'], 'one.png', { type: 'image/png' });
    const second = new File(['two'], 'two.png', { type: 'image/png' });
    const uploadAttachment = vi.fn(async (incoming: File) => ({
      name: incoming.name,
      type: incoming.type,
      size: incoming.size,
      data: 'uploaded-image',
    }));
    const { container } = render(<ControlledChatInput accept="image/*" maxAttachments={1} onAttachmentError={onAttachmentError} uploadAttachment={uploadAttachment} />);
    const local = within(container);

    await dropFiles(local.getByRole('textbox'), first, second);

    expect(await local.findByText('one.png')).toBeInTheDocument();
    expect(local.queryByText('two.png')).not.toBeInTheDocument();
    await waitFor(() => expect(onAttachmentError).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'too-many',
      source: 'drop',
      file: second,
      maxAttachments: 1,
    })));
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
    const { container } = render(<ControlledChatInput accept="image/*" uploadAttachment={uploadAttachment} onSend={onSend} />);
    const local = within(container);

    await dropFiles(local.getByRole('textbox'), file);
    await waitFor(() => expect(local.getByText('uploaded.png')).toBeInTheDocument());

    await waitFor(() => expect(local.getByRole('button', { name: /send/i })).toBeEnabled());
    await user.click(local.getByRole('button', { name: /send/i }));

    expect(uploadAttachment).toHaveBeenCalledWith(file, { signal: expect.any(AbortSignal) });
    expect(onSend).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'uploaded.png',
        url: 'https://cdn.example.com/uploaded.png',
        id: 'file_123',
        data: 'https://cdn.example.com/uploaded.png',
      }),
    ]);
  });
  describe('paste preventDefault', () => {
    it('preventDefaults a file paste so the file path is not also inserted into the textarea', async () => {
      const file = new File(['image-bytes'], 'pasted.png', { type: 'image/png' });
      const uploadAttachment = vi.fn(async (incoming: File) => ({
        name: incoming.name,
        type: incoming.type,
        size: incoming.size,
        data: 'data:image/png;base64,cGFzdGVk',
      }));
      const { container } = render(<ControlledChatInput accept="image/*" uploadAttachment={uploadAttachment} />);
      const local = within(container);

      const textbox = local.getByRole('textbox');
      const pasteEvent = createEvent.paste(textbox, { clipboardData: fileTransfer(file) });
      await act(async () => {
        fireEvent(textbox, pasteEvent);
      });

      expect(pasteEvent.defaultPrevented).toBe(true);
      expect(await local.findByText('pasted.png')).toBeInTheDocument();
    });
  });
});
