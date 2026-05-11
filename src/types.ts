export type Role = 'user' | 'assistant' | 'system' | 'tool';

export interface ToolCall {
  name: string;
  input?: unknown;
  output?: unknown;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  toolCall?: ToolCall;
}
