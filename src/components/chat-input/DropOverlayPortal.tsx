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
 * surface) keeps the overlay inside its own composer-sized root. The host is
 * resolved once on mount: the `.chorus` ancestor of a mounted ChatInput does
 * not change.
 */
export function DropOverlayPortal({ active, label, rootRef }: DropOverlayPortalProps) {
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    setHost(rootRef.current?.closest<HTMLElement>('.chorus') ?? null);
  }, [rootRef]);

  if (!active) return null;

  const overlay = (
    <div className="chorus-drop-overlay" aria-hidden="true">
      <span className="chorus-drop-overlay-label">{label}</span>
    </div>
  );

  return host ? createPortal(overlay, host) : overlay;
}
