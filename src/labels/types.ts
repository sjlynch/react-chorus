// Pure type module. Importing types from here is a zero-runtime/zero-side-effect
// edge in the dependency graph, so component bundles can reference the label
// contracts without pulling sibling default constants.

import type { ArtifactKind } from '../types';

export interface ChorusComposerLabels {
  placeholder: string;
  ariaLabel: string;
  attachFile: string;
  /** Text shown in the drag-and-drop overlay while a file is dragged over the chat surface. */
  dropToAttach: string;
  send: string;
  stop: string;
  disabledReason: string;
  readOnlyReason: string;
  /** Aria-label for the slash-command palette listbox. */
  slashCommands: string;
  /** Visible/aria/title label for the MCP resource attachment picker. */
  attachResource: string;
  /** Disabled placeholder option shown at the top of the resource picker. */
  resourcePickerPlaceholder: string;
  /** Fallback aria-label/title for the inline provider/model picker when the picker supplies none. */
  modelPicker: string;
}

export interface ChorusTranscriptLabels {
  ariaLabel: string;
  typing: string;
  retry: string;
  /** Aria-label and title for the dismiss button on the default error banner. */
  dismissError: string;
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
  /** Status shown while a tool call is still streaming / awaiting its result. */
  running: string;
  /** Status shown when a finished tool call produced no input and no output. */
  empty: string;
  /** Screen-reader status announced by the default per-tool loader; receives the tool name. */
  calling: (toolName: string) => string;
}

export interface ChorusCostLabels {
  /** Visible "Cost" label in the conversation cost-meter header. */
  header: string;
  /** Tooltip breakdown shown in the header when no usage has been recorded yet. */
  noUsage: string;
  /** Header budget suffix, e.g. `/ $5.00 budget`; receives the formatted budget total. */
  budgetSuffix: (formattedBudget: string) => string;
  /** Aria-label for the per-message cost chip; receives the formatted cost and whether it is an approximate (live) estimate. */
  chipAriaLabel: (context: { formatted: string; approximate: boolean }) => string;
  /** Tooltip on the live (pre-finalized) per-message estimate chip. */
  liveEstimateTitle: string;
}

export interface ChorusArtifactLabels {
  /** Fallback title for an artifact with no title (panel heading + inline card). */
  untitled: string;
  /** Aria-label for the artifact side-panel root; receives the artifact title. */
  panelAriaLabel: (title: string) => string;
  /** Aria-label for the panel close button. */
  close: string;
  /** Aria-label for the previous-version button. */
  previousVersion: string;
  /** Aria-label for the next-version button. */
  nextVersion: string;
  /** Diff toggle button. */
  diff: string;
  /** Copy action, idle state. */
  copy: string;
  /** Copy action after a successful copy. */
  copied: string;
  /** Copy action after a failed copy. */
  copyFailed: string;
  /** Download action. */
  download: string;
  /** Open-in-new-tab action. */
  openInNewTab: string;
  /** Title applied to the sandboxed HTML preview iframe when the version has no title. */
  previewTitle: string;
  /** Placeholder shown when a `react` artifact has no `renderReactArtifact` handler. */
  reactPlaceholder: string;
  /** Error shown when a `react` artifact throws while rendering; receives the error message. */
  reactError: (message: string) => string;
  /** Inline card open-button label. */
  open: string;
  /** Per-kind label shown on inline artifact cards. */
  kind: (kind: ArtifactKind) => string;
}

export interface ChorusApprovalLabels {
  /** Card heading and aria-label, e.g. "Approval required". */
  title: string;
  /** Connector between the tool name and the MCP server name, e.g. "via". */
  serverPrefix: string;
  /** Label for the collapsible tool-input toggle. */
  inputLabel: string;
  /** "Allow once" button. */
  allowOnce: string;
  /** "Allow always for this tool" button. */
  allowAlways: string;
  /** "Deny" button. */
  deny: string;
}

export interface ChorusMcpLabels {
  /** MCP server status line; receives the server name and its status string. */
  status: (context: { name: string; status: string }) => string;
  /** Suffix appended to the status line when the server reports an error message. */
  errorSuffix: (error: string) => string;
  /** Suffix appended to the status line while a reconnect is scheduled; receives whole seconds. */
  reconnectingSuffix: (seconds: number) => string;
  /** Reconnect button label. */
  reconnect: string;
}

export interface ChorusSourceLabels {
  /** Section title and aria label for assistant sources/citations. */
  sources: string;
  /** Fallback visible label for a source without title/url/id; receives a zero-based source index. */
  source: (index: number) => string;
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
  /** Inline validation message shown when a rename is submitted with an empty title. */
  renameEmptyError: string;
  /** Inline validation message shown when a rename title exceeds the documented max length. */
  renameTooLongError: (maxLength: number) => string;
  /** Polite live-region announcement after a conversation row is deleted. */
  deletedAnnouncement: (title: string) => string;
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
  sources: ChorusSourceLabels;
  reasoning: string;
  codeCopy: ChorusCodeCopyLabels;
  conversationList: ChorusConversationListLabels;
  attachments: ChorusAttachmentLabels;
  cost: ChorusCostLabels;
  artifacts: ChorusArtifactLabels;
  approval: ChorusApprovalLabels;
  mcp: ChorusMcpLabels;
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
  sources?: Partial<ChorusSourceLabels> | null;
  reasoning?: string | null;
  codeCopy?: Partial<ChorusCodeCopyLabels> | null;
  conversationList?: Partial<ChorusConversationListLabels> | null;
  attachments?: Partial<ChorusAttachmentLabels> | null;
  cost?: Partial<ChorusCostLabels> | null;
  artifacts?: Partial<ChorusArtifactLabels> | null;
  approval?: Partial<ChorusApprovalLabels> | null;
  mcp?: Partial<ChorusMcpLabels> | null;
  clearConversation?: string | null;
};
