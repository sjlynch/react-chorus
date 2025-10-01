import type { Message } from '../types';
import type { Transport } from '../hooks/useChorusStream';

export function createFetchSSETransport(url: string, init?: RequestInit): Transport {
  return async (text: string, history: Message[], signal: AbortSignal) => {
    const body = JSON.stringify({ prompt: text, history });
    const headers = { 'Content-Type': 'application/json', ...(init?.headers || {}) };
    return fetch(url, { method: 'POST', headers, body, signal, ...init });
  };
}
