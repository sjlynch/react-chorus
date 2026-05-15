export type Role = 'user' | 'assistant' | 'system' | 'tool';
export type ConnectorName = 'auto' | 'openai' | 'anthropic' | 'gemini';
export type MessageFeedback = 'up' | 'down';

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

export interface ToolCall {
  /** Provider/tool-call id when the streaming connector exposes one. */
  id?: string;
  name: string;
  input?: unknown;
  output?: unknown;
}

export interface Message<TMeta = Record<string, unknown>> {
  id: string;
  role: Role;
  text: string;
  reasoning?: string;
  attachments?: Attachment[];
  metadata?: TMeta;
  toolCall?: ToolCall;
}

/** Pluggable storage adapter. Mirrors the localStorage API; methods may return Promises for async backends (e.g. IndexedDB). */
export interface StorageAdapter {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  /** Optional deletion hook used when conversations are cleared/deleted. */
  removeItem?(key: string): void | Promise<void>;
}
