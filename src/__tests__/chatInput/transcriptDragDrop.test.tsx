import { describe, it, expect, vi } from 'vitest';
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import {
  ChorusSurface,
  fileTransfer,
} from './testUtils';

describe('ChatInput transcript-wide drag-and-drop', () => {
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
