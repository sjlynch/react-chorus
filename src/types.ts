export type Role = 'user' | 'assistant' | 'system' | 'tool';
export type ConnectorName = 'auto' | 'openai' | 'anthropic' | 'gemini';

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

export type UploadAttachment = (file: File) => AttachmentUploadResult | Promise<AttachmentUploadResult>;

export interface ToolCall {
  name: string;
  input?: unknown;
  output?: unknown;
}

export interface Message<TMeta = Record<string, unknown>> {
  id: string;
  role: Role;
  text: string;
  attachments?: Attachment[];
  metadata?: TMeta;
  toolCall?: ToolCall;
}

/** Pluggable storage adapter. Mirrors the localStorage API; getItem/setItem may return Promises for async backends (e.g. IndexedDB). */
export interface StorageAdapter {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}
