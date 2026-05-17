import { createRef, useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

async function dropFiles(target: Element, ...files: File[]) {
  await act(async () => {
    fireEvent.drop(target, { dataTransfer: fileTransfer(...files) });
  });
}

async function pasteFiles(target: Element, ...files: File[]) {
  await act(async () => {
    fireEvent.paste(target, { clipboardData: fileTransfer(...files) });
  });
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

type FileReaderHandler = ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null;

function installDeferredFileReader() {
  const OriginalFileReader = globalThis.FileReader;
  const readers: DeferredFileReader[] = [];

  class DeferredFileReader {
    static EMPTY = 0;
    static LOADING = 1;
    static DONE = 2;

    readyState = DeferredFileReader.EMPTY;
    result: string | ArrayBuffer | null = null;
    error: DOMException | null = null;
    onload: FileReaderHandler = null;
    onerror: FileReaderHandler = null;
    onabort: FileReaderHandler = null;

    constructor() {
      readers.push(this);
    }

    readAsDataURL() {
      this.readyState = DeferredFileReader.LOADING;
    }

    abort() {
      this.readyState = DeferredFileReader.DONE;
      this.onabort?.call(this as unknown as FileReader, new ProgressEvent('abort') as ProgressEvent<FileReader>);
    }

    resolve(dataUrl: string) {
      this.result = dataUrl;
      this.readyState = DeferredFileReader.DONE;
      this.onload?.call(this as unknown as FileReader, new ProgressEvent('load') as ProgressEvent<FileReader>);
    }

    reject(error = new DOMException('read failed', 'NotReadableError')) {
      this.error = error;
      this.readyState = DeferredFileReader.DONE;
      this.onerror?.call(this as unknown as FileReader, new ProgressEvent('error') as ProgressEvent<FileReader>);
    }
  }

  Object.defineProperty(globalThis, 'FileReader', {
    configurable: true,
    writable: true,
    value: DeferredFileReader as unknown as typeof FileReader,
  });

  return {
    readers,
    restore() {
      Object.defineProperty(globalThis, 'FileReader', {
        configurable: true,
        writable: true,
        value: OriginalFileReader,
      });
    },
  };
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

  it('forwards root refs and HTML attributes while focus() targets the textarea', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(<ChatInput ref={ref} value="" onChange={vi.fn()} onSend={vi.fn()} id="composer" data-testid="composer-root" />);

    expect(ref.current).toBe(container.firstElementChild);
    expect(screen.getByTestId('composer-root')).toHaveAttribute('id', 'composer');

    ref.current?.focus();
    expect(screen.getByRole('textbox')).toHaveFocus();
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

  it('blocks sends and attachment ingestion while disabled', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const uploadAttachment = vi.fn();
    const file = new File(['image'], 'disabled.png', { type: 'image/png' });
    const { container } = render(
      <ControlledChatInput value="Blocked" onSend={onSend} accept="image/*" uploadAttachment={uploadAttachment} disabled disabledReason="Choose a conversation first" />,
    );

    const textbox = screen.getByRole('textbox');
    expect(textbox).toBeDisabled();
    expect(textbox).toHaveAttribute('placeholder', 'Choose a conversation first');
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /attach file/i })).toBeDisabled();
    expect(container.firstElementChild).toHaveAttribute('aria-disabled', 'true');

    await user.type(textbox, '{Enter}');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await pasteFiles(textbox, file);
    await dropFiles(textbox, file);

    expect(onSend).not.toHaveBeenCalled();
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(screen.queryByText('disabled.png')).not.toBeInTheDocument();
  });

  it('keeps the stop button available while disabled and sending', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} onStop={onStop} sending disabled />);

    const stop = screen.getByRole('button', { name: /stop/i });
    expect(stop).toBeEnabled();

    await user.click(stop);

    expect(onStop).toHaveBeenCalledOnce();
  });

  it('prevents composing, sending, and file ingestion while read-only', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const uploadAttachment = vi.fn();
    const file = new File(['image'], 'readonly.png', { type: 'image/png' });
    render(<ControlledChatInput value="Archived" onSend={onSend} accept="image/*" uploadAttachment={uploadAttachment} readOnly />);

    const textbox = screen.getByRole('textbox');
    expect(textbox).not.toBeDisabled();
    expect(textbox).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /attach file/i })).toBeDisabled();

    await user.type(textbox, '{Enter}');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await pasteFiles(textbox, file);
    await dropFiles(textbox, file);

    expect(onSend).not.toHaveBeenCalled();
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(screen.queryByText('readonly.png')).not.toBeInTheDocument();
  });

  it('calls onSend and clears attachments when the send button is clicked', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const { container } = render(<ControlledChatInput onSend={onSend} accept="text/plain" />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await screen.findByText('notes.txt');
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeEnabled());

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

  it('preserves attachments when onSend returns false', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(() => false as const);
    const file = new File(['hello'], 'blocked.txt', { type: 'text/plain' });
    const { container } = render(<ControlledChatInput onSend={onSend} accept="text/plain" />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await screen.findByText('blocked.txt');
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).toHaveBeenCalledOnce();
    expect(screen.getByText('blocked.txt')).toBeInTheDocument();
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

  it('treats an empty accept string as allowing any file while still showing attachments', async () => {
    const user = userEvent.setup();
    const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    const uploadAttachment = vi.fn(async (incoming: File) => ({
      name: incoming.name,
      type: incoming.type,
      size: incoming.size,
      data: 'uploaded-notes',
    }));
    const { container } = render(<ControlledChatInput accept="" uploadAttachment={uploadAttachment} />);
    const local = within(container);

    expect(local.getByRole('button', { name: /attach file/i })).toBeInTheDocument();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(await local.findByText('notes.txt')).toBeInTheDocument();
    expect(uploadAttachment).toHaveBeenCalledWith(file, { signal: expect.any(AbortSignal) });
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

  describe('built-in attachment error surface', () => {
    it('renders an accessible error region for unsupported-type without onAttachmentError wired', async () => {
      const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
      const { container } = render(<ControlledChatInput accept="image/*" />);
      const local = within(container);

      await pasteFiles(local.getByRole('textbox'), file);

      const alert = await local.findByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'polite');
      expect(alert).toHaveTextContent(/notes\.txt/);
      expect(alert).toHaveTextContent(/not an accepted attachment type/);
      // Surface is non-modal — it does not steal focus from the composer.
      expect(local.getByRole('textbox')).not.toHaveFocus();
    });

    it('renders a too-large error region without onAttachmentError wired', async () => {
      const file = new File(['too large'], 'large.txt', { type: 'text/plain' });
      const { container } = render(<ControlledChatInput accept="text/plain" maxAttachmentBytes={3} />);
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);

      const alert = await local.findByRole('alert');
      expect(alert).toHaveTextContent(/large\.txt/);
      expect(alert).toHaveTextContent(/limit is/);
    });

    it('renders a too-many error region without onAttachmentError wired', async () => {
      const first = new File(['one'], 'one.png', { type: 'image/png' });
      const second = new File(['two'], 'two.png', { type: 'image/png' });
      const uploadAttachment = vi.fn(async (incoming: File) => ({
        name: incoming.name,
        type: incoming.type,
        size: incoming.size,
        data: 'uploaded-image',
      }));
      const { container } = render(<ControlledChatInput accept="image/*" maxAttachments={1} uploadAttachment={uploadAttachment} />);
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), first, second);

      const alert = await local.findByRole('alert');
      expect(alert).toHaveTextContent(/Only 1 attachment allowed/);
      expect(alert).toHaveTextContent(/two\.png/);
    });

    it('renders an upload-failed error region without onAttachmentError wired', async () => {
      const upload = deferred<AttachmentUploadResult>();
      const uploadAttachment = vi.fn(() => upload.promise);
      const file = new File(['image'], 'broken.png', { type: 'image/png' });
      const { container } = render(<ControlledChatInput accept="image/*" uploadAttachment={uploadAttachment} />);
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);
      expect(await local.findByText('broken.png')).toBeInTheDocument();

      upload.reject(new Error('network down'));

      const alert = await local.findByRole('alert');
      expect(alert).toHaveTextContent(/broken\.png/);
      expect(alert).toHaveTextContent(/network down/);
    });

    it('renders a read-failed error region without onAttachmentError wired', async () => {
      const mockReader = installDeferredFileReader();
      try {
        const file = new File(['bytes'], 'broken-read.png', { type: 'image/png' });
        const { container } = render(<ControlledChatInput accept="image/*" />);
        const local = within(container);

        await dropFiles(local.getByRole('textbox'), file);
        expect(await local.findByText('broken-read.png')).toBeInTheDocument();

        mockReader.readers[0].reject(new DOMException('disk unavailable', 'NotReadableError'));

        const alert = await local.findByRole('alert');
        expect(alert).toHaveTextContent(/broken-read\.png/);
        expect(alert).toHaveTextContent(/disk unavailable/);
      } finally {
        mockReader.restore();
      }
    });

    it('still calls onAttachmentError when provided and renders the default surface alongside it', async () => {
      const onAttachmentError = vi.fn();
      const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
      const { container } = render(<ControlledChatInput accept="image/*" onAttachmentError={onAttachmentError} />);
      const local = within(container);

      await pasteFiles(local.getByRole('textbox'), file);

      await waitFor(() => expect(onAttachmentError).toHaveBeenCalledWith(expect.objectContaining({ reason: 'unsupported-type' })));
      expect(await local.findByRole('alert')).toHaveTextContent(/not an accepted attachment type/);
    });

    it('dismisses the error region when the user clicks the dismiss button', async () => {
      const user = userEvent.setup();
      const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
      const { container } = render(<ControlledChatInput accept="image/*" />);
      const local = within(container);

      await pasteFiles(local.getByRole('textbox'), file);
      expect(await local.findByRole('alert')).toBeInTheDocument();

      await user.click(local.getByRole('button', { name: /dismiss attachment error/i }));

      expect(local.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('clears the error region when a new clean file batch is added', async () => {
      const bad = new File(['notes'], 'notes.txt', { type: 'text/plain' });
      const good = new File(['image-bytes'], 'good.png', { type: 'image/png' });
      const uploadAttachment = vi.fn(async (incoming: File) => ({
        name: incoming.name,
        type: incoming.type,
        size: incoming.size,
        data: 'uploaded-good',
      }));
      const { container } = render(<ControlledChatInput accept="image/*" uploadAttachment={uploadAttachment} />);
      const local = within(container);

      await pasteFiles(local.getByRole('textbox'), bad);
      expect(await local.findByRole('alert')).toBeInTheDocument();

      await dropFiles(local.getByRole('textbox'), good);

      expect(await local.findByText('good.png')).toBeInTheDocument();
      await waitFor(() => expect(local.queryByRole('alert')).not.toBeInTheDocument());
    });

    it('clears the error region after an accepted send', async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
      const { container } = render(<ControlledChatInput value="Hello" onSend={onSend} accept="image/*" />);
      const local = within(container);

      await pasteFiles(local.getByRole('textbox'), file);
      expect(await local.findByRole('alert')).toBeInTheDocument();

      await user.click(local.getByRole('button', { name: /send/i }));

      expect(onSend).toHaveBeenCalledOnce();
      await waitFor(() => expect(local.queryByRole('alert')).not.toBeInTheDocument());
    });

    it('uses renderAttachmentError when provided to override the default region', async () => {
      const renderAttachmentError = vi.fn(({ error, dismiss }: { error: { message: string }; dismiss: () => void }) => (
        <div data-testid="custom-attachment-error">
          <span>{`Custom: ${error.message}`}</span>
          <button type="button" onClick={dismiss}>Hide</button>
        </div>
      ));
      const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
      const { container } = render(<ControlledChatInput accept="image/*" renderAttachmentError={renderAttachmentError} />);
      const local = within(container);

      await pasteFiles(local.getByRole('textbox'), file);

      expect(await local.findByTestId('custom-attachment-error')).toHaveTextContent(/Custom: notes\.txt/);
      expect(local.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('suppresses the default region when renderAttachmentError={null}', async () => {
      const onAttachmentError = vi.fn();
      const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
      const { container } = render(<ControlledChatInput accept="image/*" onAttachmentError={onAttachmentError} renderAttachmentError={null} />);
      const local = within(container);

      await pasteFiles(local.getByRole('textbox'), file);

      await waitFor(() => expect(onAttachmentError).toHaveBeenCalledWith(expect.objectContaining({ reason: 'unsupported-type' })));
      expect(local.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('shows a pending read chip, blocks Enter/send, and sends after the default FileReader resolves', async () => {
    const mockReader = installDeferredFileReader();
    try {
      const user = userEvent.setup();
      const onSend = vi.fn();
      const file = new File(['image-bytes'], 'slow-read.png', { type: 'image/png' });
      const { container } = render(<ControlledChatInput value="Describe this" onSend={onSend} accept="image/*" />);
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);

      expect(await local.findByText('slow-read.png')).toBeInTheDocument();
      expect(container.querySelector('.chorus-attachment-chip--pending')).toBeInTheDocument();
      expect(local.getByText('Reading slow-read.png', { selector: '.chorus-sr-only' })).toBeInTheDocument();
      expect(local.getByRole('button', { name: /send/i })).toBeDisabled();

      await user.type(local.getByRole('textbox'), '{Enter}');
      expect(onSend).not.toHaveBeenCalled();

      mockReader.readers[0].resolve('data:image/png;base64,c2xvdw==');

      await waitFor(() => expect(container.querySelector('.chorus-attachment-chip--pending')).not.toBeInTheDocument());
      expect(local.getByRole('button', { name: /send/i })).toBeEnabled();

      await user.click(local.getByRole('button', { name: /send/i }));

      expect(onSend).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'slow-read.png',
          type: 'image/png',
          data: 'data:image/png;base64,c2xvdw==',
        }),
      ]);
    } finally {
      mockReader.restore();
    }
  });

  it('cancels a pending default read when its chip is removed and ignores late completion', async () => {
    const mockReader = installDeferredFileReader();
    try {
      const user = userEvent.setup();
      const onSend = vi.fn();
      const file = new File(['image-bytes'], 'removed-read.png', { type: 'image/png' });
      const { container } = render(<ControlledChatInput value="Just text" onSend={onSend} accept="image/*" />);
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);
      expect(await local.findByText('removed-read.png')).toBeInTheDocument();

      await user.click(local.getByRole('button', { name: /remove removed-read\.png/i }));
      expect(local.queryByText('removed-read.png')).not.toBeInTheDocument();

      mockReader.readers[0].resolve('data:image/png;base64,bGF0ZQ==');

      await waitFor(() => expect(local.queryByText('removed-read.png')).not.toBeInTheDocument());
      await user.click(local.getByRole('button', { name: /send/i }));

      expect(onSend).toHaveBeenCalledWith([]);
    } finally {
      mockReader.restore();
    }
  });

  it('reports read-failed and removes the pending chip when the default FileReader fails', async () => {
    const mockReader = installDeferredFileReader();
    try {
      const onAttachmentError = vi.fn();
      const file = new File(['image-bytes'], 'broken-read.png', { type: 'image/png' });
      const { container } = render(<ControlledChatInput accept="image/*" onAttachmentError={onAttachmentError} />);
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);
      expect(await local.findByText('broken-read.png')).toBeInTheDocument();

      mockReader.readers[0].reject(new DOMException('disk unavailable', 'NotReadableError'));

      await waitFor(() => expect(onAttachmentError).toHaveBeenCalledWith(expect.objectContaining({
        reason: 'read-failed',
        source: 'drop',
        file,
      })));
      await waitFor(() => expect(local.queryByText('broken-read.png')).not.toBeInTheDocument());
    } finally {
      mockReader.restore();
    }
  });

  it('shows a pending upload chip and disables send until uploadAttachment resolves', async () => {
    const upload = deferred<AttachmentUploadResult>();
    const uploadAttachment = vi.fn(() => upload.promise);
    const file = new File(['image-bytes'], 'slow.png', { type: 'image/png' });
    const { container } = render(<ControlledChatInput accept="image/*" uploadAttachment={uploadAttachment} />);
    const local = within(container);

    await dropFiles(local.getByRole('textbox'), file);

    expect(await local.findByText('slow.png')).toBeInTheDocument();
    expect(container.querySelector('.chorus-attachment-chip--pending')).toBeInTheDocument();
    expect(container.querySelector('.chorus-attachment-spinner')).toBeInTheDocument();
    expect(local.getByRole('button', { name: /send/i })).toBeDisabled();

    upload.resolve({
      name: 'slow.png',
      type: 'image/png',
      size: file.size,
      url: 'https://cdn.example.com/slow.png',
    });

    await waitFor(() => expect(container.querySelector('.chorus-attachment-chip--pending')).not.toBeInTheDocument());
    expect(local.getByRole('button', { name: /send/i })).toBeEnabled();
  });

  it('removes a pending upload chip and reports upload-failed when uploadAttachment rejects', async () => {
    const upload = deferred<AttachmentUploadResult>();
    const uploadAttachment = vi.fn(() => upload.promise);
    const onAttachmentError = vi.fn();
    const file = new File(['image'], 'broken.png', { type: 'image/png' });
    const { container } = render(<ControlledChatInput accept="image/*" uploadAttachment={uploadAttachment} onAttachmentError={onAttachmentError} />);
    const local = within(container);

    await dropFiles(local.getByRole('textbox'), file);
    expect(await local.findByText('broken.png')).toBeInTheDocument();
    expect(container.querySelector('.chorus-attachment-chip--pending')).toBeInTheDocument();

    upload.reject(new Error('network down'));

    await waitFor(() => expect(onAttachmentError).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'upload-failed',
      source: 'drop',
      file,
    })));
    await waitFor(() => expect(local.queryByText('broken.png')).not.toBeInTheDocument());
    expect(local.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('aborts a pending upload when its chip is removed and ignores a late upload resolution', async () => {
    const user = userEvent.setup();
    const upload = deferred<AttachmentUploadResult>();
    let uploadSignal: AbortSignal | undefined;
    const uploadAttachment = vi.fn((_file: File, options?: { signal: AbortSignal }) => {
      uploadSignal = options?.signal;
      return upload.promise;
    });
    const onAttachmentError = vi.fn();
    const file = new File(['image'], 'cancel-me.png', { type: 'image/png' });
    const { container } = render(<ControlledChatInput value="Keep text" accept="image/*" uploadAttachment={uploadAttachment} onAttachmentError={onAttachmentError} />);
    const local = within(container);

    await dropFiles(local.getByRole('textbox'), file);
    expect(await local.findByText('cancel-me.png')).toBeInTheDocument();
    expect(container.querySelector('.chorus-attachment-chip--pending')).toBeInTheDocument();
    expect(uploadSignal).toBeDefined();

    await user.click(local.getByRole('button', { name: /remove cancel-me\.png/i }));

    expect(uploadSignal?.aborted).toBe(true);
    expect(local.queryByText('cancel-me.png')).not.toBeInTheDocument();

    upload.resolve({
      name: 'cancel-me.png',
      type: 'image/png',
      size: file.size,
      url: 'https://cdn.example.com/cancel-me.png',
    });

    await waitFor(() => expect(local.queryByText('cancel-me.png')).not.toBeInTheDocument());
    expect(onAttachmentError).not.toHaveBeenCalled();
  });

  it('aborts pending attachment work on unmount', async () => {
    const upload = deferred<AttachmentUploadResult>();
    let uploadSignal: AbortSignal | undefined;
    const uploadAttachment = vi.fn((_file: File, options?: { signal: AbortSignal }) => {
      uploadSignal = options?.signal;
      return upload.promise;
    });
    const file = new File(['image'], 'unmount.png', { type: 'image/png' });
    const { container, unmount } = render(<ControlledChatInput accept="image/*" uploadAttachment={uploadAttachment} />);
    const local = within(container);

    await dropFiles(local.getByRole('textbox'), file);
    expect(await local.findByText('unmount.png')).toBeInTheDocument();

    unmount();

    expect(uploadSignal?.aborted).toBe(true);
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
});
