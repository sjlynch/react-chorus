import { X } from 'lucide-react';
import type { AttachmentError } from '../../types';
import type { ChorusAttachmentLabels } from '../../labels/types';

interface AttachmentErrorRegionProps {
  error: AttachmentError;
  labels: ChorusAttachmentLabels;
  onDismiss: () => void;
}

export function AttachmentErrorRegion({ error, labels, onDismiss }: AttachmentErrorRegionProps) {
  return (
    <div
      className="chorus-attachment-error"
      // Attachment validation/read/upload errors (oversize file, wrong type, failed
      // read/upload) are non-critical: announce them politely so they queue behind
      // the user's typing instead of interrupting it. `role="status"` already implies
      // a polite live region; `aria-live="polite"` + `aria-atomic="true"` are stated
      // explicitly to keep one consistent pairing. We deliberately avoid `role="alert"`,
      // which implies `aria-live="assertive"` — pairing it with `aria-live="polite"`
      // is an ARIA conflict that NVDA/JAWS/VoiceOver resolve inconsistently.
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="chorus-attachment-error-text">{error.message}</span>
      <button
        type="button"
        className="chorus-attachment-error-dismiss"
        onClick={onDismiss}
        aria-label={labels.dismissError}
        title={labels.dismissError}
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
