export type Role = 'user' | 'assistant' | 'system' | 'tool';

export interface Attachment {
  name: string;
  type: string;
  data: string; // base64 data URL
  size: number;
}

export interface ToolCall {
  name: string;
  input?: unknown;
  output?: unknown;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  attachments?: Attachment[];
  metadata?: Record<string, unknown>;
  toolCall?: ToolCall;
}

/** Pluggable storage adapter. Mirrors the localStorage API; getItem/setItem may return Promises for async backends (e.g. IndexedDB). */
export interface StorageAdapter {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}
