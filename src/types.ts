export type Role = 'user' | 'assistant';

export interface Message {
  id: string;
  role: Role;
  text: string;
  metadata?: Record<string, unknown>;
}
