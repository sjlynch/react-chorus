import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import {
  ChatInput,
  ChorusSurface,
  fileTransfer,
} from './testUtils';

// A ChatInput whose enclosing element only becomes a `.chorus` surface after the
// first render — mirrors a conditional layout / lazy-mounted shell that wraps the
// composer into a surface without remounting it.
function PromotableSurface({ surface }: { surface: boolean }) {
  const [value, setValue] = useState('');
  return (
    <div className={surface ? 'chorus' : 'shell'}>
      <div data-testid="transcript">transcript</div>
      <ChatInput accept="image/*" value={value} onChange={setValue} onSend={vi.fn()} />
    </div>
  );
}

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

    it('portals the drop overlay onto the .chorus surface so it covers the whole widget', async () => {
      const { container } = render(<ChorusSurface accept="image/*" />);
      const transcript = screen.getByTestId('transcript');
      const file = new File(['bytes'], 'over.png', { type: 'image/png' });

      await act(async () => {
        fireEvent.dragEnter(transcript, { dataTransfer: fileTransfer(file) });
      });

      const overlay = container.querySelector('.chorus-drop-overlay');
      expect(overlay).not.toBeNull();
      // The overlay is sized to its positioned ancestor: it must blanket the
      // whole `.chorus` widget, not be nested inside the small composer.
      expect(overlay!.parentElement).toHaveClass('chorus');
      expect(overlay!.closest('.chorus-input')).toBeNull();
    });

    it('keeps the overlay up when a stray composer dragleave fires during a surface drag', async () => {
      // The surface listeners and the composer React handlers track drag depth
      // independently. A composer-side `dragleave` with no matching composer
      // `dragenter` must not decrement the depth the surface drag owns —
      // otherwise the shared counter desyncs and the overlay flickers off.
      const { container } = render(<ChorusSurface accept="image/*" />);
      const local = within(container);
      const transcript = screen.getByTestId('transcript');
      const composer = container.querySelector('.chorus-input') as HTMLElement;
      const file = new File(['bytes'], 'over.png', { type: 'image/png' });

      await act(async () => {
        fireEvent.dragEnter(transcript, { dataTransfer: fileTransfer(file) });
      });
      expect(local.getByText('Drop to attach')).toBeInTheDocument();

      await act(async () => {
        fireEvent.dragLeave(composer, { dataTransfer: fileTransfer(file) });
      });
      // The surface drag is still in progress, so the overlay must stay up.
      expect(local.getByText('Drop to attach')).toBeInTheDocument();
    });

    it('re-resolves the overlay host when an ancestor becomes a .chorus surface after mount', async () => {
      const file = new File(['bytes'], 'over.png', { type: 'image/png' });
      const { container, rerender } = render(<PromotableSurface surface={false} />);
      const composer = container.querySelector('.chorus-input') as HTMLElement;

      // The enclosing element is promoted to a `.chorus` surface after mount.
      rerender(<PromotableSurface surface />);

      await act(async () => {
        fireEvent.dragEnter(composer, { dataTransfer: fileTransfer(file) });
      });

      const overlay = container.querySelector('.chorus-drop-overlay');
      expect(overlay).not.toBeNull();
      // The overlay must follow the surface that appeared after mount rather
      // than staying trapped in the composer root resolved at mount time.
      expect(overlay!.parentElement).toHaveClass('chorus');
      expect(overlay!.closest('.chorus-input')).toBeNull();
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
