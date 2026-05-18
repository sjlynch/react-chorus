import type * as React from 'react';
import type { Attachment, AttachmentError, UploadAttachment } from '../../types';
import type { ChorusAttachmentLabels, ChorusComposerLabels } from '../../labels/types';

export interface RenderAttachmentErrorContext {
  error: AttachmentError;
  dismiss: () => void;
}

export interface ChatInputProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value: string;
  onChange: (v: string) => void;
  onSend: (attachments: Attachment[]) => void | boolean | Promise<void | boolean>;
  onStop?: () => void;
  placeholder?: string;
  sending?: boolean;
  /** Disable every composer affordance except Stop while a send is active. */
  disabled?: boolean;
  /** Keep the composer visible but prevent changing text, attachments, or sending. */
  readOnly?: boolean;
  /** Optional explanation surfaced as placeholder/title/description when disabled or read-only. */
  disabledReason?: string;
  /** Increment or change to clear composer attachments and cancel pending file work. */
  resetKey?: unknown;
  accept?: string;
  maxAttachmentBytes?: number;
  maxAttachments?: number;
  /**
   * Observes attachment validation, read, and upload failures. The built-in
   * composer also renders an accessible error region for these failures; pass
   * `renderAttachmentError` to replace that default UI.
   */
  onAttachmentError?: (error: AttachmentError) => void;
  /**
   * Replaces the built-in attachment error region. When omitted, the composer
   * renders a default polite-live alert below the chips with a dismiss button.
   * Pass `null` to suppress the default UI entirely (e.g. when the host has
   * already wired its own surface via `onAttachmentError`).
   */
  renderAttachmentError?: ((context: RenderAttachmentErrorContext) => React.ReactNode) | null;
  uploadAttachment?: UploadAttachment;
  /**
   * Localized labels for the composer (placeholder, aria-labels, attach/send/stop, and
   * disabled/read-only fallback reasons). Defaults to English; the existing `placeholder`
   * and `disabledReason` props take precedence over `labels` when both are provided.
   */
  labels?: ChorusComposerLabels;
  /**
   * Localized labels for attachment chips, validation/read/upload error messages, and
   * polite live-region status/completion announcements. Defaults to English.
   */
  attachmentLabels?: ChorusAttachmentLabels;
}
