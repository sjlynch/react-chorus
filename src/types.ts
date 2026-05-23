export type Role = 'user' | 'assistant' | 'system' | 'tool';
export type ConnectorName = 'auto' | 'openai' | 'anthropic' | 'gemini' | 'ai-sdk';
export type MessageFeedback = 'up' | 'down';
export type MessageSourceType = 'url' | 'document' | 'file' | 'unknown';

/**
 * Provider- or app-supplied source/citation attached to a message.
 *
 * Built-in streaming connectors append these to the active assistant message
 * when a provider emits source/citation frames. Keep values JSON-serializable
 * when using built-in persistence; `metadata` is intentionally free-form for
 * provider-specific details such as page numbers, offsets, media type, or file
 * ids that your app wants to preserve without rendering as answer text.
 */
export interface MessageSource {
  /** Stable source/citation id when the provider emits one. */
  id?: string;
  /** Broad source family used by the default renderer and transcript helpers. */
  type?: MessageSourceType;
  /** Human-readable title, file name, or document label. */
  title?: string;
  /** Canonical URL when the source can be opened in a browser. */
  url?: string;
  /** Short quoted excerpt or description associated with this citation. */
  snippet?: string;
  /** Provider/app-specific serializable details (offsets, page numbers, file ids, media type, etc.). */
  metadata?: Record<string, unknown>;
}

/** Back-compat-friendly alias: sources are often presented to readers as citations. */
export type MessageCitation = MessageSource;

export interface Attachment {
  name: string;
  type: string;
  /** Data URL by default; custom uploadAttachment handlers may store a URL or provider file id here instead. */
  data: string;
  size: number;
  /** Optional canonical URL when the attachment was uploaded before send. */
  url?: string;
  /** Optional provider/storage file id when the attachment was uploaded before send. */
  id?: string;
  /**
   * Optional human-authored description used as the image `alt` attribute when the attachment
   * is rendered in the transcript. Falls back to a role-hinted label such as
   * `Attached image: ${name}` when omitted. Useful for screen-reader and providers that
   * accept image captions in multimodal requests.
   */
  alt?: string;
  metadata?: Record<string, unknown>;
}

export type AttachmentUploadResult = Attachment | (Omit<Attachment, 'data'> & { data?: string });
export type AttachmentSource = 'picker' | 'paste' | 'drop';
export type AttachmentErrorReason = 'unsupported-type' | 'too-large' | 'too-many' | 'read-failed' | 'upload-failed';

export interface AttachmentError {
  reason: AttachmentErrorReason;
  message: string;
  file?: File;
  source: AttachmentSource;
  accept?: string;
  maxAttachmentBytes?: number;
  maxAttachments?: number;
}

export interface UploadAttachmentOptions {
  /** Aborted when the pending attachment chip is removed, the composer resets/unmounts, or file work is cancelled. */
  signal: AbortSignal;
}

export type UploadAttachment = (file: File, options?: UploadAttachmentOptions) => AttachmentUploadResult | Promise<AttachmentUploadResult>;

/**
 * Recognized artifact kinds emitted via the reserved `__artifact` tool call.
 * `code` and `document` route through existing Markdown/highlight pipelines;
 * `html` renders into a sandboxed iframe; `react` defers to the generative-UI
 * block registry (when one is wired).
 */
export type ArtifactKind = 'code' | 'document' | 'html' | 'react';

/**
 * Payload shape carried in a `__artifact` tool call's `input`. Each emission
 * is a single version; subsequent emissions with the same `id` stack as new
 * versions of the same artifact and become navigable via the panel switcher.
 */
export interface ArtifactPayload {
  id: string;
  kind: ArtifactKind;
  title: string;
  content: string;
  language?: string;
}

/**
 * One version snapshot of an artifact. `messageId` is the tool message that
 * emitted this version, so consumers can correlate panel content back to a
 * row in the transcript.
 */
export interface ArtifactVersion extends ArtifactPayload {
  version: number;
  messageId: string;
}

/** Aggregated artifact with its full ordered version history. */
export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  versions: ArtifactVersion[];
}

/**
 * Compact reference to an artifact attached to a message. Built-in rendering
 * shows a card with the title and an "Open" button (the full content lives in
 * the artifact registry, not on the message). Additive and safe to omit on
 * messages that do not carry an artifact.
 */
export interface ArtifactSummary {
  id: string;
  kind: ArtifactKind;
  title: string;
  version: number;
}

export interface ToolCall {
  /** Provider/tool-call id when the streaming connector exposes one. */
  id?: string;
  name: string;
  input?: unknown;
  output?: unknown;
  /**
   * Approval state when a `toolPolicy: 'ask'` gate has been applied to this
   * call: `'pending'` while awaiting a decision, `'allowed'` or `'denied'`
   * once resolved. Omitted when no gate ran (allow-by-default or a tool
   * without `requiresApproval`).
   */
  approval?: 'pending' | 'allowed' | 'denied';
}

/**
 * Generative-UI block payload attached to a message. Rendered inline by the
 * default transcript when the message's `block.name` matches a registered
 * entry in the `<Chorus blocks>` registry.
 *
 * - `name` selects the block component from the registry.
 * - `props` are the (possibly partial, streamed) props passed to the block.
 * - `status` reflects streaming lifecycle: `'streaming'` while props are still
 *   accumulating, `'done'` once the model has finished emitting the block, and
 *   `'error'` when validation or the component throws.
 */
export interface MessageBlock {
  name: string;
  props: unknown;
  status: 'streaming' | 'done' | 'error';
  /** Optional error message stored when `status === 'error'`. */
  error?: string;
}

interface ChorusMessageBase<TMeta = Record<string, unknown>> {
  id: string;
  /**
   * Optional creation time for the message, as an ISO-8601 string (e.g. `new Date().toISOString()`).
   * Purely informational: it is ignored unless `<Chorus showTimestamps>` is enabled, in which case the
   * default renderer shows a locale-aware per-message time. Additive and safe to omit.
   */
  createdAt?: string;
  /**
   * Optional source/citation references for the message. Built-in source-aware
   * connectors attach streamed citations to the active assistant message here;
   * the default renderer shows them as a source list, transcript search/export
   * includes them, and JSON persistence round-trips them with the message.
   */
  sources?: MessageSource[];
  /**
   * Compact reference to an artifact emitted by the assistant on this turn.
   * When present, default rendering shows an `ArtifactCard` (title + Open
   * button) in the bubble; the full content lives in the panel registry.
   * Round-trips through built-in JSON persistence.
   */
  artifact?: ArtifactSummary;
  /**
   * Generative-UI block payload. Set by Chorus when the assistant emits a
   * `__render_block` tool call: the streamed `{ name, props }` arguments are
   * mapped here instead of producing a `role: 'tool'` row. The default
   * transcript looks up `block.name` in the `<Chorus blocks>` registry and
   * renders the component inline; unregistered names render a small unknown-
   * block fallback. Round-tripped by JSON persistence.
   */
  block?: MessageBlock;
  /**
   * Optional provider key (from `<Chorus providers>`) that produced this
   * message. Set automatically on assistant messages when multi-provider
   * routing is configured; round-trips through built-in JSON persistence so
   * the model badge survives reloads.
   */
  provider?: string;
  /**
   * Optional model id used to produce this message. Set automatically from
   * `providers[name].modelId` (or the conversation-level `modelId` prop) when
   * present; consumed by the cost meter and rendered as part of the model
   * badge on assistant bubbles.
   */
  modelId?: string;
  metadata?: TMeta;
}

export interface UserMessage<TMeta = Record<string, unknown>> extends ChorusMessageBase<TMeta> {
  role: 'user';
  text: string;
  /**
   * Reasoning/chain-of-thought is an assistant-only concept. The default renderer only shows the
   * `Reasoning` disclosure for `assistant` messages, so a value here is carried but never displayed.
   * It is kept on the non-assistant message shapes for round-trip safety; a future major may move
   * `reasoning` to `AssistantMessage` only so the union itself forbids it on other roles.
   */
  reasoning?: string;
  attachments?: Attachment[];
  toolCall?: never;
}

export interface AssistantMessage<TMeta = Record<string, unknown>> extends ChorusMessageBase<TMeta> {
  role: 'assistant';
  text: string;
  reasoning?: string;
  attachments?: Attachment[];
  toolCall?: never;
}

export interface SystemMessage<TMeta = Record<string, unknown>> extends ChorusMessageBase<TMeta> {
  role: 'system';
  text: string;
  reasoning?: string;
  attachments?: never;
  toolCall?: never;
}

export interface ToolMessage<TMeta = Record<string, unknown>> extends ChorusMessageBase<TMeta> {
  role: 'tool';
  /**
   * Optional human-readable summary of the tool result. When non-empty, the default renderer
   * shows it as Markdown above the tool-call block; the structured call itself stays in
   * `toolCall`. Additive and safe to omit.
   */
  text?: string;
  reasoning?: string;
  attachments?: never;
  toolCall: ToolCall;
}

export type AnyChorusMessage<TMeta = Record<string, unknown>> =
  | UserMessage<TMeta>
  | AssistantMessage<TMeta>
  | SystemMessage<TMeta>
  | ToolMessage<TMeta>;

/** Back-compat alias for the public Chorus message union. Prefer the role-specific message types for narrowing. */
export type Message<TMeta = Record<string, unknown>> = AnyChorusMessage<TMeta>;

/** Pluggable storage adapter. Mirrors the localStorage API; methods may return Promises for async backends (e.g. IndexedDB). */
export interface StorageAdapter {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  /** Optional deletion hook used when conversations are cleared/deleted. */
  removeItem?(key: string): void | Promise<void>;
}
