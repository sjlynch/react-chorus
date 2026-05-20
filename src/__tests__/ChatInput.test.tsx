import { createRef, useState, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../components/ChatInput';
import type { ChatInputHandle, ChatInputProps } from '../components/ChatInput';
import type { AttachmentUploadResult } from '../types';
import { DEFAULT_ATTACHMENT_LABELS } from '../labels/attachments';
import type { ChorusAttachmentLabels } from '../labels/types';

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

// Renders a ChatInput inside a `.chorus` widget root with a sibling transcript
// area, mirroring the real <Chorus> layout so transcript-wide drag-and-drop
// (which is wired to the surrounding surface) can be exercised.
function ChorusSurface({ children, ...props }: Partial<ChatInputProps> & { children?: ReactNode }) {
  const [value, setValue] = useState(props.value ?? '');

  return (
    <div className="chorus">
      <div data-testid="transcript">{children ?? 'transcript'}</div>
      <ChatInput
        {...props}
        value={value}
        onChange={setValue}
        onSend={props.onSend ?? vi.fn()}
      />
    </div>
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

  it('forwards an imperative handle whose focus() targets the textarea and accepts caret options', () => {
    const ref = createRef<ChatInputHandle>();
    render(
      <ChatInput
        ref={ref}
        value="hello world"
        onChange={vi.fn()}
        onSend={vi.fn()}
        id="composer"
        data-testid="composer-root"
      />,
    );

    expect(screen.getByTestId('composer-root')).toHaveAttribute('id', 'composer');

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

    act(() => ref.current?.focus());
    expect(textarea).toHaveFocus();

    act(() => ref.current?.focus({ caret: 'end' }));
    expect(textarea.selectionStart).toBe('hello world'.length);
    expect(textarea.selectionEnd).toBe('hello world'.length);

    act(() => ref.current?.focus({ caret: 'start' }));
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(0);

    act(() => ref.current?.focus({ caret: 3 }));
    expect(textarea.selectionStart).toBe(3);
    expect(textarea.selectionEnd).toBe(3);

    act(() => ref.current?.focus({ caret: 999 }));
    expect(textarea.selectionStart).toBe('hello world'.length);
    expect(textarea.selectionEnd).toBe('hello world'.length);
  });

  it('applies the palette as --chorus-* variables on the root and merges an explicit style', () => {
    render(
      <ChatInput
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        data-testid="composer-root"
        palette={{ inputBg: '#1a1a1a', sendButtonBg: '#6366f1' }}
        style={{ borderRadius: '4px' }}
      />,
    );

    const root = screen.getByTestId('composer-root');
    expect(root.style.getPropertyValue('--chorus-input-bg')).toBe('#1a1a1a');
    expect(root.style.getPropertyValue('--chorus-send-bg')).toBe('#6366f1');
    // Unset palette keys emit no variable so an ancestor theme can still cascade in.
    expect(root.style.getPropertyValue('--chorus-chat-bg')).toBe('');
    expect(root.style.borderRadius).toBe('4px');
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

      // A pending chip's X cancels the in-progress read — it is labelled accordingly.
      await user.click(local.getByRole('button', { name: /cancel upload of removed-read\.png/i }));
      expect(local.queryByText('removed-read.png')).not.toBeInTheDocument();

      mockReader.readers[0].resolve('data:image/png;base64,bGF0ZQ==');

      await waitFor(() => expect(local.queryByText('removed-read.png')).not.toBeInTheDocument());
      await user.click(local.getByRole('button', { name: /send/i }));

      expect(onSend).toHaveBeenCalledWith([]);
    } finally {
      mockReader.restore();
    }
  });

  it('reports read-failed and keeps the chip in a failed, retryable state when the default FileReader fails', async () => {
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
      // The chip stays in the row in a failed state so the user can retry or remove it.
      await waitFor(() => expect(container.querySelector('.chorus-attachment-chip--failed')).toBeInTheDocument());
      expect(local.getByText('broken-read.png')).toBeInTheDocument();
      expect(local.getByRole('button', { name: /retry broken-read\.png/i })).toBeInTheDocument();
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

  it('keeps a failed upload chip in a retryable state and reports upload-failed when uploadAttachment rejects', async () => {
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
    // The chip transitions pending → failed (not removed) and offers a Retry affordance.
    await waitFor(() => expect(container.querySelector('.chorus-attachment-chip--failed')).toBeInTheDocument());
    expect(container.querySelector('.chorus-attachment-chip--pending')).not.toBeInTheDocument();
    expect(local.getByText('broken.png')).toBeInTheDocument();
    expect(local.getByRole('button', { name: /retry broken\.png/i })).toBeInTheDocument();
    // No attachment resolved, so send stays disabled.
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

    await user.click(local.getByRole('button', { name: /cancel upload of cancel-me\.png/i }));

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

  describe('attachment a11y, localization, and image alt text', () => {
    const FR_ATTACHMENT_LABELS: ChorusAttachmentLabels = {
      ...DEFAULT_ATTACHMENT_LABELS,
      readingStatus: (name) => `Lecture de ${name}`,
      uploadingStatus: (name) => `Envoi de ${name}`,
      completedAnnouncement: (name) => `${name} prêt`,
      failedAnnouncement: (name) => `Échec : ${name}`,
      removeAttachment: (name) => `Retirer ${name}`,
      cancelUpload: (name) => `Annuler l'envoi de ${name}`,
      retry: 'Réessayer',
      retryAttachment: (name) => `Réessayer ${name}`,
      dismissError: "Fermer l'erreur",
      describeImage: 'Décrire cette image',
      describeImageInputAriaLabel: (name) => `Description de ${name}`,
      describeImagePlaceholder: 'Décrivez cette image',
      imageFallbackAlt: (name) => `Image jointe : ${name}`,
      unsupportedTypeError: ({ name, accept }) =>
        `${name} n'est pas accepté${accept ? ` (${accept})` : ''}.`,
      tooLargeError: ({ name, size, limit }) => `${name} (${size}) dépasse la limite ${limit}.`,
      tooManyError: ({ name, max }) => `Limite ${max} pour ${name}.`,
      readFailedError: ({ name, detail }) => `Lecture impossible de ${name} : ${detail}`,
      uploadFailedError: ({ name, detail }) => `Envoi impossible de ${name} : ${detail}`,
    };

    it('marks pending chips with aria-busy and announces the localized pending status politely', async () => {
      const mockReader = installDeferredFileReader();
      try {
        const file = new File(['bytes'], 'slow-read.png', { type: 'image/png' });
        const { container } = render(
          <ControlledChatInput accept="image/*" attachmentLabels={FR_ATTACHMENT_LABELS} />,
        );
        const local = within(container);

        await dropFiles(local.getByRole('textbox'), file);

        const chip = await waitFor(() => {
          const el = container.querySelector('.chorus-attachment-chip--pending');
          expect(el).not.toBeNull();
          return el as HTMLElement;
        });
        expect(chip).toHaveAttribute('aria-busy', 'true');
        const pendingStatus = within(chip).getByText('Lecture de slow-read.png');
        expect(pendingStatus).toHaveAttribute('aria-live', 'polite');
        expect(pendingStatus).toHaveClass('chorus-sr-only');

        mockReader.readers[0].resolve('data:image/png;base64,c2xvdw==');
        await waitFor(() => expect(container.querySelector('.chorus-attachment-chip--pending')).toBeNull());
      } finally {
        mockReader.restore();
      }
    });

    it('emits a polite localized announcement when a pending read completes', async () => {
      const mockReader = installDeferredFileReader();
      try {
        const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
        const { container } = render(
          <ControlledChatInput accept="image/*" attachmentLabels={FR_ATTACHMENT_LABELS} />,
        );
        const local = within(container);

        const announcer = local.getByTestId('chorus-attachment-announcer');
        expect(announcer).toHaveAttribute('aria-live', 'polite');
        expect(announcer).toHaveTextContent('');

        await dropFiles(local.getByRole('textbox'), file);
        await waitFor(() => expect(container.querySelector('.chorus-attachment-chip--pending')).not.toBeNull());

        mockReader.readers[0].resolve('data:image/png;base64,c2xvdw==');

        await waitFor(() => expect(announcer).toHaveTextContent('photo.png prêt'));
      } finally {
        mockReader.restore();
      }
    });

    it('emits a polite localized failure announcement when a pending upload rejects', async () => {
      const upload = deferred<AttachmentUploadResult>();
      const uploadAttachment = vi.fn(() => upload.promise);
      const file = new File(['image'], 'broken.png', { type: 'image/png' });
      const { container } = render(
        <ControlledChatInput
          accept="image/*"
          uploadAttachment={uploadAttachment}
          attachmentLabels={FR_ATTACHMENT_LABELS}
        />,
      );
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);
      expect(await local.findByText('broken.png')).toBeInTheDocument();

      upload.reject(new Error('réseau coupé'));

      const announcer = local.getByTestId('chorus-attachment-announcer');
      await waitFor(() => expect(announcer).toHaveTextContent('Échec : broken.png'));
      const alert = await local.findByRole('alert');
      expect(alert).toHaveTextContent('Envoi impossible de broken.png : réseau coupé');
    });

    it('uses localized labels for chip remove buttons, error region, and error messages', async () => {
      const user = userEvent.setup();
      const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
      const { container } = render(
        <ControlledChatInput accept="image/*" attachmentLabels={FR_ATTACHMENT_LABELS} />,
      );
      const local = within(container);

      await pasteFiles(local.getByRole('textbox'), file);

      const alert = await local.findByRole('alert');
      expect(alert).toHaveTextContent("notes.txt n'est pas accepté (image/*).");
      const dismiss = local.getByRole('button', { name: "Fermer l'erreur" });
      expect(dismiss).toHaveAttribute('title', "Fermer l'erreur");
      await user.click(dismiss);
      expect(local.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('uses localized too-large/too-many messages', async () => {
      const file = new File(['too large'], 'large.txt', { type: 'text/plain' });
      const { container } = render(
        <ControlledChatInput accept="text/plain" maxAttachmentBytes={3} attachmentLabels={FR_ATTACHMENT_LABELS} />,
      );
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);

      const alert = await local.findByRole('alert');
      expect(alert).toHaveTextContent(/large\.txt.*dépasse la limite/);

      const first = new File(['one'], 'one.png', { type: 'image/png' });
      const second = new File(['two'], 'two.png', { type: 'image/png' });
      const uploadAttachment = vi.fn(async (incoming: File) => ({
        name: incoming.name,
        type: incoming.type,
        size: incoming.size,
        data: 'uploaded-image',
      }));
      const { container: container2 } = render(
        <ControlledChatInput
          accept="image/*"
          maxAttachments={1}
          uploadAttachment={uploadAttachment}
          attachmentLabels={FR_ATTACHMENT_LABELS}
        />,
      );
      const local2 = within(container2);
      await dropFiles(local2.getByRole('textbox'), first, second);
      const alert2 = await local2.findByRole('alert');
      expect(alert2).toHaveTextContent('Limite 1 pour two.png.');
    });

    it('uses localized aria-labels that differ between a pending (cancel) and a resolved (remove) chip', async () => {
      const upload = deferred<AttachmentUploadResult>();
      const uploadAttachment = vi.fn(() => upload.promise);
      const file = new File(['image'], 'slow.png', { type: 'image/png' });
      const { container } = render(
        <ControlledChatInput
          accept="image/*"
          uploadAttachment={uploadAttachment}
          attachmentLabels={FR_ATTACHMENT_LABELS}
        />,
      );
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);
      // While pending, the X button cancels the in-progress upload.
      expect(await local.findByRole('button', { name: "Annuler l'envoi de slow.png" })).toBeInTheDocument();
      expect(local.queryByRole('button', { name: 'Retirer slow.png' })).not.toBeInTheDocument();

      upload.resolve({ name: 'slow.png', type: 'image/png', size: file.size, url: 'https://cdn.example.com/slow.png' });

      // Once resolved, the same X button removes the finished attachment.
      expect(await local.findByRole('button', { name: 'Retirer slow.png' })).toBeInTheDocument();
      expect(local.queryByRole('button', { name: "Annuler l'envoi de slow.png" })).not.toBeInTheDocument();
    });

    it('captures alt text typed into the inline describe-image input and sends it as Attachment.alt', async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      const file = new File(['image-bytes'], 'photo.png', { type: 'image/png' });
      const uploadAttachment = vi.fn(async (incoming: File) => ({
        name: incoming.name,
        type: incoming.type,
        size: incoming.size,
        data: 'data:image/png;base64,cGhvdG8=',
      }));
      const { container } = render(
        <ControlledChatInput
          value="Look"
          onSend={onSend}
          accept="image/*"
          uploadAttachment={uploadAttachment}
          attachmentLabels={FR_ATTACHMENT_LABELS}
        />,
      );
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);
      expect(await local.findByText('photo.png')).toBeInTheDocument();
      await waitFor(() => expect(local.getByRole('button', { name: /send/i })).toBeEnabled());

      const describeButton = await local.findByRole('button', { name: 'Description de photo.png' });
      expect(describeButton).toHaveTextContent('Décrire cette image');
      await user.click(describeButton);

      const altInput = await local.findByRole('textbox', { name: 'Description de photo.png' });
      expect(altInput).toHaveAttribute('placeholder', 'Décrivez cette image');
      await user.type(altInput, 'A red bicycle');

      await user.click(local.getByRole('button', { name: /send/i }));
      expect(onSend).toHaveBeenCalledOnce();
      expect(onSend.mock.calls[0][0]).toEqual([
        expect.objectContaining({
          name: 'photo.png',
          alt: 'A red bicycle',
        }),
      ]);
    });
  });

  describe('stable client identity', () => {
    it('keys chips and remove operations on a stable uid, never an array index', async () => {
      const user = userEvent.setup();
      const slow = deferred<AttachmentUploadResult>();
      let call = 0;
      const uploadAttachment = vi.fn((file: File) => {
        call += 1;
        // First file resolves immediately; the second stays pending.
        return call === 1
          ? Promise.resolve({ name: file.name, type: file.type, size: file.size, url: 'https://cdn.example.com/dup-1.png' })
          : slow.promise;
      });
      const onSend = vi.fn();
      // Two distinct files that share a filename — index-derived React keys would
      // shift under each other once the list mutates.
      const first = new File(['one'], 'dup.png', { type: 'image/png' });
      const second = new File(['two'], 'dup.png', { type: 'image/png' });
      const { container } = render(
        <ControlledChatInput value="hi" onSend={onSend} accept="image/*" uploadAttachment={uploadAttachment} />,
      );
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), first, second);

      // Both same-named chips render: one resolved, one still uploading.
      await waitFor(() => expect(container.querySelectorAll('.chorus-attachment-chip').length).toBe(2));
      await waitFor(() => expect(container.querySelector('img.chorus-attachment-thumb')).toBeInTheDocument());
      expect(container.querySelector('.chorus-attachment-chip--pending')).toBeInTheDocument();

      // Remove the resolved chip while the other is still pending — the pending
      // chip (a distinct uid) must survive and keep resolving correctly.
      await user.click(local.getByRole('button', { name: 'Remove dup.png' }));
      await waitFor(() => expect(container.querySelectorAll('.chorus-attachment-chip').length).toBe(1));
      expect(container.querySelector('.chorus-attachment-chip--pending')).toBeInTheDocument();

      slow.resolve({ name: 'dup.png', type: 'image/png', size: second.size, url: 'https://cdn.example.com/dup-2.png' });

      await waitFor(() => expect(container.querySelector('.chorus-attachment-chip--pending')).not.toBeInTheDocument());
      expect(container.querySelector('img.chorus-attachment-thumb')).toHaveAttribute('src', 'https://cdn.example.com/dup-2.png');

      await user.click(local.getByRole('button', { name: /send/i }));
      expect(onSend).toHaveBeenCalledWith([
        expect.objectContaining({ name: 'dup.png', url: 'https://cdn.example.com/dup-2.png' }),
      ]);
    });

    it('keeps an open alt editor attached to its chip when an earlier chip is removed', async () => {
      const user = userEvent.setup();
      const uploadAttachment = vi.fn(async (file: File) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        url: `https://cdn.example.com/${file.name}`,
      }));
      const a = new File(['a'], 'a.png', { type: 'image/png' });
      const b = new File(['b'], 'b.png', { type: 'image/png' });
      const { container } = render(<ControlledChatInput accept="image/*" uploadAttachment={uploadAttachment} />);
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), a, b);
      await waitFor(() => expect(container.querySelectorAll('img.chorus-attachment-thumb').length).toBe(2));

      // Open the (still empty) alt editor on the second chip.
      await user.click(local.getByRole('button', { name: 'Description for b.png' }));
      expect(await local.findByRole('textbox', { name: 'Description for b.png' })).toBeInTheDocument();

      // Removing the earlier chip must not collapse the open editor on a later one.
      await user.click(local.getByRole('button', { name: 'Remove a.png' }));
      await waitFor(() => expect(local.queryByText('a.png')).not.toBeInTheDocument());
      expect(local.getByRole('textbox', { name: 'Description for b.png' })).toBeInTheDocument();
    });

    it('alt-edits the intended chip by uid while another upload is still pending', async () => {
      const user = userEvent.setup();
      const slow = deferred<AttachmentUploadResult>();
      let call = 0;
      const uploadAttachment = vi.fn((file: File) => {
        call += 1;
        return call === 1
          ? Promise.resolve({ name: file.name, type: file.type, size: file.size, url: 'https://cdn.example.com/ready.png' })
          : slow.promise;
      });
      const onSend = vi.fn();
      const ready = new File(['r'], 'ready.png', { type: 'image/png' });
      const pending = new File(['p'], 'pending.png', { type: 'image/png' });
      const { container } = render(
        <ControlledChatInput value="hi" onSend={onSend} accept="image/*" uploadAttachment={uploadAttachment} />,
      );
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), ready, pending);
      await waitFor(() => expect(container.querySelector('img.chorus-attachment-thumb')).toBeInTheDocument());

      // Describe the resolved chip while the other upload is mid-flight.
      await user.click(local.getByRole('button', { name: 'Description for ready.png' }));
      await user.type(await local.findByRole('textbox', { name: 'Description for ready.png' }), 'A cat');

      // Resolving the pending upload must not move the alt text onto the wrong chip.
      slow.resolve({ name: 'pending.png', type: 'image/png', size: pending.size, url: 'https://cdn.example.com/pending.png' });
      await waitFor(() => expect(container.querySelector('.chorus-attachment-chip--pending')).not.toBeInTheDocument());

      await user.click(local.getByRole('button', { name: /send/i }));
      expect(onSend).toHaveBeenCalledWith([
        expect.objectContaining({ name: 'ready.png', alt: 'A cat' }),
        expect.objectContaining({ name: 'pending.png' }),
      ]);
      expect(onSend.mock.calls[0][0][1].alt).toBeUndefined();
    });
  });

  describe('inactive composer clears all staged attachments', () => {
    function ToggleHarness({ readOnly = false }: { readOnly?: boolean }) {
      const [value, setValue] = useState('');
      const [inactive, setInactive] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setInactive(prev => !prev)}>toggle-inactive</button>
          <ChatInput
            value={value}
            onChange={setValue}
            onSend={onSendSpy}
            accept="image/*"
            uploadAttachment={uploadSpy}
            disabled={!readOnly && inactive}
            readOnly={readOnly && inactive}
          />
        </>
      );
    }
    const onSendSpy = vi.fn();
    const uploadSpy = vi.fn(async (file: File) => ({
      name: file.name,
      type: file.type,
      size: file.size,
      url: `https://cdn.example.com/${file.name}`,
    }));

    it.each([
      ['disabled', false],
      ['readOnly', true],
    ] as const)('drops completed attachments on %s so they do not leak into the next send', async (_label, readOnly) => {
      onSendSpy.mockClear();
      const user = userEvent.setup();
      const file = new File(['img'], 'staged.png', { type: 'image/png' });
      const { container } = render(<ToggleHarness readOnly={readOnly} />);
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);
      await waitFor(() => expect(local.getByText('staged.png')).toBeInTheDocument());
      await waitFor(() => expect(container.querySelector('img.chorus-attachment-thumb')).toBeInTheDocument());

      // Host makes the composer inactive (lost API key, conversation switch/archive)
      // while a completed attachment is staged.
      await user.click(local.getByRole('button', { name: 'toggle-inactive' }));
      await waitFor(() => expect(local.queryByText('staged.png')).not.toBeInTheDocument());

      // Re-enable and send an unrelated text-only message.
      await user.click(local.getByRole('button', { name: 'toggle-inactive' }));
      await user.type(local.getByRole('textbox'), 'unrelated message');
      await user.click(local.getByRole('button', { name: /send/i }));

      expect(onSendSpy).toHaveBeenCalledWith([]);
    });
  });

  describe('pending / failed / accepted chip states', () => {
    it('renders a pending chip with a spinner and a Cancel-upload label described by the live status', async () => {
      const upload = deferred<AttachmentUploadResult>();
      const uploadAttachment = vi.fn(() => upload.promise);
      const file = new File(['img'], 'state.png', { type: 'image/png' });
      const { container } = render(<ControlledChatInput accept="image/*" uploadAttachment={uploadAttachment} />);
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);

      const chip = await waitFor(() => {
        const el = container.querySelector('.chorus-attachment-chip--pending');
        expect(el).not.toBeNull();
        return el as HTMLElement;
      });
      expect(chip).toHaveAttribute('aria-busy', 'true');
      expect(chip.querySelector('.chorus-attachment-spinner')).toBeInTheDocument();

      const cancel = within(chip).getByRole('button', { name: 'Cancel upload of state.png' });
      const status = within(chip).getByText('Uploading state.png');
      expect(status.id).toBeTruthy();
      expect(cancel).toHaveAttribute('aria-describedby', status.id);
      expect(within(chip).queryByRole('button', { name: /^Retry/ })).not.toBeInTheDocument();
    });

    it('renders a failed chip with a Retry button and a plain Remove label', async () => {
      const upload = deferred<AttachmentUploadResult>();
      const uploadAttachment = vi.fn(() => upload.promise);
      const file = new File(['img'], 'state.png', { type: 'image/png' });
      const { container } = render(<ControlledChatInput accept="image/*" uploadAttachment={uploadAttachment} />);
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);
      await waitFor(() => expect(container.querySelector('.chorus-attachment-chip--pending')).toBeInTheDocument());

      upload.reject(new Error('network down'));

      const chip = await waitFor(() => {
        const el = container.querySelector('.chorus-attachment-chip--failed');
        expect(el).not.toBeNull();
        return el as HTMLElement;
      });
      expect(chip).not.toHaveAttribute('aria-busy');
      expect(within(chip).getByRole('button', { name: 'Retry state.png' })).toBeInTheDocument();
      // The X reverts to a plain Remove — it is no longer cancelling an upload.
      expect(within(chip).getByRole('button', { name: 'Remove state.png' })).toBeInTheDocument();
      expect(within(chip).queryByRole('button', { name: /Cancel upload/ })).not.toBeInTheDocument();
    });

    it('renders an accepted chip with a preview thumbnail, Remove label, and no Retry', async () => {
      const uploadAttachment = vi.fn(async (file: File) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        url: `https://cdn.example.com/${file.name}`,
      }));
      const file = new File(['img'], 'state.png', { type: 'image/png' });
      const { container } = render(<ControlledChatInput accept="image/*" uploadAttachment={uploadAttachment} />);
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);

      const chip = await waitFor(() => {
        const el = container.querySelector('img.chorus-attachment-thumb')?.closest('.chorus-attachment-chip');
        expect(el).not.toBeNull();
        return el as HTMLElement;
      });
      expect(chip).not.toHaveClass('chorus-attachment-chip--pending');
      expect(chip).not.toHaveClass('chorus-attachment-chip--failed');
      expect(within(chip).getByRole('button', { name: 'Remove state.png' })).toBeInTheDocument();
      expect(within(chip).queryByRole('button', { name: /^Retry/ })).not.toBeInTheDocument();
    });

    it('retries a failed upload by uid and resolves it into an accepted chip', async () => {
      const user = userEvent.setup();
      let attempt = 0;
      const uploadAttachment = vi.fn((file: File) => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(new Error('network down'))
          : Promise.resolve({ name: file.name, type: file.type, size: file.size, url: 'https://cdn.example.com/state.png' });
      });
      const onSend = vi.fn();
      const file = new File(['img'], 'state.png', { type: 'image/png' });
      const { container } = render(
        <ControlledChatInput value="hi" onSend={onSend} accept="image/*" uploadAttachment={uploadAttachment} />,
      );
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);
      await waitFor(() => expect(container.querySelector('.chorus-attachment-chip--failed')).toBeInTheDocument());

      await user.click(local.getByRole('button', { name: 'Retry state.png' }));

      await waitFor(() => expect(container.querySelector('.chorus-attachment-chip--failed')).not.toBeInTheDocument());
      await waitFor(() => expect(container.querySelector('img.chorus-attachment-thumb')).toBeInTheDocument());
      expect(uploadAttachment).toHaveBeenCalledTimes(2);

      await waitFor(() => expect(local.getByRole('button', { name: /send/i })).toBeEnabled());
      await user.click(local.getByRole('button', { name: /send/i }));
      expect(onSend).toHaveBeenCalledWith([
        expect.objectContaining({ name: 'state.png', url: 'https://cdn.example.com/state.png' }),
      ]);
    });
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

  describe('IME composition', () => {
    it('does not send on Enter while an IME composition is active', () => {
      const onSend = vi.fn();
      render(<ControlledChatInput value="こんにちは" onSend={onSend} />);
      const textarea = screen.getByRole('textbox');

      // Inside the compositionstart..compositionend window Enter belongs to the IME.
      fireEvent.compositionStart(textarea);
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(onSend).not.toHaveBeenCalled();
      fireEvent.compositionEnd(textarea);

      // The keydown that confirms a composition still carries isComposing even
      // after compositionend has fired.
      fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });
      expect(onSend).not.toHaveBeenCalled();

      // A plain Enter outside any composition sends as usual.
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(onSend).toHaveBeenCalledOnce();
    });
  });

  describe('async send / typing race', () => {
    it('clears attachments after an async send resolves when the composer is untouched', async () => {
      const user = userEvent.setup();
      const send = deferred<void>();
      const onSend = vi.fn(() => send.promise);
      const uploadAttachment = vi.fn(async (incoming: File) => ({
        name: incoming.name,
        type: incoming.type,
        size: incoming.size,
        data: 'uploaded',
      }));
      const file = new File(['image'], 'sent.png', { type: 'image/png' });
      const { container } = render(
        <ControlledChatInput value="hi" onSend={onSend} accept="image/*" uploadAttachment={uploadAttachment} />,
      );
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);
      expect(await local.findByText('sent.png')).toBeInTheDocument();
      await waitFor(() => expect(local.getByRole('button', { name: /send/i })).toBeEnabled());
      await user.click(local.getByRole('button', { name: /send/i }));

      await act(async () => {
        send.resolve();
      });

      await waitFor(() => expect(local.queryByText('sent.png')).not.toBeInTheDocument());
    });

    it('keeps freshly typed input when an async send resolves after the user typed again', async () => {
      const send = deferred<void>();
      const onSend = vi.fn(() => send.promise);
      const uploadAttachment = vi.fn(async (incoming: File) => ({
        name: incoming.name,
        type: incoming.type,
        size: incoming.size,
        data: 'uploaded',
      }));
      const inFlight = new File(['image'], 'in-flight.png', { type: 'image/png' });
      const { container } = render(
        <ControlledChatInput value="first" onSend={onSend} accept="image/*" uploadAttachment={uploadAttachment} />,
      );
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), inFlight);
      expect(await local.findByText('in-flight.png')).toBeInTheDocument();
      await waitFor(() => expect(local.getByRole('button', { name: /send/i })).toBeEnabled());
      await act(async () => {
        fireEvent.click(local.getByRole('button', { name: /send/i }));
      });
      expect(onSend).toHaveBeenCalledOnce();

      // User starts a fresh message + attachment before the in-flight send resolves.
      await act(async () => {
        fireEvent.change(local.getByRole('textbox'), { target: { value: 'first and more' } });
      });
      const kept = new File(['image2'], 'kept.png', { type: 'image/png' });
      await dropFiles(local.getByRole('textbox'), kept);
      expect(await local.findByText('kept.png')).toBeInTheDocument();

      await act(async () => {
        send.resolve();
      });

      // The stale resolved callback must not wipe the user's new attachment.
      expect(local.getByText('kept.png')).toBeInTheDocument();
    });
  });

  describe('transcript-wide drag-and-drop', () => {
    it('suppresses browser navigation and ingests a file dropped onto the transcript', async () => {
      const uploadAttachment = vi.fn(async (incoming: File) => ({
        name: incoming.name,
        type: incoming.type,
        size: incoming.size,
        data: 'uploaded',
      }));
      const file = new File(['drop-bytes'], 'transcript-drop.png', { type: 'image/png' });
      const { container } = render(<ChorusSurface accept="image/*" uploadAttachment={uploadAttachment} />);
      const transcript = screen.getByTestId('transcript');

      // dragover must be prevented so the drop is a drop, not a navigation.
      const overEvent = createEvent.dragOver(transcript, { dataTransfer: fileTransfer(file) });
      await act(async () => {
        fireEvent(transcript, overEvent);
      });
      expect(overEvent.defaultPrevented).toBe(true);

      const dropEvent = createEvent.drop(transcript, { dataTransfer: fileTransfer(file) });
      await act(async () => {
        fireEvent(transcript, dropEvent);
      });
      expect(dropEvent.defaultPrevented).toBe(true);

      expect(await within(container).findByText('transcript-drop.png')).toBeInTheDocument();
      expect(uploadAttachment).toHaveBeenCalledWith(file, { signal: expect.any(AbortSignal) });
    });

    it('shows the "Drop to attach" overlay while a file is dragged over the surface', async () => {
      const { container } = render(<ChorusSurface accept="image/*" />);
      const local = within(container);
      const transcript = screen.getByTestId('transcript');
      const file = new File(['bytes'], 'over.png', { type: 'image/png' });

      expect(local.queryByText('Drop to attach')).not.toBeInTheDocument();

      await act(async () => {
        fireEvent.dragEnter(transcript, { dataTransfer: fileTransfer(file) });
      });
      expect(local.getByText('Drop to attach')).toBeInTheDocument();

      await act(async () => {
        fireEvent.dragEnd(window);
      });
      expect(local.queryByText('Drop to attach')).not.toBeInTheDocument();
    });

    it('still preventDefaults transcript drops when attachments are disabled, without an overlay', async () => {
      const { container } = render(<ChorusSurface accept={undefined} />);
      const local = within(container);
      const transcript = screen.getByTestId('transcript');
      const file = new File(['bytes'], 'ignored.png', { type: 'image/png' });

      const overEvent = createEvent.dragOver(transcript, { dataTransfer: fileTransfer(file) });
      await act(async () => {
        fireEvent(transcript, overEvent);
      });
      const dropEvent = createEvent.drop(transcript, { dataTransfer: fileTransfer(file) });
      await act(async () => {
        fireEvent(transcript, dropEvent);
      });

      // Navigation is still suppressed even though no attachment is ingested.
      expect(overEvent.defaultPrevented).toBe(true);
      expect(dropEvent.defaultPrevented).toBe(true);
      expect(local.queryByText('Drop to attach')).not.toBeInTheDocument();
      expect(local.queryByText('ignored.png')).not.toBeInTheDocument();
    });
  });
});
