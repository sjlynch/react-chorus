import type * as React from 'react';
import type { Attachment, AttachmentError, UploadAttachment } from '../../types';

export interface ChatInputSlashCommand {
  name: string;
  description?: string;
}
import type { ChorusAttachmentLabels, ChorusComposerLabels } from '../../labels/types';
import type { Palette } from '../ChorusTheme';

export interface RenderAttachmentErrorContext {
  error: AttachmentError;
  dismiss: () => void;
}

export interface ChatInputFocusOptions {
  /**
   * Where to place the caret after focusing the textarea. `'end'` (default)
   * positions it after the existing value, `'start'` positions it at the
   * beginning, and a number selects an explicit zero-based offset (clamped to
   * the current value length).
   */
  caret?: 'end' | 'start' | number;
}

export interface ChatInputHandle {
  /**
   * Focus the underlying composer textarea, optionally moving the caret.
   * Works with default and headless renders and across custom wrapper layers
   * because it goes through the textarea ref instead of a DOM query.
   */
  focus(options?: ChatInputFocusOptions): void;
}

/**
 * Props for the `ChatInput` composer.
 *
 * `ChatInputProps` extends `React.HTMLAttributes<HTMLDivElement>` (minus
 * `onChange`, which is the controlled-value callback here). Any such extra
 * attribute — `id`, `data-*`, `aria-*`, and event handlers including
 * `onKeyDown` — is spread onto the **root container `<div>`**, never the inner
 * textarea. Consequences worth knowing:
 *
 * - An `onKeyDown` passed this way fires for the root container. The composer's
 *   own Enter-to-send handler lives on the textarea and calls `preventDefault()`,
 *   so a root `onKeyDown` will NOT observe textarea keystrokes the composer
 *   consumes (notably Enter). It still sees keys the composer ignores. Passing
 *   `onKeyDown` emits a one-time `console.warn` in development explaining this.
 * - `style` is merged after the palette CSS variables. `aria-disabled` and
 *   `title` are used only as fallbacks: the composer overrides them while it is
 *   disabled/read-only (`aria-disabled`) or has a disabled reason (`title`).
 */
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
   * renders a default polite live region (`role="status"`) below the chips with
   * a dismiss button, which also serves as the screen-reader announcement for
   * read/upload failures. Pass `null` to suppress the default UI entirely (e.g.
   * when the host has already wired its own surface via `onAttachmentError`); the
   * composer then announces failures through its separate polite announcer span.
   */
  renderAttachmentError?: ((context: RenderAttachmentErrorContext) => React.ReactNode) | null;
  uploadAttachment?: UploadAttachment;
  /** Slash-command suggestions shown when the draft starts with `/`. */
  slashCommands?: ChatInputSlashCommand[];
  /** Called when a slash-command suggestion is chosen or an exact command is submitted. */
  onSlashCommand?: (commandName: string) => void | Promise<void>;
  /** Non-file attachment references (for example MCP resources) that can be selected from the composer picker. */
  resourceAttachments?: Attachment[];
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
  /**
   * Theme palette applied as `--chorus-*` CSS variables on the composer root.
   * Equivalent to wrapping this component in `<ChorusTheme palette={…}>`. When
   * it is nested inside another `<Chorus palette>` or `<ChorusTheme>`, the
   * nearest ancestor that sets a given variable wins per the normal CSS cascade.
   */
  palette?: Palette;
}
