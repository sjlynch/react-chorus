import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ControlledChatInput,
  deferred,
  dropFiles,
  installDeferredFileReader,
  pasteFiles,
  type AttachmentUploadResult,
} from './testUtils';

describe('ChatInput attachment error surface', () => {
  describe('built-in attachment error surface', () => {
    it('renders an accessible error region for unsupported-type without onAttachmentError wired', async () => {
      const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
      const { container } = render(<ControlledChatInput accept="image/*" />);
      const local = within(container);

      await pasteFiles(local.getByRole('textbox'), file);

      const status = await local.findByRole('status');
      // One consistent pairing: role="status" with an explicit polite atomic live
      // region (no role="alert" + aria-live="polite" conflict).
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(status).toHaveAttribute('aria-atomic', 'true');
      expect(status).toHaveTextContent(/notes\.txt/);
      expect(status).toHaveTextContent(/not an accepted attachment type/);
      // Surface is non-modal — it does not steal focus from the composer.
      expect(local.getByRole('textbox')).not.toHaveFocus();
    });

    it('renders a too-large error region without onAttachmentError wired', async () => {
      const file = new File(['too large'], 'large.txt', { type: 'text/plain' });
      const { container } = render(<ControlledChatInput accept="text/plain" maxAttachmentBytes={3} />);
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);

      const status = await local.findByRole('status');
      expect(status).toHaveTextContent(/large\.txt/);
      expect(status).toHaveTextContent(/limit is/);
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

      const status = await local.findByRole('status');
      expect(status).toHaveTextContent(/Only 1 attachment allowed/);
      expect(status).toHaveTextContent(/two\.png/);
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

      const status = await local.findByRole('status');
      expect(status).toHaveTextContent(/broken\.png/);
      expect(status).toHaveTextContent(/network down/);
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

        const status = await local.findByRole('status');
        expect(status).toHaveTextContent(/broken-read\.png/);
        expect(status).toHaveTextContent(/disk unavailable/);
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
      expect(await local.findByRole('status')).toHaveTextContent(/not an accepted attachment type/);
    });

    it('dismisses the error region when the user clicks the dismiss button', async () => {
      const user = userEvent.setup();
      const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
      const { container } = render(<ControlledChatInput accept="image/*" />);
      const local = within(container);

      await pasteFiles(local.getByRole('textbox'), file);
      expect(await local.findByRole('status')).toBeInTheDocument();

      await user.click(local.getByRole('button', { name: /dismiss attachment error/i }));

      expect(local.queryByRole('status')).not.toBeInTheDocument();
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
      expect(await local.findByRole('status')).toBeInTheDocument();

      await dropFiles(local.getByRole('textbox'), good);

      expect(await local.findByText('good.png')).toBeInTheDocument();
      await waitFor(() => expect(local.queryByRole('status')).not.toBeInTheDocument());
    });

    it('clears the error region after an accepted send', async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
      const { container } = render(<ControlledChatInput value="Hello" onSend={onSend} accept="image/*" />);
      const local = within(container);

      await pasteFiles(local.getByRole('textbox'), file);
      expect(await local.findByRole('status')).toBeInTheDocument();

      await user.click(local.getByRole('button', { name: /send/i }));

      expect(onSend).toHaveBeenCalledOnce();
      await waitFor(() => expect(local.queryByRole('status')).not.toBeInTheDocument());
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
      expect(local.queryByRole('status')).not.toBeInTheDocument();
    });

    it('suppresses the default region when renderAttachmentError={null}', async () => {
      const onAttachmentError = vi.fn();
      const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
      const { container } = render(<ControlledChatInput accept="image/*" onAttachmentError={onAttachmentError} renderAttachmentError={null} />);
      const local = within(container);

      await pasteFiles(local.getByRole('textbox'), file);

      await waitFor(() => expect(onAttachmentError).toHaveBeenCalledWith(expect.objectContaining({ reason: 'unsupported-type' })));
      expect(local.queryByRole('status')).not.toBeInTheDocument();
    });
  });
});
