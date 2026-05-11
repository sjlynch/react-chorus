export type Role = 'user' | 'assistant' | 'system' | 'tool';

export interface Message { id: string; role: Role; text: string }
