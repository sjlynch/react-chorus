import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ChatInput,
  ControlledChatInput,
  deferred,
  dropFiles,
  pasteFiles,
  type ChatInputHandle,
} from './testUtils';

describe('ChatInput composer behavior', () => {
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
  it('shows slash-command suggestions and runs exact slash commands instead of sending', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onSlashCommand = vi.fn();
    render(
      <ControlledChatInput
        onSend={onSend}
        slashCommands={[{ name: '/fs:list-dir', description: 'List a directory' }]}
        onSlashCommand={onSlashCommand}
      />,
    );

    const textbox = screen.getByRole('textbox');
    await user.type(textbox, '/fs');
    expect(screen.getByRole('listbox', { name: /slash commands/i })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /\/fs:list-dir/i }));
    expect(onSlashCommand).toHaveBeenCalledWith('/fs:list-dir');

    await user.clear(textbox);
    await user.type(textbox, '/fs:list-dir{Enter}');
    expect(onSlashCommand).toHaveBeenCalledTimes(2);
    expect(onSend).not.toHaveBeenCalled();
  });
  it('attaches resource references from the composer resource picker', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const resource = {
      id: 'file:///tmp/notes.md',
      name: 'notes.md',
      type: 'text/markdown',
      data: 'file:///tmp/notes.md',
      size: 0,
      metadata: { mcp: { server: 'fs', uri: 'file:///tmp/notes.md', name: 'notes.md' } },
    };
    render(<ControlledChatInput onSend={onSend} resourceAttachments={[resource]} />);

    fireEvent.change(screen.getByLabelText(/attach mcp resource/i), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Remove notes.md' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith([resource]);
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
    // A natively disabled control must not also advertise aria-readonly.
    expect(textbox).not.toHaveAttribute('aria-readonly');
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
    // A purely read-only (not disabled) textarea should advertise aria-readonly.
    expect(textbox).toHaveAttribute('aria-readonly', 'true');
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
  it('shows the stop button when sending with an onStop handler', () => {
    render(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} onStop={vi.fn()} sending />);

    expect(screen.getByRole('button', { name: /stop/i })).toBeEnabled();
  });
  it('keeps an accurate disabled Send button when sending without onStop', () => {
    render(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} sending />);

    // Without `onStop` there is nothing to stop, so the button must not
    // advertise an inert "Stop" to assistive tech or visually — it stays a
    // disabled "Send".
    expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });
  it('calls onStop when the stop button is clicked', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<ChatInput value="" onChange={vi.fn()} onSend={vi.fn()} onStop={onStop} sending />);

    await user.click(screen.getByRole('button', { name: /stop/i }));

    expect(onStop).toHaveBeenCalledOnce();
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
});
