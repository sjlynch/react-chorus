import React from 'react';
import { createPortal } from 'react-dom';

interface DropOverlayPortalProps {
  /** Whether files are being dragged and the composer can accept them. */
  active: boolean;
  /** Localized "Drop to attach" label. */
  label: string;
  /**
   * The composer root, used to locate the surrounding `.chorus` surface the
   * overlay portals onto.
   */
  rootRef: React.RefObject<HTMLElement | null>;
}

/**
 * The "Drop to attach" drag overlay. It must blanket the whole widget so it
 * always renders under the cursor — `useChatSurfaceFileDrop` also accepts file
 * drops over the transcript, far above the composer. It portals onto the
 * surrounding `.chorus` surface when one exists; a standalone ChatInput (no
 * surface) keeps the overlay inside its own composer-sized root.
 *
 * The host is resolved fresh on every render rather than cached at mount: a
 * ChatInput can be re-parented into (or out of) a `.chorus` surface after mount
 * — a conditional layout, a lazy-mounted shell, or a route transition that
 * re-parents without unmounting — and a stale mount-time host would leave the
 * overlay nested in the composer, no longer covering transcript-area drops.
 */
export function DropOverlayPortal({ active, label, rootRef }: DropOverlayPortalProps) {
  if (!active) return null;

  const overlay = (
    <div className="chorus-drop-overlay" aria-hidden="true">
      <span className="chorus-drop-overlay-label">{label}</span>
    </div>
  );

  const host = rootRef.current?.closest<HTMLElement>('.chorus') ?? null;
  return host ? createPortal(overlay, host) : overlay;
}
