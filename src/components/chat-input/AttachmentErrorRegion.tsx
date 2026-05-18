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
      role="alert"
      aria-live="polite"
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
