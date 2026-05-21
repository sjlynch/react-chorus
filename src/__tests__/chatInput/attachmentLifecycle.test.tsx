import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ChatInput,
  ControlledChatInput,
  deferred,
  dropFiles,
  installDeferredFileReader,
  type AttachmentUploadResult,
} from './testUtils';

describe('ChatInput attachment lifecycle', () => {
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
});
