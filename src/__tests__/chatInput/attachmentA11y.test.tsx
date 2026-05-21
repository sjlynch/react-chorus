import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_ATTACHMENT_LABELS } from '../../labels/attachments';
import type { ChorusAttachmentLabels } from '../../labels/types';
import {
  ControlledChatInput,
  deferred,
  dropFiles,
  installDeferredFileReader,
  pasteFiles,
  type AttachmentUploadResult,
} from './testUtils';

describe('ChatInput attachment accessibility and localization', () => {
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

    it('announces a pending upload failure once via the error region, leaving the announcer span empty', async () => {
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

      // The default error region is itself a polite live region and carries the
      // failure announcement.
      const status = await local.findByRole('status');
      expect(status).toHaveTextContent('Envoi impossible de broken.png : réseau coupé');
      // The separate announcer span stays empty, so a single failure is announced
      // exactly once instead of twice.
      expect(local.getByTestId('chorus-attachment-announcer')).toHaveTextContent('');
    });

    it('announces a pending upload failure via the announcer span when renderAttachmentError={null}', async () => {
      const upload = deferred<AttachmentUploadResult>();
      const uploadAttachment = vi.fn(() => upload.promise);
      const file = new File(['image'], 'broken.png', { type: 'image/png' });
      const { container } = render(
        <ControlledChatInput
          accept="image/*"
          uploadAttachment={uploadAttachment}
          attachmentLabels={FR_ATTACHMENT_LABELS}
          renderAttachmentError={null}
        />,
      );
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);
      expect(await local.findByText('broken.png')).toBeInTheDocument();

      upload.reject(new Error('réseau coupé'));

      // With the default error region suppressed there is no error live region,
      // so the polite announcer span is the only screen-reader path and the
      // failure announcement is emitted there instead.
      const announcer = local.getByTestId('chorus-attachment-announcer');
      await waitFor(() => expect(announcer).toHaveTextContent('Échec : broken.png'));
      expect(local.queryByRole('status')).not.toBeInTheDocument();
    });

    it('uses localized labels for chip remove buttons, error region, and error messages', async () => {
      const user = userEvent.setup();
      const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
      const { container } = render(
        <ControlledChatInput accept="image/*" attachmentLabels={FR_ATTACHMENT_LABELS} />,
      );
      const local = within(container);

      await pasteFiles(local.getByRole('textbox'), file);

      const status = await local.findByRole('status');
      expect(status).toHaveTextContent("notes.txt n'est pas accepté (image/*).");
      const dismiss = local.getByRole('button', { name: "Fermer l'erreur" });
      expect(dismiss).toHaveAttribute('title', "Fermer l'erreur");
      await user.click(dismiss);
      expect(local.queryByRole('status')).not.toBeInTheDocument();
    });

    it('uses localized too-large/too-many messages', async () => {
      const file = new File(['too large'], 'large.txt', { type: 'text/plain' });
      const { container } = render(
        <ControlledChatInput accept="text/plain" maxAttachmentBytes={3} attachmentLabels={FR_ATTACHMENT_LABELS} />,
      );
      const local = within(container);

      await dropFiles(local.getByRole('textbox'), file);

      const status = await local.findByRole('status');
      expect(status).toHaveTextContent(/large\.txt.*dépasse la limite/);

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
      const status2 = await local2.findByRole('status');
      expect(status2).toHaveTextContent('Limite 1 pour two.png.');
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
});
