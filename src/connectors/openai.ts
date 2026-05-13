import { extractErrorMessage } from './error';

export interface ConnectorResult { text?: string; done?: boolean; error?: string }
export interface Connector { name: string; extract: (data: string) => ConnectorResult | null }

/**
 * OpenAI Chat Completions streaming connector.
 * Expects SSE data lines that are either "[DONE]" or JSON with choices[*].delta.content.
 * Tool-call deltas (choices[*].delta.tool_calls) are intentionally ignored;
 * handle them with a custom connector/onSend flow when your app needs tool steps.
 */
export const openaiConnector: Connector = {
  name: 'openai',
  extract(data: string): ConnectorResult | null {
    if (data === '[DONE]') return { done: true };
    try {
      const obj = JSON.parse(data);
      const error = extractErrorMessage(obj);
      if (error) return { error };
      const choices = obj?.choices;
      if (!Array.isArray(choices)) return null;
      let text = '';
      for (const c of choices) {
        const part = c?.delta?.content;
        if (typeof part === 'string') text += part;
      }
      if (text) return { text };
      return null; // ignore role-only or empty deltas
    } catch {
      // If provider sends plain text lines for some reason, treat as text
      return data ? { text: data } : null;
    }
  }
};
