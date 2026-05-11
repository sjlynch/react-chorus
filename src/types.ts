export type Role = 'user' | 'assistant';

export interface Attachment {
  name: string;
  type: string;
  data: string; // base64 data URL
  size: number;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  attachments?: Attachment[];
}
