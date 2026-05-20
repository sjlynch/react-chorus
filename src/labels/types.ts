// Pure type module. Importing types from here is a zero-runtime/zero-side-effect
// edge in the dependency graph, so component bundles can reference the label
// contracts without pulling sibling default constants.

export interface ChorusComposerLabels {
  placeholder: string;
  ariaLabel: string;
  attachFile: string;
  send: string;
  stop: string;
  disabledReason: string;
  readOnlyReason: string;
}

export interface ChorusTranscriptLabels {
  ariaLabel: string;
  typing: string;
  retry: string;
  jumpToLatest: string;
  suggestedPromptsAriaLabel: string;
  emptyStateTitle: string;
}

export interface ChorusMessageActionLabels {
  edit: string;
  regenerate: string;
  copy: string;
  copyFailed: string;
  thumbsUp: string;
  thumbsDown: string;
  delete: string;
  save: string;
  cancel: string;
  editTextareaAriaLabel: string;
}

export interface ChorusSpeakerLabels {
  user: string;
  assistant: string;
  system: string;
  tool: string;
}

export interface ChorusToolCallLabels {
  input: string;
  output: string;
}

export interface ChorusCodeCopyLabels {
  copy: string;
  copied: string;
  failed: string;
  ariaLabel: string;
}

export interface ChorusConversationListLabels {
  newConversation: string;
  empty: string;
  pin: string;
  unpin: string;
  rename: string;
  delete: string;
  save: string;
  cancel: string;
  navAriaLabel: string;
  renameAriaLabel: (title: string) => string;
  pinAriaLabel: (title: string, pinned: boolean) => string;
  deleteAriaLabel: (title: string) => string;
}

export interface ChorusAttachmentTooLargeContext {
  name: string;
  size: string;
  limit: string;
}

export interface ChorusAttachmentTooManyContext {
  name: string;
  max: number;
}

export interface ChorusAttachmentFailureContext {
  name: string;
  detail: string;
}

export interface ChorusAttachmentUnsupportedTypeContext {
  name: string;
  accept?: string;
}

export interface ChorusAttachmentLabels {
  /** Polite live-region status while a file is being read into a data URL. */
  readingStatus: (name: string) => string;
  /** Polite live-region status while a file is being uploaded by `uploadAttachment`. */
  uploadingStatus: (name: string) => string;
  /** Polite live-region announcement when a pending attachment finishes successfully. */
  completedAnnouncement: (name: string) => string;
  /** Polite live-region announcement when a pending attachment fails. */
  failedAnnouncement: (name: string) => string;
  /** Aria-label for the remove (X) button on a finished or failed attachment chip. */
  removeAttachment: (name: string) => string;
  /** Aria-label for the X button on a pending chip, where it cancels an in-progress upload/read. */
  cancelUpload: (name: string) => string;
  /** Visible label and title for the Retry button on a failed attachment chip. */
  retry: string;
  /** Aria-label for the Retry button on a failed attachment chip. */
  retryAttachment: (name: string) => string;
  /** Aria-label and title for the attachment-error dismiss button. */
  dismissError: string;
  /** Button label / tooltip for opening the "describe this image" affordance. */
  describeImage: string;
  /** Aria-label for the inline alt-text input. */
  describeImageInputAriaLabel: (name: string) => string;
  /** Placeholder shown in the alt-text input. */
  describeImagePlaceholder: string;
  /** Label used as the image `alt` when no alt text is provided (rendered in chat). */
  imageFallbackAlt: (name: string) => string;
  /** Validation error message for unsupported MIME types/extensions. */
  unsupportedTypeError: (context: ChorusAttachmentUnsupportedTypeContext) => string;
  /** Validation error message when a file exceeds `maxAttachmentBytes`. */
  tooLargeError: (context: ChorusAttachmentTooLargeContext) => string;
  /** Validation error message when adding the file would exceed `maxAttachments`. */
  tooManyError: (context: ChorusAttachmentTooManyContext) => string;
  /** Error message when the default FileReader fails to read a file. */
  readFailedError: (context: ChorusAttachmentFailureContext) => string;
  /** Error message when `uploadAttachment` rejects with an error. */
  uploadFailedError: (context: ChorusAttachmentFailureContext) => string;
}

export interface ResolvedChorusLabels {
  composer: ChorusComposerLabels;
  transcript: ChorusTranscriptLabels;
  messageActions: ChorusMessageActionLabels;
  speakers: ChorusSpeakerLabels;
  toolCall: ChorusToolCallLabels;
  reasoning: string;
  codeCopy: ChorusCodeCopyLabels;
  conversationList: ChorusConversationListLabels;
  attachments: ChorusAttachmentLabels;
  clearConversation: string;
}

/**
 * Partial localization overrides for built-in chorus strings.
 *
 * Every section is optional and accepts a partial of the corresponding resolved
 * label group. Top-level `reasoning` / `clearConversation` are plain strings.
 *
 * **Override semantics:** partial overrides only.
 * - Keys you omit fall back to the English default.
 * - `undefined` values are treated as "use the default".
 * - `null` values are treated as "use the default" (resolver is resilient to
 *   loose JSON / i18n catalog inputs that emit `null` for missing strings).
 * - **Empty strings are treated as "use the default"** so an i18n bundle that
 *   accidentally provides `''` for a key cannot erase the UI label.
 *
 * If you intentionally want a visually empty label, pass a non-empty whitespace
 * string (e.g. `' '`) instead of `''`.
 */
export type ChorusLabels = {
  composer?: Partial<ChorusComposerLabels> | null;
  transcript?: Partial<ChorusTranscriptLabels> | null;
  messageActions?: Partial<ChorusMessageActionLabels> | null;
  speakers?: Partial<ChorusSpeakerLabels> | null;
  toolCall?: Partial<ChorusToolCallLabels> | null;
  reasoning?: string | null;
  codeCopy?: Partial<ChorusCodeCopyLabels> | null;
  conversationList?: Partial<ChorusConversationListLabels> | null;
  attachments?: Partial<ChorusAttachmentLabels> | null;
  clearConversation?: string | null;
};
